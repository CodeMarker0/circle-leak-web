/*
 * Circle Leak Web — JavaScript reimplementation of circle-leak-sim.
 * Original: Copyright 2026 sxc, Apache License 2.0.
 * Adaptation: independently ported to browser JavaScript; see NOTICE.
 * No third-party dependencies or network services.
 */
(() => {
  'use strict';
  const WIDTH = 1000;
  const HEIGHT = 800;
  const CX = 500;
  const CY = 365;
  const RADIUS = 320;
  const R_IN = 319;
  const R_OUT = 322;
  const HOLE_HALF = 40;
  const SPEED = 520;
  const GRAVITY = 1100;
  const FALL_GRAVITY = 2400;
  const FALL_CAP = 6000;
  const START_CAP = 90000;
  const PACKED_RING = 0xffffd6ac; // RGBA = (172,214,255,255) on little-endian machines
  const TAU = Math.PI * 2;

  function clamp(v, low, high) { return Math.min(high, Math.max(low, v)); }
  function rgba(r, g, b) { return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0; }

  class CircleLeakEngine {
    constructor(options = {}) {
      this.maxSim = options.maxSim || START_CAP;
      this.x = new Float32Array(START_CAP);
      this.y = new Float32Array(START_CAP);
      this.vx = new Float32Array(START_CAP);
      this.vy = new Float32Array(START_CAP);
      this.weights = new Float64Array(START_CAP);
      this.colors = new Uint32Array(START_CAP);
      this.fx = new Float32Array(FALL_CAP);
      this.fy = new Float32Array(FALL_CAP);
      this.fvx = new Float32Array(FALL_CAP);
      this.fvy = new Float32Array(FALL_CAP);
      this.fc = new Uint32Array(FALL_CAP);
      this.n = 0;
      this.fn = 0;
      this.fallIndex = 0;
      this.count = 0;
      this.leaked = 0;
      this.peak = 0;
      this.mode = 'vacuum';
      this.state = 'menu';
      this.target = 1000000;
      this.respawn = 2;
      this.time = 0;
      this.rate = 0;
      this.fps = 0;
      this.samples = [];
      this.onStats = options.onStats || (() => {});
      this.onState = options.onState || (() => {});
      this.canvas = null;
      this.ctx = null;
      this.image = null;
      this.pixelData = null;
      this.background = null;
      this.ringIndices = null;
      this.lastFrame = 0;
      this.fpsFrameCounter = 0;
      this.fpsTime = 0;
      this.lastTelemetry = -999;
      this.lastSample = 0;
      this.lastRateTime = 0;
      this.lastRateCount = 0;
      this.slowDuration = 0;
      this.pointerHeld = false;
      this.pointerX = CX;
      this.pointerY = CY;
      this.lastSpawn = 0;
      this.accumulator = 0;
      if (options.canvas) this.attachCanvas(options.canvas);
    }

    attachCanvas(canvas) {
      this.canvas = canvas;
      this.canvas.width = WIDTH;
      this.canvas.height = HEIGHT;
      this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!this.ctx) throw new Error('Canvas 2D is unavailable');
      this.image = this.ctx.createImageData(WIDTH, HEIGHT);
      this.pixelData = new Uint32Array(this.image.data.buffer);
      this.background = new Uint32Array(WIDTH * HEIGHT);
      this._initBackground();
      this._initRing();
      this.draw();
      this.emitStats(true);
    }

    _initBackground() {
      // Deterministic star field, created once, not regenerated every frame.
      let seed = 20261114;
      const rnd = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let y = 0; y < HEIGHT; y++) {
        const t = y / (HEIGHT - 1);
        const rr = 9 + 7 * t;
        const gg = 11 + 10 * t;
        const bb = 24 + 18 * t;
        const row = y * WIDTH;
        for (let x = 0; x < WIDTH; x++) {
          const dx = x - CX;
          const dy = y - CY;
          const v = Math.min(1, Math.hypot(dx, dy) / (RADIUS * 1.6));
          const dim = 1 - 0.28 * v;
          this.background[row + x] = rgba((rr * dim) | 0, (gg * dim) | 0, (bb * dim) | 0);
        }
      }
      for (let i = 0; i < 900; i++) {
        const p = (rnd() * WIDTH * HEIGHT) | 0;
        const brightness = (22 + rnd() * 40) | 0;
        this.background[p] = rgba(brightness, brightness, Math.min(255, brightness + 9));
      }
    }

    _initRing() {
      const set = new Set();
      // Dense angular sampling guarantees a continuous one-pixel ring.
      for (let i = 0; i < 12000; i++) {
        const a = (i / 12000) * TAU;
        const dx = Math.cos(a) * RADIUS;
        const dy = Math.sin(a) * RADIUS;
        if (dy > 0 && Math.abs(dx) < HOLE_HALF) continue;
        const x = Math.round(CX + dx);
        const y = Math.round(CY + dy);
        if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) set.add(y * WIDTH + x);
      }
      this.ringIndices = Uint32Array.from(set);
    }

    start(mode) {
      if (mode !== 'vacuum' && mode !== 'gravity') return;
      this.mode = mode;
      this.n = 0;
      this.fn = 0;
      this.count = 0;
      this.leaked = 0;
      this.peak = 0;
      this.time = 0;
      this.rate = 0;
      this.samples = [[0, 0]];
      this.accumulator = 0;
      this.lastRateTime = 0;
      this.lastRateCount = 0;
      this.lastSample = 0;
      this.lastTelemetry = -999;
      this.slowDuration = 0;
      this.maxSim = START_CAP;
      this.pointerHeld = false;
      this.state = 'play';
      this.onState({state: 'play', mode});
      this.emitStats(true);
    }

    toMenu() {
      this.state = 'menu';
      this.pointerHeld = false;
      this.n = 0;
      this.fn = 0;
      this.count = 0;
      this.leaked = 0;
      this.peak = 0;
      this.rate = 0;
      this.time = 0;
      this.samples = [];
      this.onState({state: 'menu'});
      this.emitStats(true);
      this.draw();
    }

    setTarget(value) {
      if (this.state !== 'menu') return;
      this.target = clamp(Math.round(value / 500000) * 500000, 500000, 5000000);
      this.emitStats(true);
    }

    setRespawn(value) {
      this.respawn = clamp(Math.round(value), 2, 10);
      this.emitStats(true);
    }

    _randomColor() {
      let r = (Math.random() * 256) | 0;
      let g = (Math.random() * 256) | 0;
      let b = (Math.random() * 256) | 0;
      if (r >= g && r >= b) r = 255;
      else if (g >= r && g >= b) g = 255;
      else b = 255;
      return rgba(Math.max(40, r), Math.max(40, g), Math.max(40, b));
    }

    _add(x, y, w) {
      if (this.n >= this.maxSim) {
        // Weighted compression: one visible entity represents several real balls.
        // When full, new physical balls are merged into a random representative.
        if (this.n > 0) this.weights[(Math.random() * this.n) | 0] += w;
        this.count += w;
        return;
      }
      const i = this.n++;
      this.x[i] = x;
      this.y[i] = y;
      if (this.mode === 'gravity') {
        this.vx[i] = (Math.random() - 0.5) * SPEED * 1.2;
        this.vy[i] = -(0.2 + 0.4 * Math.random()) * SPEED;
      } else {
        const a = Math.random() * TAU;
        const speed = SPEED * (0.85 + 0.3 * Math.random());
        this.vx[i] = Math.cos(a) * speed;
        this.vy[i] = Math.sin(a) * speed;
      }
      this.weights[i] = w;
      this.colors[i] = this._randomColor();
      this.count += w;
    }

    spawnAt(x, y) {
      if (this.state !== 'play') return false;
      const dx = x - CX;
      const dy = y - CY;
      if (dx * dx + dy * dy > (RADIUS - 3) ** 2) return false;
      this._add(x, y, 1);
      return true;
    }

    _addFalling(x, y, vx, vy, color) {
      const i = this.fn < FALL_CAP ? this.fn++ : (this.fallIndex++ % FALL_CAP);
      this.fx[i] = x;
      this.fy[i] = y;
      this.fvx[i] = vx;
      this.fvy[i] = vy;
      this.fc[i] = color;
    }

    _fallStep(dt) {
      let i = 0;
      while (i < this.fn) {
        this.fvy[i] += FALL_GRAVITY * dt;
        this.fx[i] += this.fvx[i] * dt;
        this.fy[i] += this.fvy[i] * dt;
        if (this.fy[i] > HEIGHT + 40 || this.fx[i] < -50 || this.fx[i] > WIDTH + 50) {
          const last = --this.fn;
          if (i !== last) {
            this.fx[i] = this.fx[last];
            this.fy[i] = this.fy[last];
            this.fvx[i] = this.fvx[last];
            this.fvy[i] = this.fvy[last];
            this.fc[i] = this.fc[last];
          }
        } else i++;
      }
    }

    _step(dt) {
      // Move already-falling particles first: fresh leaks must not advance twice.
      this._fallStep(dt);
      const gravityMode = this.mode === 'gravity';
      const restitution = gravityMode ? 0.97 : 1;
      const leakedWeights = [];
      let i = 0;
      while (i < this.n) {
        if (gravityMode) this.vy[i] += GRAVITY * dt;
        let x = this.x[i] + this.vx[i] * dt;
        let y = this.y[i] + this.vy[i] * dt;
        let dx = x - CX;
        let dy = y - CY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R_IN * R_IN) {
          const inHole = dy > 0 && Math.abs(dx) < HOLE_HALF;
          if (inHole) {
            if (d2 >= R_OUT * R_OUT) {
              const w = this.weights[i];
              this.count -= w;
              this.leaked += w;
              leakedWeights.push(w);
              this._addFalling(x, y, this.vx[i], this.vy[i], this.colors[i]);
              const last = --this.n;
              if (last !== i) {
                this.x[i] = this.x[last]; this.y[i] = this.y[last];
                this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
                this.weights[i] = this.weights[last]; this.colors[i] = this.colors[last];
              }
              continue;
            }
          } else {
            const d = Math.sqrt(d2) || 1;
            const nx = dx / d;
            const ny = dy / d;
            const vn = this.vx[i] * nx + this.vy[i] * ny;
            if (vn > 0) {
              this.vx[i] -= (1 + restitution) * vn * nx;
              this.vy[i] -= (1 + restitution) * vn * ny;
              if (gravityMode && this.vx[i] ** 2 + this.vy[i] ** 2 < 160 * 160) {
                this.vx[i] = (Math.random() - 0.5) * 300;
                this.vy[i] = -(200 + 160 * Math.random());
              }
            }
            x = CX + nx * R_IN;
            y = CY + ny * R_IN;
          }
        }
        this.x[i] = x;
        this.y[i] = y;
        i++;
      }
      // Every leaked *real* ball spawns N replacements in the upper semicircle.
      for (let l = 0; l < leakedWeights.length; l++) {
        const w = leakedWeights[l];
        for (let k = 0; k < this.respawn; k++) {
          const a = Math.PI + Math.random() * Math.PI;
          const r = Math.sqrt(Math.random()) * (RADIUS - 5);
          this._add(CX + r * Math.cos(a), CY + r * Math.sin(a), w);
        }
      }
      if (this.count > this.peak) this.peak = this.count;
      if (this.count >= this.target) {
        this.state = 'win';
        this.pointerHeld = false;
        this.onState({
          state: 'win', mode: this.mode, elapsed: this.time,
          peak: this.peak, leaked: this.leaked, count: this.count, target: this.target
        });
        this.emitStats(true);
      }
    }

    _compressTo(target) {
      if (this.n <= target) return;
      // Preserve sum of weights exactly, unlike lossy particle dropping.
      for (let i = target; i < this.n; i++) {
        this.weights[(Math.random() * target) | 0] += this.weights[i];
      }
      this.n = target;
      this.maxSim = target;
    }

    _drawDot(buf, x, y, color) {
      const px = x | 0;
      const py = y | 0;
      if (px < 0 || px >= WIDTH - 1 || py < 0 || py >= HEIGHT - 1) return;
      const pos = py * WIDTH + px;
      buf[pos] = color;
      buf[pos + 1] = color;
      buf[pos + WIDTH] = color;
      buf[pos + WIDTH + 1] = color;
    }

    draw() {
      if (!this.ctx) return;
      const buf = this.pixelData;
      buf.set(this.background);
      for (let i = 0; i < this.n; i++) this._drawDot(buf, this.x[i], this.y[i], this.colors[i]);
      for (let i = 0; i < this.fn; i++) this._drawDot(buf, this.fx[i], this.fy[i], this.fc[i]);
      for (let i = 0; i < this.ringIndices.length; i++) buf[this.ringIndices[i]] = PACKED_RING;
      this.ctx.putImageData(this.image, 0, 0);
    }

    frame(now) {
      if (!this.lastFrame) this.lastFrame = now;
      const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
      const dt = Math.min(0.05, rawDt);
      this.lastFrame = now;
      if (rawDt > 0 && rawDt < 0.3) {
        this.fpsFrameCounter++;
        this.fpsTime += rawDt;
        if (this.fpsTime >= 0.5) {
          this.fps = this.fpsFrameCounter / this.fpsTime;
          this.fpsFrameCounter = 0;
          this.fpsTime = 0;
        }
      }
      if (this.state === 'play') {
        this.accumulator = Math.min(0.12, this.accumulator + dt);
        let iterations = 0;
        while (this.accumulator >= 1 / 60 && iterations < 4 && this.state === 'play') {
          this.time += 1 / 60;
          if (this.pointerHeld && this.time - this.lastSpawn >= 0.1) {
            this.spawnAt(this.pointerX, this.pointerY);
            this.lastSpawn = this.time;
          }
          this._step(1 / 60);
          this.accumulator -= 1 / 60;
          iterations++;
        }
        if (this.time - this.lastSample >= 0.25) {
          this.samples.push([this.time, this.count]);
          if (this.samples.length > 800) this.samples.splice(0, this.samples.length - 800);
          this.lastSample = this.time;
        }
        if (this.time - this.lastRateTime >= 0.6) {
          const elapsed = this.time - this.lastRateTime;
          this.rate = (this.count - this.lastRateCount) / elapsed;
          this.lastRateTime = this.time;
          this.lastRateCount = this.count;
        }
        if (this.n >= 20000 && this.fps > 0 && this.fps < 38) {
          this.slowDuration += dt;
          if (this.slowDuration > 3 && this.maxSim > 20000) {
            this._compressTo(Math.max(20000, Math.round(this.maxSim * 0.8)));
            this.slowDuration = 0;
          }
        } else this.slowDuration = 0;
      }
      this.draw();
      if (this.time - this.lastTelemetry >= 0.22 || this.state !== 'play' && now - this.lastTelemetry >= 220) {
        this.emitStats();
      }
    }

    emitStats(force = false) {
      if (!force && this.state === 'play' && this.time - this.lastTelemetry < 0.22) return;
      this.lastTelemetry = this.state === 'play' ? this.time : performance.now();
      this.onStats({
        state: this.state, mode: this.mode, count: this.count, entities: this.n,
        falling: this.fn, target: this.target, respawn: this.respawn,
        leaked: this.leaked, peak: this.peak, rate: this.rate,
        fps: this.fps, elapsed: this.time,
        samples: this.samples.length ? this.samples.slice() : []
      });
    }

    command(message) {
      switch (message.type) {
        case 'start': this.start(message.mode); break;
        case 'menu': this.toMenu(); break;
        case 'restart': this.start(this.mode); break;
        case 'target': this.setTarget(message.value); break;
        case 'respawn': this.setRespawn(message.value); break;
        case 'spawn': this.spawnAt(message.x, message.y); this.lastSpawn = this.time; break;
        case 'pointer':
          this.pointerX = message.x;
          this.pointerY = message.y;
          this.pointerHeld = message.held === true;
          break;
        case 'release': this.pointerHeld = false; break;
        case 'stats': this.emitStats(true); break;
      }
    }
  }

  globalThis.CircleLeakEngine = CircleLeakEngine;
})();
