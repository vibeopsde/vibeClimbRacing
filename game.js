"use strict";

// ════════════════════════════════════════
// VIBE CLIMB RACING — ENDLESS PROCEDURAL
// ════════════════════════════════════════

// ── Tunable Constants ──
const COIN_PICKUP_DIST_SQ = 1800;  // coin pickup distance² (dx²+dy² < this)
const FUEL_PICKUP_DIST_SQ = 2500;  // fuel pickup distance²
const FUEL_REFILL = 35;           // fuel restored per can
const COIN_GAP_MIN = 600;         // min gap between coins (5x rarer — factor 0.2)
const COIN_GAP_MAX = 1000;        // max gap between coins (5x rarer — factor 0.2)
const FUEL_GAP_MIN = 3000;        // min gap between fuel cans (intentionally rare)
const FUEL_GAP_MAX = 7000;        // max gap between fuel cans (intentionally rare)
const BASE_Y = 280;               // ground level (world Y)
const CAM_LERP_X = 0.08;           // camera follow lerp factor (X)
const CAM_LERP_Y = 0.06;           // camera follow lerp factor (Y)
const CAM_Y_MIN = -400;            // camera Y clamp (upper)
const CAM_Y_MAX = 200;             // camera Y clamp (lower)
const FLIP_DEATH_TIME = 0.3;       // seconds upside-down before death (near-instant, like original)
const LOOPING_BONUS = 10;         // coins awarded per full loop (360° rotation in air)
const MAX_SPRING = 15;            // max visual spring compression (px)

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let W, H, DPR;

// ── roundRect polyfill for older browsers (Chrome <99, Safari <16) ──
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (typeof r === "number") r = [r, r, r, r];
    else if (Array.isArray(r) && r.length === 1) r = [r[0], r[0], r[0], r[0]];
    this.beginPath();
    this.moveTo(x + r[0], y);
    this.arcTo(x + w, y, x + w, y + h, r[1]);
    this.arcTo(x + w, y + h, x, y + h, r[2]);
    this.arcTo(x, y + h, x, y, r[3]);
    this.arcTo(x, y, x + w, y, r[0]);
    this.closePath();
    return this;
  };
}

// ── Sound System (Web Audio API synth — zero assets) ──
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.muted = false;
  }

  // Must be called from a user gesture (click/touch) to satisfy autoplay policies
  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    this._startEngine();
  }

  _startEngine() {
    if (!this.ctx) return;
    // Stop previous engine if any
    if (this.engineOsc) { try { this.engineOsc.stop(); } catch (e) {} }
    this.engineOsc = this.ctx.createOscillator();
    this.engineGain = this.ctx.createGain();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 2;
    this.engineOsc.type = "square";
    this.engineOsc.frequency.value = 35;
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  }

  // Update engine sound: pitch & volume scale with speed
  updateEngine(vx, onGround) {
    if (!this.engineOsc || !this.engineGain || this.muted) return;
    const speed = Math.abs(vx);
    const freq = 30 + speed * 8; // 30Hz idle → ~140Hz at max speed
    const vol = onGround ? Math.min(0.15, 0.03 + speed * 0.009) : 0.015;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + speed * 30, this.ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.08);
  }

  _tone(freq, dur, type = "sine", vol = 0.2, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  _noise(dur, vol = 0.3, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }

  coin() { this._tone(880, 0.08, "sine", 0.15); this._tone(1320, 0.12, "sine", 0.15, 0.06); }
  fuel() { this._tone(440, 0.1, "triangle", 0.18); this._tone(660, 0.15, "triangle", 0.15, 0.08); }
  levelUp() { this._tone(523, 0.1, "square", 0.12); this._tone(659, 0.1, "square", 0.12, 0.1); this._tone(784, 0.2, "square", 0.12, 0.2); }
  crash() {
    // Kill engine sound first
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
    // Crash sound: dramatic descending tones + noise
    this._noise(0.5, 0.4);
    this._tone(200, 0.15, "sawtooth", 0.25, 0);
    this._tone(150, 0.15, "sawtooth", 0.25, 0.12);
    this._tone(100, 0.15, "sawtooth", 0.25, 0.24);
    this._tone(60, 0.4, "sawtooth", 0.3, 0.36);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.engineGain) this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.02, this.ctx.currentTime, 0.1);
    return this.muted;
  }
}
const sfx = new SoundSystem();

// ════════════════════════════════════════
// SAVE SYSTEM (localStorage)
// ════════════════════════════════════════
const SAVE_KEY = "vcr_save_v1";

const DEFAULT_SAVE = {
  name: null,
  wallet: 0,          // persistent coins across runs
  best: { distance: 0, level: 1, coins: 0 },
  upgrades: { motor: 0, tires: 0, tank: 0 },
};

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const s = JSON.parse(raw);
    return { ...DEFAULT_SAVE, ...s, best: { ...DEFAULT_SAVE.best, ...(s.best||{}) }, upgrades: { ...DEFAULT_SAVE.upgrades, ...(s.upgrades||{}) } };
  } catch (e) { return { ...DEFAULT_SAVE }; }
}

function saveSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData)); } catch (e) {}
}

let saveData = loadSave();

// ════════════════════════════════════════
// UPGRADES
// ════════════════════════════════════════
const UPGRADES = {
  motor: {
    name: "⚙️ Motor",
    desc: "+10% Beschleunigung pro Level",
    maxLevel: 5,
    costs: [100, 250, 500, 1000, 2000],
    apply: (lvl) => ({ engineFwd: 0.38 * (1 + 0.1 * lvl), engineBack: 0.45 * (1 + 0.1 * lvl) }),
  },
  tires: {
    name: "🛞 Reifen",
    desc: "+15% Bodenhaftung pro Level",
    maxLevel: 5,
    costs: [100, 250, 500, 1000, 2000],
    apply: (lvl) => ({ grip: 0.992 + 0.001 * lvl, slopeAlign: 0.10 + 0.02 * lvl }),
  },
  tank: {
    name: "⛽ Tank",
    desc: "+20% Tankkapazität, weniger Verbrauch",
    maxLevel: 5,
    costs: [100, 250, 500, 1000, 2000],
    apply: (lvl) => ({ maxFuel: 100 + 20 * lvl, drainRate: 0.05 * (1 - 0.08 * lvl), passiveDrain: 0.006 * (1 - 0.08 * lvl) }),
  },
};

