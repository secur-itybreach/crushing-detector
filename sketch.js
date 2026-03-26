// ==========================================
// CONFIGURATION
// ==========================================
const LISTE_BLANCHE_COCO = [
    'bottle', 'cup', 'wine glass', 'fork', 'knife', 'spoon', 'bowl', 
    'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot',
    'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'toaster',
    'potted plant', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'toothbrush'
];

const TRADUCTION_UTILISATEUR = {
    'bottle': 'Bouteille / Flacon', 'cup': 'Tasse / Gobelet', 'wine glass': 'Verre à pied',
    'fork': 'Fourchette', 'knife': 'Couteau', 'spoon': 'Cuillère', 'bowl': 'Bol / Saladier',
    'banana': 'Banane', 'apple': 'Pomme', 'sandwich': 'Sandwich',
    'broccoli': 'Brocoli', 'carrot': 'Carotte', 'orange': 'Orange',
    'tv': 'Écran / Moniteur', 'laptop': 'Ordinateur portable', 'mouse': 'Souris', 
    'remote': 'Télécommande', 'keyboard': 'Clavier', 'cell phone': 'Téléphone portable', 'toaster': 'Grille-pain',
    'potted plant': 'Plante en pot', 'book': 'Livre', 'clock': 'Horloge', 
    'vase': 'Vase', 'scissors': 'Ciseaux', 'teddy bear': 'Ours en peluche', 'toothbrush': 'Brosse à dents'
};

// ==========================================
// ÉLÉMENTS DOM
// ==========================================
const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d', { willReadFrequently: true });
const blackMaskCanvas = document.getElementById('black-mask');
const blackMaskCtx = blackMaskCanvas.getContext('2d');
const uiPanel = document.getElementById('ui-panel');
const statusDiv = document.getElementById('status');
const valType = document.getElementById('val-type');
const predictionBanner = document.getElementById('prediction-banner');
const showVideoCheckbox = document.getElementById('showVideo'); // NOUVEAU

// ==========================================
// PARAMÈTRES GLOBAUX & ÉTATS
// ==========================================
let PARAMS = {
    minScore: 30, reqFrames: 15, tolMouvement: 30, crushPercent: 80, crushTime: 30,        
    distX: 35, distY: 35, maxLossFrames: 100, shieldMargin: 50, shieldHeightPct: 40, showUI: true,
    showVideo: true, // État de l'affichage vidéo
    hideVideoBackground: false
};

let etatActuel = "INITIALISATION"; 
let compteurFrames = 0, compteurEcrasement = 0;
let framesPerdues = 0; 
let ancienneBoiteObjet = null, boiteObjetVerrouillee = null;

// Palette sampled from the locked object's bounding box.
// crush-overlay.js reads this when spawning the fractal tree.
let detectedPalette = null;

// IA
let modeleObjet = null, modeleMain = null, dernieresMains = []; 
let modeleMobileNet = null, classifieurKNN = null;
let isPredictingKNN = false; 

const offCanvas = document.createElement('canvas');
offCanvas.width = 224; offCanvas.height = 224;
const offCtx = offCanvas.getContext('2d');

const CONNEXIONS_MAIN = [
    [0,1], [1,2], [2,3], [3,4], [0,5], [5,6], [6,7], [7,8], 
    [5,9], [9,10], [10,11], [11,12], [9,13], [13,14], [14,15], [15,16], 
    [13,17], [17,18], [18,19], [19,20], [0,17]
];

// ==========================================
// AUDIO SYSTEM
// ==========================================
let audioCtx = null;
function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('click', initAudio);
document.addEventListener('keydown', initAudio);

function jouerSonEcrasement() {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.3);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

