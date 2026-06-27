"use strict";

// ════════════════════════════════════════
// VIBE CLIMB RACING — ENDLESS PROCEDURAL
// ════════════════════════════════════════

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let W, H, DPR;

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
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 60;
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  }

  // Update engine sound: pitch & volume scale with speed
  updateEngine(vx, onGround) {
    if (!this.engineOsc || !this.engineGain || this.muted) return;
    const speed = Math.abs(vx);
    const freq = 50 + speed * 15; // 50Hz idle → ~260Hz at max speed
    const vol = onGround ? Math.min(0.12, 0.02 + speed * 0.008) : 0.01;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
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

// ── Difficulty scaling — every 1000m the terrain gets rougher ──
function difficultyAt(x) {
  return 1 + Math.floor(x / 10000) * 0.35; // +35% amplitude per 1000m
}

// ── Noise (layered sines, scaled by difficulty) ──
function noise(x) {
  const d = difficultyAt(x);
  return (
    (Math.sin(x * 0.003) * 80 +
     Math.sin(x * 0.007 + 1.3) * 40 +
     Math.sin(x * 0.013 + 2.7) * 20 +
     Math.sin(x * 0.021 + 4.1) * 10 +
     Math.sin(x * 0.041 + 0.5) * 5) * d
  );
}

// Flat area at start so player doesn't instantly crash
function terrainHeight(x) {
  if (x < 400) return BASE_Y;
  return BASE_Y + noise(x);
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
    this.mass = 1.5;
    this.inertia = 4500;
    this.fuel = 100;
    this.onGround = false;
    this.airborne = 0;
    this.dead = false;
    this.enginePower = 0.42;
    this.brakePower = 0.55;
  }

  update(dt, terrain, input) {
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    const dts = dt * 60; // delta in "frame units"

    // ── Physics constants ──
    const GRAVITY = 0.40;
    const ENGINE_FWD = 0.38;
    const ENGINE_BACK = 0.45;
    const AIR_DRAG = 0.995;
    const ANG_DAMP = 0.96;
    const MAX_VX = 14;

    // Forward direction (angle 0 = pointing right)
    const fwdX = Math.cos(this.angle);
    const fwdY = Math.sin(this.angle);

    // Gravity (always down in screen)
    this.vy += GRAVITY * dts;

    // Engine: accelerate along forward direction
    if (gas && this.fuel > 0) {
      this.vx += fwdX * ENGINE_FWD * dts;
      this.vy += fwdY * ENGINE_FWD * dts;
      this.fuel -= 0.05 * dts;
    }
    if (brake && this.fuel > 0) {
      this.vx -= fwdX * ENGINE_BACK * dts;
      this.vy -= fwdY * ENGINE_BACK * dts;
      this.fuel -= 0.025 * dts;
    }

    // Passive fuel drain
    this.fuel -= 0.006 * dts;

    // Air drag
    this.vx *= AIR_DRAG;
    this.vy *= 0.999;

    // Speed clamp
    if (this.vx > MAX_VX) this.vx = MAX_VX;
    if (this.vx < -MAX_VX * 0.6) this.vx = -MAX_VX * 0.6;

    // Angular damping + air control
    this.angVel *= ANG_DAMP;
    if (!this.onGround) {
      if (gas) this.angVel -= 0.003 * dts;  // rotate backward (wheelie)
      if (brake) this.angVel += 0.003 * dts; // rotate forward (endo)
    }

    // Integrate
    this.x += this.vx * dts;
    this.y += this.vy * dts;
    this.angle += this.angVel * dts;

    // ── Ground collision (direct snap, no bounce) ──
    // Wheel positions for slope detection
    const halfWB = this.wheelBase / 2;
    const wheelOffset = 20;
    const wlX = this.x - fwdX * halfWB - fwdY * wheelOffset;
    const wrX = this.x + fwdX * halfWB - fwdY * wheelOffset;

    // Ground height under each wheel
    const groundL = terrain.groundAt(wlX);
    const groundR = terrain.groundAt(wrX);

    // Car bottom = center + wheelOffset (when flat)
    // We want the wheels to rest ON the ground
    const carBottom = this.y + wheelOffset;
    const avgGround = (groundL + groundR) / 2;

    this.onGround = false;

    // If car bottom is at or below ground level, snap to ground
    if (carBottom >= avgGround - 2) {
      this.y = avgGround - wheelOffset;
      if (this.vy > 0) this.vy = 0;
      this.onGround = true;
      // Rolling friction
      this.vx *= 0.992;
    }

    // ── Slope alignment when grounded (skip if upside-down!) ──
    if (this.onGround) {
      this.airborne = 0;
      // Check if car is upside-down (roof on ground)
      const normAngle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const upsideDown = normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4;
      if (!upsideDown) {
        this.angVel *= 0.7;
        // Target angle = terrain slope angle
        const slope = terrain.slopeAt(this.x);
        const targetAngle = Math.atan2(slope, 1);
        // Smoothly steer car angle toward slope
        let diff = targetAngle - this.angle;
        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        this.angle += diff * 0.15 * dts;
      } else {
        // Upside down on ground — no slope correction, let flip timer run
        this.angVel *= 0.95;
      }
    } else {
      this.airborne += dts;
    }

    // Clamp fuel
    if (this.fuel < 0) this.fuel = 0;

    // Death: flipped for > 2 seconds
    const normAngle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (normAngle > Math.PI * 0.6 && normAngle < Math.PI * 1.4) {
      this.flipTime = (this.flipTime || 0) + dt;
      if (this.flipTime > 2.0) this.dead = true;
    } else {
      this.flipTime = 0;
    }
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.angle);

    // Chassis body
    ctx.fillStyle = "#e74c3c";
    ctx.strokeStyle = "#c0392b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-38, -22, 76, 28, 6);
    ctx.fill();
    ctx.stroke();

    // Cabin
    ctx.fillStyle = "#2c3e50";
    ctx.beginPath();
    ctx.roundRect(-14, -38, 34, 18, 4);
    ctx.fill();

    // Window
    ctx.fillStyle = "#5dade2";
    ctx.beginPath();
    ctx.roundRect(-10, -35, 26, 12, 3);
    ctx.fill();

    // Driver head
    ctx.fillStyle = "#f9e79f";
    ctx.beginPath();
    ctx.arc(8, -26, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Wheels (drawn separately in world coords for clarity)
    const fwdX = Math.cos(this.angle);
    const fwdY = Math.sin(this.angle);
    const perpX = -fwdY;
    const perpY = fwdX;
    const halfWB = this.wheelBase / 2;
    const wy = 22;

    for (const sign of [-1, 1]) {
      const wx = this.x + fwdX * (halfWB * sign) + perpX * wy;
      const wyy = this.y + fwdY * (halfWB * sign) + perpY * wy;
      ctx.save();
      ctx.translate(wx - camX, wyy - camY);
      ctx.rotate(this.angle);
      // Tire
      ctx.fillStyle = "#2c2c2c";
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.wheelRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Hubcap
      ctx.fillStyle = "#888";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      // Spokes (rotate with speed)
      const spin = (this.x / this.wheelRadius) * sign;
      ctx.strokeStyle = "#666";
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

// ── Coins ──
class CoinSystem {
  constructor() { this.coins = []; this.collected = 0; this.nextSpawnX = 300; }

  update(camX, terrain, carX) {
    // Spawn coins ahead
    while (this.nextSpawnX < camX + VIEW_AHEAD) {
      // Random gap between coins
      const gap = 120 + Math.random() * 200;
      this.nextSpawnX += gap;
      // Place coin slightly above terrain
      const gy = terrain.groundAt(this.nextSpawnX);
      this.coins.push({
        x: this.nextSpawnX,
        y: gy - 50 - Math.random() * 40,
        collected: false,
        phase: Math.random() * Math.PI * 2,
      });
    }
    // Remove collected/old
    this.coins = this.coins.filter(c => !c.collected && c.x > camX - VIEW_BEHIND);
  }

  checkCollect(car) {
    for (const c of this.coins) {
      if (c.collected) continue;
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      if (dx * dx + dy * dy < 1800) {
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

  update(camX, terrain) {
    while (this.nextSpawnX < camX + VIEW_AHEAD) {
      const gap = 600 + Math.random() * 800;
      this.nextSpawnX += gap;
      const gy = terrain.groundAt(this.nextSpawnX);
      this.cans.push({ x: this.nextSpawnX, y: gy - 30, collected: false });
    }
    this.cans = this.cans.filter(c => !c.collected && c.x > camX - VIEW_BEHIND);
  }

  checkCollect(car) {
    for (const c of this.cans) {
      if (c.collected) continue;
      const dx = c.x - car.x;
      const dy = c.y - car.y;
      if (dx * dx + dy * dy < 2500) {
        c.collected = true;
        car.fuel = Math.min(100, car.fuel + 35);
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
const BASE_Y = 280;
let terrain, car, coins, fuels, clouds;
let camX = 0, camY = 0;
let distance = 0;
let level = 1;
let running = false;
let lastTime = 0;
let gameTime = 0;
const input = { gas: false, brake: false };

function initGame() {
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
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

// ── Main Loop ──
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  if (running) {
    gameTime += dt;
    update(dt);
    render();
  }

  if (!car.dead) {
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
  fuels.update(camX, terrain);
  coins.checkCollect(car);
  fuels.checkCollect(car);

  // Camera follows car (smooth lerp, clamped to prevent runaway)
  const targetCamX = car.x - W * 0.35;
  const targetCamY = car.y - H * 0.55;
  camX += (targetCamX - camX) * 0.08;
  camY += (targetCamY - camY) * 0.06;
  // Hard clamp camera Y so it never flies off into the sky
  if (camY < -400) camY = -400;
  if (camY > 200) camY = 200;

  distance = Math.max(distance, Math.floor(car.x / 10));

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
  document.getElementById("fuel-bar-fill").style.width = car.fuel + "%";
  document.getElementById("level").textContent = level;

  // Check game over conditions
  if (car.fuel <= 0 && Math.abs(car.vx) < 0.3) {
    car.dead = true;
  }
}

function showLevelUp(lvl, bonus) {
  const el = document.getElementById("levelup");
  el.textContent = `⭐ Level ${lvl}!  +${bonus} Taler`;
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
  const screenStart = camX - 50;
  let firstDrawn = false;
  for (let i = 0; i < pts.length; i++) {
    const sx = pts[i].x - camX;
    if (sx < -50 || sx > W + 50) continue;
    if (!firstDrawn) {
      ctx.moveTo(sx, pts[i].y - camY);
      firstDrawn = true;
    } else {
      ctx.lineTo(sx, pts[i].y - camY);
    }
  }
  ctx.lineTo(W + 50, H + 100);
  ctx.lineTo(-50, H + 100);
  ctx.closePath();
  ctx.fillStyle = "#7B5B3B";
  ctx.fill();

  // Grass layer on top of terrain
  ctx.beginPath();
  firstDrawn = false;
  for (let i = 0; i < pts.length; i++) {
    const sx = pts[i].x - camX;
    if (sx < -50 || sx > W + 50) continue;
    if (!firstDrawn) {
      ctx.moveTo(sx, pts[i].y - camY);
      firstDrawn = true;
    } else {
      ctx.lineTo(sx, pts[i].y - camY);
    }
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
  running = false;
  sfx.crash();
  document.getElementById("final-dist").textContent = distance;
  document.getElementById("final-coins").textContent = coins.collected;
  document.getElementById("final-level").textContent = level;
  document.getElementById("gameover").classList.add("show");
}

// ── Input ──
const btnGas = document.getElementById("btn-gas") || { addEventListener: () => {} };
const btnBrake = document.getElementById("btn-brake") || { addEventListener: () => {} };

// Keyboard
document.addEventListener("keydown", (e) => {
  if (e.code === "ArrowRight" || e.code === "KeyD") input.gas = true;
  if (e.code === "ArrowLeft" || e.code === "KeyA") input.brake = true;
});
document.addEventListener("keyup", (e) => {
  if (e.code === "ArrowRight" || e.code === "KeyD") input.gas = false;
  if (e.code === "ArrowLeft" || e.code === "KeyA") input.brake = false;
});

// Touch / mouse buttons (will be bound after DOM ready)
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

// ── Start / Restart ──
document.getElementById("start-btn").addEventListener("click", () => {
  document.getElementById("start").classList.add("hide");
  sfx.init();
  initGame();
});
document.getElementById("restart-btn").addEventListener("click", () => {
  document.getElementById("gameover").classList.remove("show");
  sfx.init();
  initGame();
});

bindButtons();