function resize() {
  DPR = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ── Difficulty scaling — every 1000m the terrain gets rougher (smooth transition) ──
function difficultyAt(x) {
  const LEVEL_DIST = 10000;    // 1000m in world units (x is in decimeters)
  const TRANSITION = 500;     // smooth transition zone in world units
  const levelX = x / LEVEL_DIST;
  const baseLevel = Math.floor(levelX);
  const frac = levelX - baseLevel;
  // smoothstep: 0 at boundary start, 1 at boundary end, smooth in between
  const t = Math.max(0, Math.min(1, (frac * LEVEL_DIST - (LEVEL_DIST - TRANSITION)) / TRANSITION));
  const smooth = t * t * (3 - 2 * t);  // classic smoothstep
  return 1 + (baseLevel + smooth) * 0.35;
}

// ── Terrain generation: random control points with Catmull-Rom interpolation ──
// Replaces layered-sine noise. Control points are placed at random intervals
// with random-walk heights that drift freely (not centered on 0), producing
// organic terrain: real hills, valleys, plateaus — no visible "algorithm".
let controlPoints = []; // {x, y} in world coords

function resetTerrain() {
  // Start with a few random control points so terrain is interesting from the get-go
  // (flat zone x<400 still enforced by terrainHeight, so first point can be wild)
  controlPoints = [{ x: 0, y: BASE_Y }];
  // Pre-generate a few wild points so the terrain doesn't slowly ramp up
  let lastY = BASE_Y;
  for (let i = 1; i <= 5; i++) {
    const interval = 120 + Math.random() * 280;
    const nextX = controlPoints[i - 1].x + interval;
    const drift = (Math.random() - 0.5) * 160; // strong initial drift, no difficulty scaling
    const pull = (BASE_Y - lastY) * 0.08;
    lastY = lastY + drift + pull;
    controlPoints.push({ x: nextX, y: lastY });
  }
}

// Generate control points ahead of the given x-coordinate
function ensureControlPoints(upToX) {
  while (controlPoints[controlPoints.length - 1].x < upToX) {
    const last = controlPoints[controlPoints.length - 1];
    // Random interval between control points (varied → breaks regularity)
    const interval = 120 + Math.random() * 280; // 120-400 world units
    const nextX = last.x + interval;
    const diff = difficultyAt(nextX);
    // Random walk: drift from last Y, can go anywhere (not mean-reverted to 0)
    // Mild pull toward BASE_Y prevents runaway to extreme heights/depths
    const drift = (Math.random() - 0.5) * 130 * diff;
    const pull = (BASE_Y - last.y) * 0.10;
    controlPoints.push({ x: nextX, y: last.y + drift + pull });
  }
}

// Catmull-Rom spline interpolation between 4 control points
function catmullRom(y0, y1, y2, y3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * y1) +
    (-y0 + y2) * t +
    (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
    (-y0 + 3 * y1 - 3 * y2 + y3) * t3
  );
}

function terrainHeight(x) {
  if (x < 400) return BASE_Y;
  ensureControlPoints(x);
  // Binary search for the segment containing x
  const pts = controlPoints;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].x <= x) lo = mid; else hi = mid;
  }
  const p0 = pts[lo], p1 = pts[hi];
  const t = (x - p0.x) / (p1.x - p0.x);
  // Neighbors for Catmull-Rom (clamp at edges)
  const yPrev = pts[Math.max(0, lo - 1)].y;
  const yNext = pts[Math.min(pts.length - 1, hi + 1)].y;
  return catmullRom(yPrev, p0.y, p1.y, yNext, t);
}

// ── Terrain Manager ──
const SEGMENT_WIDTH = 6;
const VIEW_AHEAD = 2500;
const VIEW_BEHIND = 800;

class Terrain {
  constructor() {
    this.points = []; // {x, y}
    this.lastX = 0;
    this.init();
  }

  init() {
    this.points = [];
    this.lastX = 0;
    // Generate initial flat + terrain
    while (this.lastX < VIEW_AHEAD) {
      this.points.push({ x: this.lastX, y: terrainHeight(this.lastX) });
      this.lastX += SEGMENT_WIDTH;
    }
  }

  update(camX) {
    // Generate ahead
    const needX = camX + VIEW_AHEAD;
    while (this.lastX < needX) {
      this.points.push({ x: this.lastX, y: terrainHeight(this.lastX) });
      this.lastX += SEGMENT_WIDTH;
    }
    // NOTE: We do NOT trim behind — keeping all points allows driving backwards.
    // Memory is negligible: ~1700 points per 10km (each point = 2 numbers).
  }

  // Ground height at world x (binary search in points)
  groundAt(x) {
    const pts = this.points;
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x <= x) lo = mid; else hi = mid;
    }
    const t = (x - pts[lo].x) / (pts[hi].x - pts[lo].x);
    return pts[lo].y + (pts[hi].y - pts[lo].y) * t;
  }

  // Slope at world x
  slopeAt(x) {
    const dx = 5;
    return (this.groundAt(x + dx) - this.groundAt(x - dx)) / (2 * dx);
  }

  // Find index range of points visible on screen [camX-50, camX+W+50]
  // Uses binary search — O(log n) instead of O(n) per frame.
  visibleRange(camX, screenW) {
    const pts = this.points;
    const minX = camX - 50;
    const maxX = camX + screenW + 50;

    // Binary search for first point >= minX
    let lo = 0, hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x < minX) lo = mid + 1; else hi = mid;
    }
    const start = Math.max(0, lo - 1); // include one point before for lineTo continuity

    // Binary search for first point > maxX
    lo = start; hi = pts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x <= maxX) lo = mid + 1; else hi = mid;
    }
    const end = Math.min(pts.length, lo + 1); // include one point after

    return [start, end];
  }
}

