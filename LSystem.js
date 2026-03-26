/**
 * LSystem — probabilistic, lerp-animated L-System plant.
 *
 * Usage:
 *   const tree = new LSystem(p, x, y, r, g, b);
 *   // in draw():
 *   tree.update();
 *   tree.draw(p);
 */
export class LSystem {
  // ── Configuration ──────────────────────────────────────────────────────────

  static RULES = {
    X: [
      { rule: "(F[+X][-X]FX)",   prob: 0.50 },
      { rule: "(F[-X]FX)",        prob: 0.05 },
      { rule: "(F[+X]FX)",        prob: 0.05 },
      { rule: "(F[++X][-X]FX)",   prob: 0.10 },
      { rule: "(F[+X][--X]FX)",   prob: 0.10 },
      { rule: "(F[+X][-X]FXA)",   prob: 0.10 },
      { rule: "(F[+X][-X]FXB)",   prob: 0.10 },
    ],
    F: [
      { rule: "F(F)",  prob: 0.85 },
      { rule: "F(FF)", prob: 0.05 },
      { rule: "F",     prob: 0.10 },
    ],
    // lerp markers are consumed during generation, not passed to drawRules
    "(": [{ rule: "", prob: 1 }],
    ")": [{ rule: "", prob: 1 }],
  };

  static LEN           = 5;    // px per segment
  static ANG           = 35;   // branch angle in degrees
  static MAX_GEN       = 5;
  static GROWTH_RATE   = 0.07;
  static AXIOM         = "X";

  // ── Constructor ────────────────────────────────────────────────────────────

  /**
   * @param {object} p  - p5 instance (used only inside draw())
   * @param {number} x  - root x position
   * @param {number} y  - root y position
 * @param {Array<{ r, g, b }>} [palette=[...]] - branch colors (dominant, secondary, tertiary)
 */
constructor(p, x, y, palette = [{ r: 255, g: 255, b: 255 }, { r: 200, g: 200, b: 200 }, { r: 150, g: 150, b: 150 }]) {
  this._p  = p;
  this._x  = x;
  this._y  = y;
  const [c0 = { r: 255, g: 255, b: 255 }, c1 = { r: 200, g: 200, b: 200 }, c2 = { r: 150, g: 150, b: 150 }] = palette;
  this._color0 = c0; // dominant
  this._color1 = c1; // secondary
  this._color2 = c2; // tertiary

    this._word          = LSystem.AXIOM;
    this._generation    = 0;
    this._growthPercent = 0;

    // Internal push/pop depth guard — reset automatically each draw pass
    this._pushDepth = 0;

    this._buildDrawRules();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _buildDrawRules() {
    const p   = this._p;
    const len = LSystem.LEN;
    const ang = LSystem.ANG;
    const r0   = this._color0.r;
    const g0   = this._color0.g;
    const b0   = this._color0.b;
    const r1   = this._color1.r;
    const g1   = this._color1.g;
    const b1   = this._color1.b;
    const r2   = this._color2.r;
    const g2   = this._color2.g;
    const b2   = this._color2.b;

    this._drawRules = {
      F: (t) => {
        p.stroke(r0, g0, b0);
        p.strokeWeight(10);
        p.line(0, 0, 0, -len * t);
        p.translate(0, -len * t);
      },
      "+": (t) => p.rotate(p.radians(-ang * t)),
      "-": (t) => p.rotate(p.radians( ang * t)),
      "[": ()  => { this._pushDepth++; p.push(); },
      "]": ()  => { if (this._pushDepth > 0) { this._pushDepth--; p.pop(); } },
      A: (t) => {
        p.noStroke();
        p.fill(r1, g1, b1);
        p.circle(0, 0, len * 5 * t);
      },
      B: (t) => {
        p.noStroke();
        p.fill(r2, g2, b2);
        p.circle(0, 0, len * 5 * t);
      },
      X: () => { /* terminal — no drawing */ },
    };
  }

  /** Expand the current word by one generation. */
  _nextGeneration() {
    if (this._growthPercent < 1) return;
    if (this._generation >= LSystem.MAX_GEN) return;

    this._word = this._generate(this._word);
    this._generation++;
    this._growthPercent = 0;
  }

  /** Apply rules to every character, returning the next word. */
  _generate(word) {
    let next = "";
    for (const c of word) {
      const rule = LSystem.RULES[c];
      if (rule === undefined) { next += c; continue; }
      next += this._chooseOne(rule);
    }
    return next;
  }

  /** Pick a rule from a weighted array. */
  _chooseOne(ruleSet) {
    let n = this._p.random();
    let t = 0;
    for (const { rule, prob } of ruleSet) {
      t += prob;
      if (t > n) return rule;
    }
    return "";
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Advance growth animation; call once per p5 draw() frame.
   */
  update() {
    if (this._growthPercent < 1) {
      const mod = this._generation + this._growthPercent;
      this._growthPercent += LSystem.GROWTH_RATE / Math.max(mod, 0.1);
      this._growthPercent  = Math.min(this._growthPercent, 1);
    } else {
      this._nextGeneration();
    }
  }

  /**
   * Render the current generation with lerp interpolation.
   * @param {object} p - p5 instance
   */
  draw(p) {
    const t = Math.min(Math.max(this._growthPercent, 0), 1);

    this._pushDepth = 0;   // guard reset before every render pass

    let lerpOn = false;

    p.push();
    p.translate(this._x, this._y);
    p.noFill();

    for (const c of this._word) {
      if (c === "(") { lerpOn = true;  continue; }
      if (c === ")") { lerpOn = false; continue; }

      const lerpT = lerpOn ? t : 1;

      if (c in this._drawRules) {
        this._drawRules[c](lerpT);
      }
    }

    // Safety: pop any unmatched pushes left over from a malformed word
    while (this._pushDepth > 0) { this._pushDepth--; p.pop(); }

    p.pop();
  }
}