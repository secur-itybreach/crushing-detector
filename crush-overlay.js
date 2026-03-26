// ==========================================
// crush-overlay.js
// P5.JS OVERLAY — CRUSH TREE ANIMATION
//
// Depends on globals from sketch.js:
//   - etatActuel    (string state machine)
//   - canvasElement (the main output canvas)
// Depends on LSystem.js (ES module, imported below)
// ==========================================

import { LSystem } from './LSystem.js';
let socket;

function initSocket() {
  socket = new WebSocket("ws://127.0.0.1:9980");

  socket.onopen = () => console.log("WS connected");
  socket.onclose = () => console.log("WS closed");
  socket.onerror = (e) => console.error("WS error", e);
}
new p5(function (p) {

    // ---- State ----
    /** @type {LSystem|null} */
    let tree      = null;
    let active    = false;
    let fade      = 1;       // 1 → 0: global opacity after tree finishes growing
    let lastState = "";

    // How many frames to keep the fully-grown tree visible before fading
    const HOLD_FRAMES = 60;
    let holdCounter   = 0;

    // Palette: dominant trunk, secondary bloom A, tertiary bloom B
    // Falls back to neutral greys if color sampling hasn't run yet
    const FALLBACK_PALETTE = [
        { r: 180, g: 255, b: 160 },
        { r: 255, g: 200, b: 100 },
        { r: 255, g: 120, b: 160 },
    ];

    // ---- Setup ----
    p.setup = function () {
        const placeholder = document.getElementById('p5-overlay');
        const cnv = p.createCanvas(canvasElement.width, canvasElement.height);
        cnv.elt.id = 'p5-overlay';
        placeholder.parentNode.replaceChild(cnv.elt, placeholder);
        p.clear();
        initSocket();
    };

    // ---- Draw loop ----
    p.draw = function () {
        // Keep overlay in sync with the main canvas size
        if (p.width !== canvasElement.width || p.height !== canvasElement.height) {
            p.resizeCanvas(canvasElement.width, canvasElement.height);
        }

        p.clear();

        // Detect the TERMINE transition → spawn a fresh tree
        if (etatActuel === "TERMINE" && lastState !== "TERMINE") {
            const palette = (typeof detectedPalette !== 'undefined' && detectedPalette)
                ? detectedPalette
                : FALLBACK_PALETTE;

            tree        = new LSystem(p, p.width / 2, p.height / 2, palette);
            active      = true;
            fade        = 1;
            holdCounter = 0;

            console.log(`Added tree, palette: ${palette.map(c => `rgb(${c.r},${c.g},${c.b})`).join(' | ')}`);

            const promptMap = {
                "Canette Orange": "orange can",
                "Canette Verte": "green can",
                "Canette Bleue": "blue can",
                "Canette Rouge": "red can",
                "Gobelet Blanc": "white cup",
                "Déchet Gris/Noir": "dark trash"
            };

            const labelToUse = (typeof lockedDetectedObjectLabel !== 'undefined' && lockedDetectedObjectLabel)
                ? lockedDetectedObjectLabel
                : liveDetectedObjectLabel;

            const prompt = promptMap[labelToUse] || labelToUse || "unknown object";

            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: "prompt",
                    prompt: prompt
                }));
            }

            console.log("Prompt envoyé à TouchDesigner :", prompt);
        }
        lastState = etatActuel;

        if (!active || !tree) return;

        // Apply global fade via canvas alpha
        p.drawingContext.globalAlpha = fade;

        tree.update();
        tree.draw(p);

        p.drawingContext.globalAlpha = 1;

        // Once the tree has reached MAX_GEN and fully grown, start the hold → fade
        const treeFinished = tree._generation >= LSystem.MAX_GEN && tree._growthPercent >= 1;

        if (treeFinished) {
            holdCounter++;
            if (holdCounter > HOLD_FRAMES) {
                fade = Math.max(0, fade - 0.015);
                if (fade <= 0) {
                    active = false;
                    tree   = null;
                }
            }
        }
    };
});