// ── Car Physics ──
class Car {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.angVel = 0;
    this.wheelBase = 70;
    this.wheelRadius = 20;
    this.wheelOffset = this.wheelRadius; // wheels sit ON ground, not in it
    this.mass = 1.5;
    this.inertia = 4500;
    this.onGround = false;
    this.dead = false;
    this.flipTime = 0;
    this.airSpin = 0;          // accumulated rotation in air (for loop detection)

    // Visual suspension — spring compression per wheel (visual only, no physics impact)
    this.springL = 0;
    this.springR = 0;

    // Apply upgrades from save
    const u = saveData.upgrades;
    const mUp = UPGRADES.motor.apply(u.motor);
    const tUp = UPGRADES.tires.apply(u.tires);
    const fUp = UPGRADES.tank.apply(u.tank);
    this.engineFwd = mUp.engineFwd;
    this.engineBack = mUp.engineBack;
    this.grip = tUp.grip;
    this.slopeAlign = tUp.slopeAlign;
    this.maxFuel = fUp.maxFuel;
    this.drainRate = fUp.drainRate;
    this.passiveDrain = fUp.passiveDrain;
    this.fuel = this.maxFuel;
  }

  update(dt, terrain, input) {
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    const dts = dt * 60; // delta in "frame units"

    // ── Physics constants ──
    const GRAVITY = 0.40;
    const ENGINE_FWD = this.engineFwd;
    const ENGINE_BACK = this.engineBack;
    const AIR_DRAG = 0.995;
    const ANG_DAMP = 0.96;
    const MAX_VX = 14;

    // Forward direction (angle 0 = pointing right)
    const fwdX = Math.cos(this.angle);
    const fwdY = Math.sin(this.angle);

    // Gravity (always down in screen)
    this.vy += GRAVITY * dts;

    // Engine: on ground = full thrust along forward, in air = rotation only
    if (gas && this.fuel > 0) {
      this.fuel -= this.drainRate * dts;
      if (this.onGround) {
        this.vx += fwdX * ENGINE_FWD * dts;
        this.vy += fwdY * ENGINE_FWD * dts;
      }
    }
    if (brake && this.fuel > 0) {
      this.fuel -= this.drainRate * 0.5 * dts;
      if (this.onGround) {
        this.vx -= fwdX * ENGINE_BACK * dts;
        this.vy -= fwdY * ENGINE_BACK * dts;
      }
    }

    // Passive fuel drain
    this.fuel -= this.passiveDrain * dts;

    // Air drag
    this.vx *= AIR_DRAG;
    this.vy *= 0.999;

    // Speed clamp
    if (this.vx > MAX_VX) this.vx = MAX_VX;
    if (this.vx < -MAX_VX * 0.6) this.vx = -MAX_VX * 0.6;

    // Angular damping + air control
    this.angVel *= ANG_DAMP;
    if (!this.onGround) {
      // Air control: gentle nudge, capped — for wheelie/endo adjustment, not death spins
      // Loopings happen from terrain launches + angular momentum, NOT from holding gas
      const AIR_CONTROL = 0.002;
      if (gas) this.angVel = Math.max(this.angVel - AIR_CONTROL * dts, -0.04);
      if (brake) this.angVel = Math.min(this.angVel + AIR_CONTROL * dts, 0.04);
    }

    // Integrate
    this.x += this.vx * dts;
    this.y += this.vy * dts;
    this.angle += this.angVel * dts;

    // ── Loop detection: accumulate angular velocity while airborne ──
    // Use angVel*dts (true rotation) NOT angle-lastAngle (corrupted by slope alignment)
    if (!this.onGround) {
      this.airSpin += this.angVel * dts;
    } else {
      this.airSpin = 0;
    }
    this.loopCompleted = Math.abs(this.airSpin) >= Math.PI * 2;

    // ── Simple collision (stable snap) + visual suspension ──
    const halfWB = this.wheelBase / 2;
    const wheelOffset = this.wheelOffset;
    const restLen = wheelOffset + this.wheelRadius;

    // Wheel world positions for ground detection
    const wlX = this.x - fwdX * halfWB - fwdY * wheelOffset;
    const wrX = this.x + fwdX * halfWB - fwdY * wheelOffset;

    // Ground height under each wheel
    const groundL = terrain.groundAt(wlX);
    const groundR = terrain.groundAt(wrX);
    const avgGround = (groundL + groundR) / 2;

    // Car bottom (at rest, no compression)
    const carBottom = this.y + restLen;

    this.onGround = false;

    // Snap to ground when at/below terrain
    if (carBottom >= avgGround) {
      this.y = avgGround - restLen;
      this.onGround = true;

      // Terrain-following vy (allows launches off crests)
      const slope = terrain.slopeAt(this.x);
      this.vy = slope * this.vx;

      // Rolling friction (upgradeable)
      this.vx *= this.grip;

      // ── Visual suspension: compress springs based on terrain unevenness ──
      // Each wheel compresses based on how far below the avg ground its side is
      const groundDiff = groundR - groundL; // positive = right side lower
      const compression = Math.min(Math.abs(groundDiff) * 0.3, MAX_SPRING);
      // Smoothly interpolate spring compression (visual only — no physics impact)
      if (groundDiff > 0) {
        // Right wheel hits higher ground → compress right
        this.springR += (compression - this.springR) * 0.15 * dts;
        this.springL *= 0.9;
      } else {
        this.springL += (compression - this.springL) * 0.15 * dts;
        this.springR *= 0.9;
      }
      // Landing impact: compress both springs based on vy at touchdown
      if (this.vy < -3) {
        const impact = Math.min(Math.abs(this.vy) * 0.8, MAX_SPRING);
        this.springL += (impact - this.springL) * 0.2;
        this.springR += (impact - this.springR) * 0.2;
      }
    } else {
      // In air — springs rebound to rest
      this.springL *= 0.88;
      this.springR *= 0.88;
    }

    // ── Slope alignment when grounded (skip if upside-down!) ──
    if (this.onGround) {
      // Check if car is upside-down (roof on ground) — tighter threshold matches flip check
      const normAngle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const upsideDown = normAngle > Math.PI * 0.75 && normAngle < Math.PI * 1.25;
      if (!upsideDown) {
        this.angVel *= 0.6;
        // Target angle = terrain slope angle
        const slope = terrain.slopeAt(this.x);
        const targetAngle = Math.atan2(slope, 1);
        // Smoothly steer car angle toward slope (gentler = more airtime off crests)
        let diff = targetAngle - this.angle;
        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        this.angle += diff * this.slopeAlign * dts;
      } else {
        // Upside down on ground — no slope correction, let flip timer run
        this.angVel *= 0.95;
      }
    } else {
      // Airborne — no slope correction
    }

    // Clamp fuel
    if (this.fuel < 0) this.fuel = 0;

    // Death: flipped AND on ground → game over (looping in air is fine!)
    // Use tighter threshold so near-miss landings don't trigger death
    const normAngle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const flipped = normAngle > Math.PI * 0.75 && normAngle < Math.PI * 1.25;
    if (flipped && this.onGround) {
      this.flipTime += dt;
      if (this.flipTime > FLIP_DEATH_TIME) this.dead = true;
    } else {
      this.flipTime = 0;
    }
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;

    // ── Wheels (drawn first, behind body) with suspension compression ──
    const fwdX = Math.cos(this.angle);
    const fwdY = Math.sin(this.angle);
    const perpX = -fwdY;
    const perpY = fwdX;
    const halfWB = this.wheelBase / 2;
    const wy = this.wheelOffset;

    for (const sign of [-1, 1]) {
      // Apply spring compression to wheel position (pushed up = compressed)
      const springComp = sign === -1 ? this.springL : this.springR;
      const suspOffset = wy - springComp; // wheel moves up when spring compresses
      const wx = this.x + fwdX * (halfWB * sign) + perpX * suspOffset;
      const wyy = this.y + fwdY * (halfWB * sign) + perpY * suspOffset;
      ctx.save();
      ctx.translate(wx - camX, wyy - camY);
      ctx.rotate(this.angle);

      // Tire (dark rubber with slight texture)
      ctx.fillStyle = "#1a1a1a";
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.wheelRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tread marks around tire
      ctx.strokeStyle = "#2a2a2a";
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = this.wheelRadius - 2;
        const r2 = this.wheelRadius - 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }

      // Hubcap (silver)
      ctx.fillStyle = "#bdc3c7";
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#95a5a6";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Spokes (rotate with speed)
      const spin = (this.x / this.wheelRadius) * sign;
      ctx.strokeStyle = "#7f8c8d";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const a = spin + (i * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 8, Math.sin(a) * 8);
        ctx.stroke();
      }

      // Center cap
      ctx.fillStyle = "#ecf0f1";
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // ── Car body (drawn after wheels) ──
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    // Suspension arms (connecting wheels to body)
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sign * 25, 0);
      ctx.lineTo(sign * 35, this.wheelOffset - 4);
      ctx.stroke();
    }

    // Main body — rounded red chassis with gradient
    const bodyGrad = ctx.createLinearGradient(0, -20, 0, 10);
    bodyGrad.addColorStop(0, "#e74c3c");
    bodyGrad.addColorStop(1, "#c0392b");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#922b21";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-40, -20, 80, 24, 8);
    ctx.fill();
    ctx.stroke();

    // Lower body skid plate (darker)
    ctx.fillStyle = "#7f8c8d";
    ctx.beginPath();
    ctx.roundRect(-38, 0, 76, 6, 3);
    ctx.fill();

    // Hood (front, sloped)
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.moveTo(20, -20);
    ctx.lineTo(40, -20);
    ctx.lineTo(42, -28);
    ctx.lineTo(22, -28);
    ctx.closePath();
    ctx.fill();

    // Cabin (darker, rounded)
    const cabinGrad = ctx.createLinearGradient(0, -40, 0, -20);
    cabinGrad.addColorStop(0, "#34495e");
    cabinGrad.addColorStop(1, "#2c3e50");
    ctx.fillStyle = cabinGrad;
    ctx.beginPath();
    ctx.roundRect(-18, -38, 38, 20, 6);
    ctx.fill();

    // Windshield (tinted blue)
    const winGrad = ctx.createLinearGradient(0, -36, 0, -22);
    winGrad.addColorStop(0, "#85c1e9");
    winGrad.addColorStop(1, "#5dade2");
    ctx.fillStyle = winGrad;
    ctx.beginPath();
    ctx.roundRect(-14, -35, 16, 14, 3);
    ctx.fill();

    // Side window
    ctx.fillStyle = "#aed6f1";
    ctx.beginPath();
    ctx.roundRect(4, -35, 14, 14, 3);
    ctx.fill();

    // Roll bar (behind cabin)
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-18, -38);
    ctx.lineTo(-18, -20);
    ctx.stroke();

    // Driver head with helmet
    ctx.fillStyle = "#f9e79f";
    ctx.beginPath();
    ctx.arc(-2, -28, 6, 0, Math.PI * 2);
    ctx.fill();
    // Helmet
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(-2, -30, 7, Math.PI, 0);
    ctx.fill();
    // Helmet visor
    ctx.fillStyle = "#2c3e50";
    ctx.fillRect(-2, -31, 6, 3);

    // Headlight (front)
    ctx.fillStyle = "#fffacd";
    ctx.beginPath();
    ctx.arc(38, -12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f39c12";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Taillight (back)
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(-38, -12, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c0392b";
    ctx.stroke();

    // Exhaust pipe (back)
    ctx.fillStyle = "#7f8c8d";
    ctx.fillRect(-44, -8, 6, 4);

    // Side detail line
    ctx.strokeStyle = "#a93226";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-35, -8);
    ctx.lineTo(35, -8);
    ctx.stroke();

    ctx.restore();
  }
}