function syncBlackMaskCanvas() {
    if (!blackMaskCanvas) return;

    blackMaskCanvas.width = canvasElement.width;
    blackMaskCanvas.height = canvasElement.height;

    blackMaskCanvas.style.width = canvasElement.clientWidth + "px";
    blackMaskCanvas.style.height = canvasElement.clientHeight + "px";

    blackMaskCtx.clearRect(0, 0, blackMaskCanvas.width, blackMaskCanvas.height);

    if (PARAMS.hideVideoBackground) {
        blackMaskCtx.fillStyle = "#000";
        blackMaskCtx.fillRect(0, 0, blackMaskCanvas.width, blackMaskCanvas.height);
        blackMaskCanvas.style.display = "block";
    } else {
        blackMaskCanvas.style.display = "none";
    }
}
// ==========================================
// INITIALISATION
// ==========================================
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        videoElement.srcObject = stream;
        await new Promise(resolve => {
    videoElement.onloadeddata = () => {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        syncBlackMaskCanvas();
        resolve();
    };
});
        [modeleObjet, modeleMobileNet] = await Promise.all([
            cocoSsd.load(), mobilenet.load()
        ]);
        classifieurKNN = knnClassifier.create();

        modeleMain = new Hands({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
        modeleMain.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.5 });
        modeleMain.onResults((results) => { dernieresMains = results.multiHandLandmarks; });

        etatActuel = "RECHERCHE";
        mettreAJourStatut("RECHERCHE D'UN OBJET...", "orange");
        mettreAJourCompteursKNN();
        
        bouclePrincipale();
    } catch (err) {
        console.error(err);
        mettreAJourStatut("ERREUR WEBCAM", "red");
        predictionBanner.innerText = "Erreur de caméra";
    }
}

// ==========================================
// PRÉDICTION KNN
// ==========================================
function obtenirFeaturesDeLaBox(box) {
    offCtx.clearRect(0, 0, 224, 224);
    let bx = Math.max(0, box.x); let by = Math.max(0, box.y);
    let bw = Math.min(videoElement.videoWidth - bx, box.width);
    let bh = Math.min(videoElement.videoHeight - by, box.height);

    // Les IA lisent directement depuis la balise video cachée !
    if (bw > 0 && bh > 0) offCtx.drawImage(videoElement, bx, by, bw, bh, 0, 0, 224, 224);
    const imageTensor = tf.browser.fromPixels(offCanvas);
    const logits = modeleMobileNet.infer(imageTensor, true);
    imageTensor.dispose(); 
    return logits;
}

async function executerKNNPrediction(box) {
    let logits;
    try {
        logits = obtenirFeaturesDeLaBox(box);
        const res = await classifieurKNN.predictClass(logits);
        predictionBanner.innerText = `Détection : ${res.label} (${Math.round(res.confidences[res.label] * 100)}%)`;
        predictionBanner.style.color = "#00ffcc";
        predictionBanner.style.borderColor = "#00ffcc";
    } catch (err) {
        console.warn("Prédiction KNN ignorée");
    } finally {
        if (logits) logits.dispose();
    }
}

function mettreAJourCompteursKNN() {
    const counts = classifieurKNN.getClassExampleCount();
    const select = document.getElementById('train-select');
    let totalExemples = 0;
    for (let i = 0; i < select.options.length; i++) {
        let opt = select.options[i];
        let count = counts[opt.value] || 0;
        opt.text = `${opt.value} (${count})`; 
        totalExemples += count;
    }
    document.getElementById('train-count').innerText = totalExemples;
}