// ── Coins ──
class CoinSystem {
  constructor() { this.coins = []; this.collected = 0; this.nextSpawnX = 300; }

  update(camX, terrain, carX) {
    // Use carX (not camX) for spawn frontier — camX lags behind the car,
    // so camX + VIEW_AHEAD may be beyond generated terrain, causing
    // groundAt() to return stale/wrong heights → coins spawn underground.
    const spawnFrontier = Math.max(camX, carX) + VIEW_AHEAD;
    while (this.nextSpawnX < spawnFrontier) {
      // Random gap between coins
      const gap = COIN_GAP_MIN + Math.random() * (COIN_GAP_MAX - COIN_GAP_MIN);
      this.nextSpawnX += gap;
      // Ensure terrain is generated at spawn position before querying height
      terrain.update(this.nextSpawnX);
      // Place coin slightly above terrain
      const gy = terrain.groundAt(this.nextSpawnX);
      this.coins.push({
        x: this.nextSpawnX,
        y: gy - 50 - Math.random() * 40,
        collected: false,
        phase: Math.random() * Math.PI * 2,
      });
    }
    // Remove collected/old — in-place removal (no new array per frame)
    let w = 0;
    for (let r = 0; r < this.coins.length; r++) {
      const c = this.coins[r];
      if (c.collected || c.x <= camX - VIEW_BEHIND) continue;
      this.coins[w++] = c;
    }
    this.coins.length = w;
  }

  checkCollect(car) {
    for (const c of this.coins) {
      if (c.collected) continue;
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      if (dx * dx + dy * dy < COIN_PICKUP_DIST_SQ) {
        c.collected = true;
        this.collected++;
        sfx.coin();
      }
    }
  }

  draw(ctx, camX, camY, time) {
    for (const c of this.coins) {
      if (c.collected) continue;
      const sx = c.x - camX;
      const sy = c.y - camY + Math.sin(time * 3 + c.phase) * 5;
      ctx.fillStyle = "#f1c40f";
      ctx.strokeStyle = "#f39c12";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f39c12";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("$", sx, sy);
    }
  }
}

// ── Fuel cans ──
class FuelSystem {
  constructor() { this.cans = []; this.nextSpawnX = 800; }

  update(camX, terrain, carX) {
    // Use carX (not camX) for spawn frontier — camX lags behind the car,
    // so camX + VIEW_AHEAD may be beyond generated terrain, causing
    // groundAt() to return stale/wrong heights → fuels spawn underground.
    const spawnFrontier = Math.max(camX, carX) + VIEW_AHEAD;
    while (this.nextSpawnX < spawnFrontier) {
      const gap = FUEL_GAP_MIN + Math.random() * (FUEL_GAP_MAX - FUEL_GAP_MIN);
      this.nextSpawnX += gap;
      // Ensure terrain is generated at spawn position before querying height
      terrain.update(this.nextSpawnX);
      const gy = terrain.groundAt(this.nextSpawnX);
      this.cans.push({ x: this.nextSpawnX, y: gy - 30, collected: false });
    }
    // Remove collected/old — in-place removal (no new array per frame)
    let w = 0;
    for (let r = 0; r < this.cans.length; r++) {
      const c = this.cans[r];
      if (c.collected || c.x <= camX - VIEW_BEHIND) continue;
      this.cans[w++] = c;
    }
    this.cans.length = w;
  }

  checkCollect(car) {
    for (const c of this.cans) {
      if (c.collected) continue;
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      if (dx * dx + dy * dy < FUEL_PICKUP_DIST_SQ) {
        c.collected = true;
        car.fuel = Math.min(car.maxFuel, car.fuel + FUEL_REFILL);
        sfx.fuel();
      }
    }
  }

  draw(ctx, camX, camY) {
    for (const c of this.cans) {
      if (c.collected) continue;
      const sx = c.x - camX;
      const sy = c.y - camY;
      // Can body
      ctx.fillStyle = "#e67e22";
      ctx.strokeStyle = "#d35400";
      ctx.lineWidth = 2;
      ctx.fillRect(sx - 14, sy - 20, 28, 36);
      ctx.strokeRect(sx - 14, sy - 20, 28, 36);
      // Cap
      ctx.fillStyle = "#d35400";
      ctx.fillRect(sx - 6, sy - 26, 12, 6);
      // Label
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⛽", sx, sy - 2);
    }
  }
}