// ==========================================
// BOUCLE PRINCIPALE 
// ==========================================
async function bouclePrincipale() {
    // ----------------------------------------------------
    // 1. GESTION DU FOND DU CANVAS (CUSTOM RENDERING)
    // ----------------------------------------------------
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (PARAMS.showVideo) {
        // Mode Debug : On affiche la caméra
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    } else {
        // Mode Jeu/Prod : On dessine un fond noir (ou ce que tu veux !)
        // C'EST ICI QUE TU PEUX INJECTER TON PROPRE JEU OU ANIMATION VISUELLE
        canvasCtx.fillStyle = "#111"; 
        canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
        
        /* Exemple d'ajout perso :
        canvasCtx.fillStyle = "white";
        canvasCtx.font = "20px Arial";
        canvasCtx.fillText("Mon super jeu interactif !", 20, 30);
        */
    }
    // ----------------------------------------------------


    // 2. ANALYSE IA (Totalement indépendante de ce qui est dessiné au-dessus)
    const seuilConfiance = PARAMS.minScore / 100;
    
    const [predictions] = await Promise.all([
        modeleObjet.detect(videoElement, 10, seuilConfiance), // Analyse la balise vidéo cachée
        modeleMain.send({image: videoElement})                // Analyse la balise vidéo cachée
    ]);

    const predictionsValides = predictions.filter(p => {
        if (p.class === 'person') return false;
        if (LISTE_BLANCHE_COCO.includes(p.class)) return true;
        
        if (boiteObjetVerrouillee && (etatActuel === "ECRASEMENT" || etatActuel === "TERMINE")) {
            let cx_p = p.bbox[0] + p.bbox[2] / 2;
            let cy_p = p.bbox[1] + p.bbox[3] / 2;
            let cx_v = boiteObjetVerrouillee.x + boiteObjetVerrouillee.width / 2;
            let cy_v = boiteObjetVerrouillee.y + boiteObjetVerrouillee.height / 2;
            if (Math.hypot(cx_p - cx_v, cy_p - cy_v) < boiteObjetVerrouillee.width / 2) return true; 
        }
        return false;
    });

    // 3. DESSIN DES LIGNES DE DEBUG
    if (PARAMS.showVideo) { // On n'affiche les boîtes vertes que si on est en mode Debug vidéo
        canvasCtx.lineWidth = 2;
        canvasCtx.font = "14px Arial";
        predictionsValides.forEach(p => {
            canvasCtx.strokeStyle = "rgba(0, 255, 0, 0.4)";
            canvasCtx.strokeRect(p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
            canvasCtx.fillStyle = "rgba(0, 255, 0, 0.4)";
            canvasCtx.fillText(p.class, p.bbox[0], p.bbox[1] > 20 ? p.bbox[1] - 5 : 15);
        });
    }

    let cible = null;
    let maxArea = 0;
    predictionsValides.forEach(p => {
        let area = p.bbox[2] * p.bbox[3];
        if (area > maxArea) { maxArea = area; cible = p; }
    });

    // --- BOUCLIER D'OCCLUSION ---
    let mainOcculteObjet = false;
    let pointsDansBouclier = 0;

    if (boiteObjetVerrouillee && (etatActuel === "ECRASEMENT" || etatActuel === "TERMINE")) {
        let sTop = boiteObjetVerrouillee.y - PARAMS.shieldMargin;
        let sBottom = boiteObjetVerrouillee.y + (boiteObjetVerrouillee.height * (PARAMS.shieldHeightPct / 100));
        let sLeft = boiteObjetVerrouillee.x - PARAMS.shieldMargin;
        let sRight = boiteObjetVerrouillee.x + boiteObjetVerrouillee.width + PARAMS.shieldMargin;

        if (dernieresMains && dernieresMains.length > 0) {
            let main = dernieresMains[0];
            for (let pt of main) {
                let px = pt.x * canvasElement.width;
                let py = pt.y * canvasElement.height;
                if (px >= sLeft && px <= sRight && py >= sTop && py <= sBottom) pointsDansBouclier++;
            }
            if (pointsDansBouclier >= 2) mainOcculteObjet = true;
        }
    }

    // --- GESTION DE L'ÉTAT ---
    if (cible) {
        framesPerdues = 0; 
        let box = { x: cible.bbox[0], y: cible.bbox[1], width: cible.bbox[2], height: cible.bbox[3] };
        
        let typeFrancais = TRADUCTION_UTILISATEUR[cible.class] || `*${cible.class}*`;
        valType.innerText = `${typeFrancais} (${cible.class})`;

        if (classifieurKNN.getNumClasses() > 0) {
            if (!isPredictingKNN) {
                isPredictingKNN = true;
                executerKNNPrediction(box).then(() => { isPredictingKNN = false; });
            }
        } else {
            predictionBanner.innerText = "L'IA n'est pas encore entraînée";
            predictionBanner.style.color = "#aaa";
        }

        if (etatActuel === "RECHERCHE" || etatActuel === "STABILISATION") {
            logiqueVerrouillageInitial(box);
        } else if (etatActuel === "ECRASEMENT") {
            logiqueSuiviFluide(box, mainOcculteObjet);
        }
        ancienneBoiteObjet = box;
    } else {
        if (mainOcculteObjet) {
            mettreAJourStatut("INTERACTION EN COURS (Fixé)", "cyan");
        } else {
            framesPerdues++;
            if (framesPerdues > PARAMS.maxLossFrames) {
                if (etatActuel !== "INITIALISATION" && etatActuel !== "RECHERCHE") {
                    etatActuel = "RECHERCHE";
                    compteurFrames = 0; compteurEcrasement = 0;
                    ancienneBoiteObjet = null; boiteObjetVerrouillee = null;
                    valType.innerText = "Aucun déchet";
                    predictionBanner.innerText = "En attente d'un objet...";
                    predictionBanner.style.color = "#fff";
                    predictionBanner.style.borderColor = "#444";
                    mettreAJourStatut("RECHERCHE", "orange");
                }
            } else {
                if (boiteObjetVerrouillee && etatActuel === "ECRASEMENT") {
                    mettreAJourStatut(`PERTE VISUELLE OBJET... (${framesPerdues}/${PARAMS.maxLossFrames})`, "orange");
                }
            }
        }
    }

    // On dessine le HUD d'interaction par dessus le reste
    dessinerToutEtEcraser();
    
    requestAnimationFrame(bouclePrincipale);
}

// ==========================================
// LOGIQUE DE TRACKING FLUIDE
// ==========================================
function logiqueVerrouillageInitial(box) {
    if (PARAMS.showVideo) {
        canvasCtx.strokeStyle = "orange";
        canvasCtx.lineWidth = 4;
        canvasCtx.strokeRect(box.x, box.y, box.width, box.height);
    }

    if (ancienneBoiteObjet && estImmobile(ancienneBoiteObjet, box, PARAMS.tolMouvement)) {
        compteurFrames++;
        if (etatActuel !== "STABILISATION") { etatActuel = "STABILISATION"; mettreAJourStatut("STABILISATION INITIALE...", "yellow"); }
        if (compteurFrames >= PARAMS.reqFrames) {
            boiteObjetVerrouillee = { x: box.x, y: box.y, width: box.width, height: box.height };
            etatActuel = "ECRASEMENT";
            compteurEcrasement = 0;
            mettreAJourStatut("VERROUILLÉ - ATTENTE MAIN", "cyan");

            // Sample the object's colors so crush-overlay.js can use them for the tree
            detectedPalette = sampleDominantColors(videoElement, box.x, box.y, box.width, box.height);
        }
    } else {
        compteurFrames = 0;
        etatActuel = "RECHERCHE";
        mettreAJourStatut("RECHERCHE", "orange");
    }
}

function logiqueSuiviFluide(box, mainProche) {
    if (!mainProche) {
        boiteObjetVerrouillee.x += (box.x - boiteObjetVerrouillee.x) * 0.4;
        boiteObjetVerrouillee.y += (box.y - boiteObjetVerrouillee.y) * 0.4;
        boiteObjetVerrouillee.width += (box.width - boiteObjetVerrouillee.width) * 0.4;
        boiteObjetVerrouillee.height += (box.height - boiteObjetVerrouillee.height) * 0.4;
        mettreAJourStatut("VERROUILLÉ - SUIVI ACTIF", "cyan");
    } else {
        mettreAJourStatut("VERROUILLÉ - ATTENTE MAIN (Figé)", "cyan");
    }
}

// ==========================================
// HITBOX MULTI-POINTS ET RENDU HUD
// ==========================================
function dessinerToutEtEcraser() {
    if (boiteObjetVerrouillee && (etatActuel === "ECRASEMENT" || etatActuel === "TERMINE")) {
        
        canvasCtx.strokeStyle = "cyan";
        canvasCtx.lineWidth = 4;
        canvasCtx.strokeRect(boiteObjetVerrouillee.x, boiteObjetVerrouillee.y, boiteObjetVerrouillee.width, boiteObjetVerrouillee.height);
        
        let sTop = boiteObjetVerrouillee.y - PARAMS.shieldMargin;
        let sBottom = boiteObjetVerrouillee.y + (boiteObjetVerrouillee.height * (PARAMS.shieldHeightPct / 100));
        let sLeft = boiteObjetVerrouillee.x - PARAMS.shieldMargin;
        let sRight = boiteObjetVerrouillee.x + boiteObjetVerrouillee.width + PARAMS.shieldMargin;
        
        canvasCtx.strokeStyle = "rgba(200, 100, 255, 0.8)";
        canvasCtx.setLineDash([5, 5]);
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(sLeft, sTop, sRight - sLeft, sBottom - sTop);
        canvasCtx.setLineDash([]);
        
        canvasCtx.fillStyle = "rgba(200, 100, 255, 0.8)";
        canvasCtx.font = "12px Arial";
        canvasCtx.fillText("ZONE FIXATION", sLeft, sTop - 5);

        let ligneEcrasementY = boiteObjetVerrouillee.y + (boiteObjetVerrouillee.height * (PARAMS.crushPercent / 100));
        let limiteBasse = boiteObjetVerrouillee.y + boiteObjetVerrouillee.height + PARAMS.distY;
        let limiteGauche = boiteObjetVerrouillee.x - PARAMS.distX;
        let limiteDroite = boiteObjetVerrouillee.x + boiteObjetVerrouillee.width + PARAMS.distX;

        canvasCtx.fillStyle = "rgba(255, 0, 0, 0.2)";
        canvasCtx.fillRect(limiteGauche, ligneEcrasementY, limiteDroite - limiteGauche, limiteBasse - ligneEcrasementY);
        canvasCtx.strokeStyle = "rgba(255, 255, 0, 0.5)";
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeRect(limiteGauche, ligneEcrasementY, limiteDroite - limiteGauche, limiteBasse - ligneEcrasementY);

        if (dernieresMains && dernieresMains.length > 0) {
            let main = dernieresMains[0];
            canvasCtx.strokeStyle = "white";
            canvasCtx.lineWidth = 2;
            CONNEXIONS_MAIN.forEach(paire => {
                let pt1 = main[paire[0]];
                let pt2 = main[paire[1]];
                canvasCtx.beginPath();
                canvasCtx.moveTo(pt1.x * canvasElement.width, pt1.y * canvasElement.height);
                canvasCtx.lineTo(pt2.x * canvasElement.width, pt2.y * canvasElement.height);
                canvasCtx.stroke();
            });

            let pointsDansZoneEcrasement = 0;
            main.forEach(pt => {
                let xPixel = pt.x * canvasElement.width;
                let yPixel = pt.y * canvasElement.height;
                
                if (xPixel >= sLeft && xPixel <= sRight && yPixel >= sTop && yPixel <= sBottom) {
                    canvasCtx.fillStyle = "rgba(200, 100, 255, 1)";
                } else {
                    canvasCtx.fillStyle = "red";
                }

                if (yPixel >= ligneEcrasementY && yPixel <= limiteBasse && xPixel >= limiteGauche && xPixel <= limiteDroite) { 
                    pointsDansZoneEcrasement++; 
                    canvasCtx.fillStyle = "yellow"; 
                } 

                canvasCtx.beginPath();
                canvasCtx.arc(xPixel, yPixel, 4, 0, 2 * Math.PI);
                canvasCtx.fill();
            });

            if (etatActuel === "ECRASEMENT") {
                if (pointsDansZoneEcrasement >= 2) {
                    compteurEcrasement++;
                    mettreAJourStatut(`ÉCRASEMENT... (${compteurEcrasement}/${PARAMS.crushTime})`, "red");

                    if (compteurEcrasement >= PARAMS.crushTime) {
                        jouerSonEcrasement();
                        mettreAJourStatut("BOUM ! OBJET ÉCRASÉ !", "red");
                        etatActuel = "TERMINE"; 
                        
                        setTimeout(() => {
                            etatActuel = "RECHERCHE"; framesPerdues = 0; compteurFrames = 0; compteurEcrasement = 0;
                            ancienneBoiteObjet = null; boiteObjetVerrouillee = null;
                            mettreAJourStatut("RECHERCHE", "orange");
                            predictionBanner.innerText = "En attente d'un objet...";
                            predictionBanner.style.color = "#fff";
                            predictionBanner.style.borderColor = "#444";
                        }, 2000);
                    }
                } else {
                    if (compteurEcrasement > 0) { 
                        compteurEcrasement = Math.max(0, compteurEcrasement - 2); 
                        if (compteurEcrasement === 0 && framesPerdues === 0) mettreAJourStatut("VERROUILLÉ - ATTENTE MAIN", "cyan");
                    }
                }
            }
        } else {
            if (etatActuel === "ECRASEMENT" && compteurEcrasement > 0) { 
                compteurEcrasement = Math.max(0, compteurEcrasement - 2); 
                if (compteurEcrasement === 0 && framesPerdues === 0) mettreAJourStatut("VERROUILLÉ - ATTENTE MAIN", "cyan"); 
            }
        }
    }
}

// ==========================================
// COLOR SAMPLING
// ==========================================

/**
 * Sample the dominant colors from a region of the (hidden) video element.
 * Works directly on video.pixels — no pixelDensity scaling needed.
 *
 * @param {HTMLVideoElement} video
 * @param {number} x, y, w, h  — bounding box in video-pixel space
 * @param {number} [count=3]   — number of colors to return
 * @returns {Array<{r,g,b}>}
 */
function sampleDominantColors(video, x, y, w, h, count = 3) {
    const pw = video.videoWidth, ph = video.videoHeight;

    // Snapshot the current video frame once, reuse for both passes
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width  = pw;
    sampleCanvas.height = ph;
    const sampleCtx = sampleCanvas.getContext('2d');
    sampleCtx.drawImage(video, 0, 0, pw, ph);
    const imageData = sampleCtx.getImageData(0, 0, pw, ph);
    const d = imageData.data;

    const step = 2, quant = 24;

    // ── Helper: read a pixel from the flat imageData array ──────────────────
    function readPixel(px, py) {
        const i = 4 * (py * pw + px);
        return { r: d[i], g: d[i + 1], b: d[i + 2] };
    }

    // ── Helper: colour distance in RGB space ─────────────────────────────────
    function dist(c1, c2) {
        const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
        return Math.sqrt(dr*dr + dg*dg + db*db);
    }

    // ── Pass 1: sample the background ring AROUND the bbox ───────────────────
    // We sample a border band of thickness `bgBand` px on each side.
    // This gives us the ambient colors we want to subtract from the object.
    const bgBand   = Math.max(10, Math.round(Math.min(w, h) * 0.15));
    const bgColors = [];

    const bgRegions = [
        // above
        { x0: Math.max(0, Math.floor(x)),         y0: Math.max(0, Math.floor(y - bgBand)),
          x1: Math.min(pw, Math.floor(x + w)),     y1: Math.max(0, Math.floor(y)) },
        // below
        { x0: Math.max(0, Math.floor(x)),         y0: Math.min(ph, Math.floor(y + h)),
          x1: Math.min(pw, Math.floor(x + w)),     y1: Math.min(ph, Math.floor(y + h + bgBand)) },
        // left
        { x0: Math.max(0, Math.floor(x - bgBand)), y0: Math.max(0, Math.floor(y)),
          x1: Math.max(0, Math.floor(x)),           y1: Math.min(ph, Math.floor(y + h)) },
        // right
        { x0: Math.min(pw, Math.floor(x + w)),     y0: Math.max(0, Math.floor(y)),
          x1: Math.min(pw, Math.floor(x + w + bgBand)), y1: Math.min(ph, Math.floor(y + h)) },
    ];

    for (const reg of bgRegions) {
        for (let py = reg.y0; py < reg.y1; py += step) {
            for (let px = reg.x0; px < reg.x1; px += step) {
                bgColors.push(readPixel(px, py));
            }
        }
    }

    // Cluster background colors so `isBackground()` is fast
    // (we keep up to 12 representative bg colors via simple greedy merging)
    const bgClusters = [];
    for (const c of bgColors) {
        const close = bgClusters.find(cl => dist(cl, c) < 30);
        if (close) {
            // running average
            close.r = Math.round((close.r + c.r) / 2);
            close.g = Math.round((close.g + c.g) / 2);
            close.b = Math.round((close.b + c.b) / 2);
        } else if (bgClusters.length < 12) {
            bgClusters.push({ ...c });
        }
    }

    // A pixel is considered background if it's within BG_THRESH of any bg cluster
    const BG_THRESH = 40;
    function isBackground(r, g, b) {
        return bgClusters.some(cl => dist(cl, { r, g, b }) < BG_THRESH);
    }

    // ── Pass 2: bucket the object pixels, skipping background-like colors ────
    const inset = 5;
    const x0 = Math.max(0,  Math.floor(x + inset));
    const y0 = Math.max(0,  Math.floor(y + inset));
    const x1 = Math.min(pw, Math.floor(x + w - inset));
    const y1 = Math.min(ph, Math.floor(y + h - inset));

    const buckets = new Map();

    for (let py = y0; py < y1; py += step) {
        for (let px = x0; px < x1; px += step) {
            const { r, g, b } = readPixel(px, py);

            const sat        = Math.max(r, g, b) - Math.min(r, g, b);
            const brightness = (r + g + b) / 3;
            if (brightness < 25 || brightness > 245 || sat < 18) continue;

            // Skip pixels that look like the background
            if (isBackground(r, g, b)) continue;

            const key    = `${Math.round(r/quant)*quant},${Math.round(g/quant)*quant},${Math.round(b/quant)*quant}`;
            const weight = sat + 1;

            if (!buckets.has(key)) buckets.set(key, { rSum: 0, gSum: 0, bSum: 0, weightSum: 0, count: 0 });
            const bucket = buckets.get(key);
            bucket.rSum      += r * weight;
            bucket.gSum      += g * weight;
            bucket.bSum      += b * weight;
            bucket.weightSum += weight;
            bucket.count     += 1;
        }
    }

    if (buckets.size === 0) {
        return [{ r: 200, g: 200, b: 200 }, { r: 160, g: 160, b: 160 }, { r: 120, g: 120, b: 120 }];
    }

    // ── Rank, deduplicate, and return ────────────────────────────────────────
    const colors = Array.from(buckets.values())
        .map((b) => ({
            r:     Math.round(b.rSum / b.weightSum),
            g:     Math.round(b.gSum / b.weightSum),
            b:     Math.round(b.bSum / b.weightSum),
            score: b.count * 0.7 + b.weightSum * 0.3,
        }))
        .sort((a, b) => b.score - a.score);

    const merged = [];
    for (const color of colors) {
        const tooClose = merged.some(c => dist(c, color) < 35);
        if (!tooClose) merged.push(color);
        if (merged.length >= count) break;
    }

    while (merged.length < count) merged.push(merged.at(-1) ?? { r: 200, g: 200, b: 200 });

    return merged.map(({ r, g, b }) => ({ r, g, b }));
}

// ==========================================
// UTILITAIRES & ÉVÉNEMENTS
// ==========================================
function estImmobile(box1, box2, tolerance) { return Math.abs(box1.x - box2.x) < tolerance && Math.abs(box1.y - box2.y) < tolerance; }
function mettreAJourStatut(texte, couleur) { statusDiv.innerText = texte; statusDiv.style.color = couleur; }

// --- ENTRAÎNEMENT DE L'IA ---
document.getElementById('btn-train').addEventListener('click', () => {
    initAudio(); 
    if (ancienneBoiteObjet) {
        const labelChoisi = document.getElementById('train-select').value;
        const logits = obtenirFeaturesDeLaBox(ancienneBoiteObjet);
        
        classifieurKNN.addExample(logits, labelChoisi);
        logits.dispose(); 
        
        mettreAJourCompteursKNN();
        
        let btn = document.getElementById('btn-train');
        btn.innerText = "Ajouté !"; btn.style.background = "#fff";
        setTimeout(() => { btn.innerText = "Capturer cette apparence"; btn.style.background = "#00ffcc"; }, 300);
    } else {
        alert("Aucun objet détecté ! Placez un objet devant la caméra.");
    }
});

document.getElementById('btn-reset').addEventListener('click', () => {
    const labelChoisi = document.getElementById('train-select').value;
    const counts = classifieurKNN.getClassExampleCount();
    
    if (counts[labelChoisi] > 0) {
        classifieurKNN.clearClass(labelChoisi);
        mettreAJourCompteursKNN();
        
        let btn = document.getElementById('btn-reset');
        btn.innerText = "Effacé !";
        setTimeout(() => { btn.innerText = "Supprimer la mémoire de cet objet"; }, 1000);
    }
});

// --- UI SLIDERS & CHECKBOX ---
document.getElementById('showVideo').addEventListener('change', (e) => {
    PARAMS.showVideo = e.target.checked;
});

document.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', (e) => {
        PARAMS[e.target.id] = parseFloat(e.target.value);
        let idVal = `val-${e.target.id.toLowerCase()}`;
        let unit = "";
        if (['distx', 'disty', 'tolmouvement', 'shieldmargin'].includes(e.target.id.toLowerCase())) unit = "px";
        else if (['crushpercent', 'minscore', 'shieldheightpct'].includes(e.target.id.toLowerCase())) unit = "%";
        
        let elem = document.getElementById(idVal);
        if (elem) elem.innerText = e.target.value + unit;
    });
});
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        PARAMS.showUI = !PARAMS.showUI;
        uiPanel.classList.toggle('hidden');
    }

    if (e.code === 'KeyH') {
        PARAMS.hideVideoBackground = !PARAMS.hideVideoBackground;
        syncBlackMaskCanvas();
    }
});

init();