// ── Clouds (parallax) ──
class Clouds {
  constructor() {
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      this.clouds.push({
        x: i * 350 + Math.random() * 200,
        y: 40 + Math.random() * 140,
        size: 40 + Math.random() * 50,
        speed: 0.15 + Math.random() * 0.15,
      });
    }
  }
  draw(ctx, camX) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (const c of this.clouds) {
      const sx = c.x - camX * c.speed;
      // Wrap
      const wrappedX = ((sx % (W + 300)) + W + 300) % (W + 300) - 150;
      ctx.beginPath();
      ctx.arc(wrappedX, c.y, c.size, 0, Math.PI * 2);
      ctx.arc(wrappedX + c.size * 0.6, c.y + 10, c.size * 0.7, 0, Math.PI * 2);
      ctx.arc(wrappedX - c.size * 0.6, c.y + 10, c.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── Game State ──
let terrain, car, coins, fuels, clouds;
let camX = 0, camY = 0;
let distance = 0;
let level = 1;
let lastTime = 0;
let gameTime = 0;
const input = { gas: false, brake: false };

// ── Run tracking (for end-of-run elevation profile) ──
let runTrack = [];     // sampled terrain heights: {x, y, level}
let runPickups = [];    // coin/fuel pickup positions: {x, y, type}
let runCrashX = 0;      // where the run ended
const TRACK_SAMPLE_INTERVAL = 50; // sample terrain every 50 world units (~5m)

function initGame() {
  // New random terrain per run
  resetTerrain();
  terrain = new Terrain();
  car = new Car(100, BASE_Y - 100);
  coins = new CoinSystem();
  fuels = new FuelSystem();
  clouds = new Clouds();
  camX = 0;
  camY = 0;
  distance = 0;
  level = 1;
  gameTime = 0;
  runTrack = [];
  runPickups = [];
  runCrashX = 0;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// ── Main Loop ──
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  if (!car.dead) {
    gameTime += dt;
    update(dt);
    render();
    requestAnimationFrame(loop);
  } else {
    gameOver();
  }
}

function update(dt) {
  terrain.update(car.x);
  car.update(dt, terrain, input);
  sfx.updateEngine(car.vx, car.onGround);
  coins.update(camX, terrain, car.x);
  fuels.update(camX, terrain, car.x);

  // ── Track terrain height for end-of-run profile ──
  const trackX = car.x - (car.x % TRACK_SAMPLE_INTERVAL);
  if (runTrack.length === 0 || trackX > runTrack[runTrack.length - 1].x) {
    runTrack.push({ x: car.x, y: terrain.groundAt(car.x), level: level });
  }

  // Record pickups for the profile (before checkCollect removes them)
  // We hook into the collection by checking what gets collected this frame
  const preCoins = coins.collected;
  const preFuel = car.fuel;
  coins.checkCollect(car);
  fuels.checkCollect(car);
  if (coins.collected > preCoins) {
    runPickups.push({ x: car.x, y: car.y, type: "coin" });
  }
  if (car.fuel > preFuel) {
    runPickups.push({ x: car.x, y: car.y, type: "fuel" });
  }

  // Camera follows car (smooth lerp, clamped to prevent runaway)
  const targetCamX = car.x - W * 0.35;
  const targetCamY = car.y - H * 0.55;
  camX += (targetCamX - camX) * CAM_LERP_X;
  camY += (targetCamY - camY) * CAM_LERP_Y;
  // Hard clamp camera Y so it never flies off into the sky
  if (camY < CAM_Y_MIN) camY = CAM_Y_MIN;
  if (camY > CAM_Y_MAX) camY = CAM_Y_MAX;

  distance = Math.max(distance, Math.floor(car.x / 10));

  // ── Looping bonus: 360° rotation in air → bonus coins ──
  if (car.loopCompleted) {
    coins.collected += LOOPING_BONUS;
    showLevelUp(0, LOOPING_BONUS);  // reuse popup with level=0 to signal "Looping!"
    sfx.levelUp();
    car.airSpin = 0;                // reset so consecutive loops count
    car.loopCompleted = false;
  }

  // ── Level-Up every 1000m ──
  const newLevel = 1 + Math.floor(distance / 1000);
  if (newLevel > level) {
    const bonus = (newLevel - level) * 10 * newLevel; // cumulative bonus for skipped levels
    level = newLevel;
    coins.collected += bonus;
    showLevelUp(level, bonus);
    sfx.levelUp();
  }

  // Update HUD
  document.getElementById("dist").textContent = distance;
  document.getElementById("coins").textContent = coins.collected;
  document.getElementById("fuel-bar-fill").style.width = (car.fuel / car.maxFuel * 100) + "%";
  document.getElementById("level").textContent = level;

  // Check game over conditions
  if (car.fuel <= 0 && Math.abs(car.vx) < 0.3) {
    car.dead = true;
  }
}

function showLevelUp(lvl, bonus) {
  const el = document.getElementById("levelup");
  el.textContent = lvl === 0
    ? `🔄 Looping!  +${bonus} Taler`
    : `⭐ Level ${lvl}!  +${bonus} Taler`;
  el.classList.remove("show");
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add("show");
}

function render() {
  // Sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#87CEEB");
  grad.addColorStop(0.6, "#B0E0E6");
  grad.addColorStop(1, "#E0F6FF");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Far hills (parallax background)
  ctx.fillStyle = "rgba(46, 139, 87, 0.3)";
  ctx.beginPath();
  const camXbg = camX * 0.3;
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const wx = x + camXbg;
    const y = BASE_Y + 100 + Math.sin(wx * 0.003) * 60 + Math.sin(wx * 0.007) * 30;
    ctx.lineTo(x, y - camY * 0.3);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Mid hills
  ctx.fillStyle = "rgba(34, 139, 34, 0.4)";
  ctx.beginPath();
  const camXmid = camX * 0.6;
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) {
    const wx = x + camXmid;
    const y = BASE_Y + 50 + Math.sin(wx * 0.004 + 1) * 50 + Math.sin(wx * 0.009) * 25;
    ctx.lineTo(x, y - camY * 0.6);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Clouds
  clouds.draw(ctx, camX);

  // Terrain
  ctx.fillStyle = "#8B6F47";
  ctx.strokeStyle = "#6B4E2F";
  ctx.lineWidth = 3;

  // Draw terrain as filled polygon
  ctx.beginPath();
  const pts = terrain.points;
  const [tStart, tEnd] = terrain.visibleRange(camX, W);
  for (let i = tStart; i < tEnd; i++) {
    const sx = pts[i].x - camX;
    if (i === tStart) ctx.moveTo(sx, pts[i].y - camY);
    else ctx.lineTo(sx, pts[i].y - camY);
  }
  ctx.lineTo(W + 50, H + 100);
  ctx.lineTo(-50, H + 100);
  ctx.closePath();
  ctx.fillStyle = "#7B5B3B";
  ctx.fill();

  // Grass layer on top of terrain
  ctx.beginPath();
  for (let i = tStart; i < tEnd; i++) {
    const sx = pts[i].x - camX;
    if (i === tStart) ctx.moveTo(sx, pts[i].y - camY);
    else ctx.lineTo(sx, pts[i].y - camY);
  }
  ctx.strokeStyle = "#4CAF50";
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.stroke();
  // thinner darker green on top
  ctx.strokeStyle = "#388E3C";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Coins & fuel
  coins.draw(ctx, camX, camY, gameTime);
  fuels.draw(ctx, camX, camY);

  // Car
  car.draw(ctx, camX, camY);
}

function gameOver() {
  sfx.crash();
  runCrashX = car.x;

  // Persist run results
  saveData.wallet += coins.collected;
  if (distance > saveData.best.distance) saveData.best.distance = distance;
  if (level > saveData.best.level) saveData.best.level = level;
  if (coins.collected > saveData.best.coins) saveData.best.coins = coins.collected;
  saveSave();

  // ── Render elevation profile ──
  drawRunProfile();

  // ── Stats below profile ──
  const coinPickups = runPickups.filter(p => p.type === "coin").length;
  const fuelPickups = runPickups.filter(p => p.type === "fuel").length;
  const statsEl = document.getElementById("profile-stats");
  statsEl.innerHTML = `
    <div class="row">
      <span class="stat">📏 <b>${distance} m</b></span>
      <span class="stat">⭐ Lvl <b>${level}</b></span>
      <span class="stat">🪙 <b>${coins.collected}</b></span>
    </div>
    <div class="row">
      <span class="stat">🛞 ${coinPickups}× Münzen</span>
      <span class="stat">⛽ ${fuelPickups}× Tank</span>
      <span class="stat">💰 Konto: <b>${saveData.wallet}</b></span>
    </div>
  `;
  document.getElementById("gameover").classList.remove("hide");
}

function drawRunProfile() {
  const cv = document.getElementById("profile-canvas");
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.min(440, window.innerWidth - 60);
  // Scale canvas height with distance so the profile stays readable on long runs
  const distMeters = Math.max(distance, 100);
  const ch = Math.min(280, 140 + Math.floor(distMeters / 1000) * 24);
  cv.width = cw * dpr;
  cv.height = ch * dpr;
  cv.style.width = cw + "px";
  cv.style.height = ch + "px";
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const padL = 36, padR = 12, padT = 14, padB = 22;
  const plotW = cw - padL - padR;
  const plotH = ch - padT - padB;

  // World → screen mapping
  const maxX = Math.max(runCrashX, 100);
  const trackYs = runTrack.map(t => t.y);
  const yMin = Math.min(...trackYs) - 30;
  const yMax = Math.max(...trackYs) + 30;
  const yRange = Math.max(yMax - yMin, 50);
  const toX = (wx) => padL + (wx / maxX) * plotW;
  const toY = (wy) => padT + (1 - (wy - yMin) / yRange) * plotH;

  // ── Background ──
  c.fillStyle = "rgba(0,0,0,0.25)";
  c.fillRect(padL, padT, plotW, plotH);

  // ── Grid lines (every 1000m) ──
  c.strokeStyle = "rgba(255,255,255,0.08)";
  c.lineWidth = 1;
  c.fillStyle = "rgba(255,255,255,0.4)";
  c.font = "9px sans-serif";
  c.textAlign = "center";
  for (let m = 0; m <= maxX / 10; m += 1000) {
    const wx = m * 10;
    const sx = toX(wx);
    c.beginPath();
    c.moveTo(sx, padT);
    c.lineTo(sx, padT + plotH);
    c.stroke();
    if (m > 0 && m < maxX / 10) {
      c.fillText(m + "m", sx, ch - 6);
    }
  }

  // ── Level boundary markers (vertical dashed lines) ──
  c.strokeStyle = "rgba(255,215,0,0.25)";
  c.setLineDash([3, 3]);
  for (let lvl = 1; lvl <= level; lvl++) {
    const boundaryX = lvl * 10000;
    if (boundaryX > 0 && boundaryX < maxX) {
      const sx = toX(boundaryX);
      c.beginPath();
      c.moveTo(sx, padT);
      c.lineTo(sx, padT + plotH);
      c.stroke();
    }
  }
  c.setLineDash([]);

  // ── Terrain fill (gradient: brown earth → green grass top) ──
  if (runTrack.length > 1) {
    c.beginPath();
    c.moveTo(toX(runTrack[0].x), padT + plotH);
    for (const t of runTrack) {
      c.lineTo(toX(t.x), toY(t.y));
    }
    c.lineTo(toX(runTrack[runTrack.length - 1].x), padT + plotH);
    c.closePath();
    const terrainGrad = c.createLinearGradient(0, padT, 0, padT + plotH);
    terrainGrad.addColorStop(0, "rgba(76,175,80,0.35)");
    terrainGrad.addColorStop(0.15, "rgba(139,111,71,0.3)");
    terrainGrad.addColorStop(1, "rgba(40,30,20,0.5)");
    c.fillStyle = terrainGrad;
    c.fill();

    // Terrain outline (grass-green stroke on top)
    c.beginPath();
    for (let i = 0; i < runTrack.length; i++) {
      const t = runTrack[i];
      const sx = toX(t.x), sy = toY(t.y);
      if (i === 0) c.moveTo(sx, sy);
      else c.lineTo(sx, sy);
    }
    c.strokeStyle = "#4CAF50";
    c.lineWidth = 2;
    c.lineJoin = "round";
    c.stroke();
  }

  // ── Pickup markers ──
  for (const p of runPickups) {
    if (p.x > maxX) continue;
    const sx = toX(p.x);
    const sy = toY(p.y);
    if (p.type === "coin") {
      c.fillStyle = "#f1c40f";
      c.beginPath();
      c.arc(sx, sy, 2.5, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillStyle = "#e67e22";
      c.beginPath();
      c.arc(sx, sy, 3.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#d35400";
      c.lineWidth = 1;
      c.stroke();
    }
  }

  // ── Crash site marker (red X) ──
  if (runCrashX > 0 && runCrashX <= maxX) {
    const sx = toX(runCrashX);
    const groundY = toY(terrain.groundAt(runCrashX));
    c.strokeStyle = "#ff4444";
    c.lineWidth = 2.5;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(sx - 5, groundY - 8);
    c.lineTo(sx + 5, groundY + 2);
    c.moveTo(sx + 5, groundY - 8);
    c.lineTo(sx - 5, groundY + 2);
    c.stroke();
    // Label
    c.fillStyle = "#ff4444";
    c.font = "bold 9px sans-serif";
    c.textAlign = "center";
    c.fillText("💥", sx, groundY - 12);
  }

  // ── Y-axis labels (height in m) ──
  c.fillStyle = "rgba(255,255,255,0.35)";
  c.font = "8px sans-serif";
  c.textAlign = "right";
  const yMid = (yMin + yMax) / 2;
  const heightMid = ((BASE_Y - yMid) / 10).toFixed(0);
  const heightTop = ((BASE_Y - yMax) / 10).toFixed(0);
  const heightBot = ((BASE_Y - yMin) / 10).toFixed(0);
  c.fillText(heightTop + "m", padL - 4, padT + 4);
  c.fillText(heightMid + "m", padL - 4, padT + plotH / 2 + 3);
  c.fillText(heightBot + "m", padL - 4, padT + plotH - 2);
}

// ── Input ──

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.code === "ArrowRight" || e.code === "KeyD") input.gas = true;
  if (e.code === "ArrowLeft" || e.code === "KeyA") input.brake = true;
});
document.addEventListener("keyup", (e) => {
  if (e.code === "ArrowRight" || e.code === "KeyD") input.gas = false;
  if (e.code === "ArrowLeft" || e.code === "KeyA") input.brake = false;
});

// Touch / mouse buttons
function bindButtons() {
  const gasEl = document.getElementById("btn-gas");
  const brakeEl = document.getElementById("btn-brake");

  function press(el, prop) {
    if (!el) return;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); input[prop] = true; });
    el.addEventListener("pointerup", (e) => { e.preventDefault(); input[prop] = false; });
    el.addEventListener("pointerleave", () => { input[prop] = false; });
    el.addEventListener("pointercancel", () => { input[prop] = false; });
  }
  press(gasEl, "gas");
  press(brakeEl, "brake");
}

// ── Start / Restart / Menu Flow ──

function showStartScreen() {
  document.getElementById("player-name").textContent = saveData.name || "Fahrer";
  document.getElementById("wallet-coins").textContent = saveData.wallet;
  document.getElementById("best-dist").textContent = saveData.best.distance;
  document.getElementById("best-level").textContent = saveData.best.level;
  document.getElementById("start").classList.remove("hide");
}

// Name input
document.getElementById("name-btn").addEventListener("click", () => {
  const name = document.getElementById("name-field").value.trim() || "Fahrer";
  saveData.name = name;
  saveSave();
  sfx.init();
  document.getElementById("nameinput").classList.add("hide");
  showStartScreen();
});

document.getElementById("name-field").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("name-btn").click();
});

// Start game
document.getElementById("start-btn").addEventListener("click", () => {
  document.getElementById("start").classList.add("hide");
  sfx.init();
  initGame();
});

// Restart
document.getElementById("restart-btn").addEventListener("click", () => {
  document.getElementById("gameover").classList.add("hide");
  sfx.init();
  initGame();
});

// Menu (back to start from game over)
document.getElementById("menu-btn").addEventListener("click", () => {
  document.getElementById("gameover").classList.add("hide");
  showStartScreen();
});

// Garage
document.getElementById("garage-btn").addEventListener("click", () => {
  document.getElementById("start").classList.add("hide");
  renderGarage();
  document.getElementById("garage").classList.remove("hide");
});

document.getElementById("garage-back").addEventListener("click", () => {
  document.getElementById("garage").classList.add("hide");
  showStartScreen();
});

function renderGarage() {
  document.getElementById("garage-coins").textContent = `🪙 ${saveData.wallet}`;
  const list = document.getElementById("upgrade-list");
  list.innerHTML = "";

  for (const [key, up] of Object.entries(UPGRADES)) {
    const lvl = saveData.upgrades[key];
    const maxed = lvl >= up.maxLevel;
    const cost = maxed ? 0 : up.costs[lvl];
    const canAfford = saveData.wallet >= cost && !maxed;

    const bars = "▮".repeat(lvl) + "▯".repeat(up.maxLevel - lvl);

    const card = document.createElement("div");
    card.className = "upgrade-card";
    card.innerHTML = `
      <div class="info">
        <div class="name">${up.name}</div>
        <div class="desc">${up.desc}</div>
        <div class="bars">${bars}</div>
      </div>
      <button class="buy ${maxed ? "maxed" : ""}" ${!canAfford && !maxed ? "disabled" : ""} data-upgrade="${key}">
        ${maxed ? "MAX" : `🪙 ${cost}`}
      </button>
    `;
    list.appendChild(card);
  }

  // Bind buy buttons
  list.querySelectorAll(".buy[data-upgrade]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.upgrade;
      const up = UPGRADES[key];
      const lvl = saveData.upgrades[key];
      if (lvl >= up.maxLevel) return;
      const cost = up.costs[lvl];
      if (saveData.wallet < cost) return;
      saveData.wallet -= cost;
      saveData.upgrades[key]++;
      saveSave();
      sfx.coin();
      renderGarage();
    });
  });
}

// ── Mute toggle ──
document.getElementById("mute-badge").addEventListener("click", () => {
  document.getElementById("mute-badge").textContent = sfx.toggleMute() ? "🔇" : "🔊";
});

// ── Boot: show name input or start screen ──
if (saveData.name) {
  document.getElementById("nameinput").classList.add("hide");
  showStartScreen();
}

bindButtons();