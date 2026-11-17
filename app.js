/*
 * Circle Leak Web — UI and visualization
 * No bundler, framework, CDN or server is needed.
 * Apache-2.0; based on https://github.com/baisedegy/circle-leak-sim
 */
(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const canvas = byId('game-canvas');
  const overlay = byId('menu-overlay');
  const winOverlay = byId('win-overlay');
  const helpOverlay = byId('help-modal');
  const clickHint = byId('click-hint');
  const formatter = new Intl.NumberFormat('zh-CN');
  const compact = value => {
    const n = Math.round(value || 0);
    return n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿`
      : n >= 1e5 ? `${(n / 1e4).toFixed(0)}万`
      : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万`
      : formatter.format(n);
  };
  const full = value => formatter.format(Math.round(value || 0));
  const limit = (value, min, max) => Math.min(max, Math.max(min, value));

  let stats = {
    state: 'menu', mode: 'vacuum', count: 0, entities: 0, target: 1000000,
    respawn: 2, leaked: 0, peak: 0, rate: 0, fps: 0,
    elapsed: 0, samples: []
  };
  let isHelpOpen = false;
  let onPageEngine = null;
  let worker = null;
  let pointerDown = false;
  let hintTimeout = null;
  let chartUpdated = 0;
  let hasSpawned = false;
  let lastRender = 0;
  let mode = 'vacuum';

  function send(message) {
    if (worker) worker.postMessage(message);
    else if (onPageEngine) onPageEngine.command(message);
  }

  function progress() {
    const ratio = stats.target ? limit(stats.count / stats.target, 0, 1) : 0;
    byId('progress-fill').style.width = `${ratio * 100}%`;
    byId('progress-percent').textContent = `${(ratio * 100).toFixed(2)}%`;
  }

  function updateTelemetry(data) {
    stats = data;
    byId('menu-target').textContent = full(data.target);
    byId('stat-target').textContent = full(data.target);
    byId('stat-count').textContent = full(data.count);
    byId('stat-entities').textContent = full(data.entities);
    byId('stat-fps').textContent = data.fps > 0 ? Math.round(data.fps) : '—';
    byId('stat-rate').textContent = compact(data.rate);
    byId('stat-leaked').textContent = compact(data.leaked);
    byId('rule-n').textContent = data.respawn;
    byId('respawn-value').textContent = data.respawn;
    byId('target-minus').disabled = data.target <= 500000;
    byId('target-plus').disabled = data.target >= 5000000;
    byId('respawn-minus').disabled = data.respawn <= 2;
    byId('respawn-plus').disabled = data.respawn >= 10;
    progress();
    const gameStarted = data.state !== 'menu';
    byId('restart-button').disabled = !gameStarted;
    byId('menu-button').disabled = !gameStarted;
    byId('mode-badge').textContent = !gameStarted ? '未开始' : data.mode === 'gravity' ? '重力模式' : '无重力模式';
    if (performance.now() - chartUpdated > 320 || data.state !== 'play') {
      chartUpdated = performance.now();
      drawChart('chart-log', data.samples, true, data.target, '#7ebfff');
      drawChart('chart-linear', data.samples, false, data.target, '#bda3ff');
    }
  }

  function showHint() {
    hasSpawned = false;
    clickHint.classList.remove('hidden');
    clearTimeout(hintTimeout);
    hintTimeout = setTimeout(() => clickHint.classList.add('hidden'), 11000);
  }

  function switchState(message) {
    const state = message.state;
    overlay.classList.toggle('hidden', state !== 'menu');
    winOverlay.classList.toggle('hidden', state !== 'win');
    if (state === 'menu') {
      byId('simulation-status').innerHTML = '<span class="status-pulse"></span>等待开始';
      clearTimeout(hintTimeout);
      clickHint.classList.add('hidden');
    } else if (state === 'play') {
      mode = message.mode || mode;
      byId('simulation-status').innerHTML = '<span class="status-pulse"></span>正在模拟';
      showHint();
    } else if (state === 'win') {
      byId('simulation-status').innerHTML = '<span class="status-pulse"></span>目标达成';
      clickHint.classList.add('hidden');
      clearTimeout(hintTimeout);
      byId('win-count').textContent = full(message.count ?? stats.count);
      byId('win-time').textContent = `${Number(message.elapsed || 0).toFixed(1)} s`;
      byId('win-peak').textContent = compact(message.peak);
      byId('win-leaked').textContent = compact(message.leaked);
    }
  }

  function start(selectedMode) {
    if (isHelpOpen) toggleHelp(false);
    mode = selectedMode;
    send({type: 'start', mode: selectedMode});
  }

  function goMenu() {
    releasePointer();
    send({type: 'menu'});
  }

  function restart() {
    releasePointer();
    if (stats.state !== 'menu') send({type: 'restart'});
  }

  function toggleHelp(force) {
    isHelpOpen = typeof force === 'boolean' ? force : !isHelpOpen;
    helpOverlay.classList.toggle('hidden', !isHelpOpen);
    if (isHelpOpen) byId('help-close').focus();
  }

  function mapPointer(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: limit((ev.clientX - rect.left) * (canvas.width / rect.width), 0, canvas.width),
      y: limit((ev.clientY - rect.top) * (canvas.height / rect.height), 0, canvas.height)
    };
  }

  function releasePointer() {
    if (pointerDown) {
      pointerDown = false;
      send({type: 'release'});
    }
  }

  canvas.addEventListener('pointerdown', event => {
    if (stats.state !== 'play' || isHelpOpen) return;
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    event.preventDefault();
    const point = mapPointer(event);
    const dx = point.x - 500;
    const dy = point.y - 365;
    if (dx * dx + dy * dy > 317 * 317) return;
    try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* optional */ }
    pointerDown = true;
    send({type: 'spawn', ...point});
    send({type: 'pointer', ...point, held: true});
    if (!hasSpawned) {
      hasSpawned = true;
      clearTimeout(hintTimeout);
      clickHint.classList.add('hidden');
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (pointerDown) send({type: 'pointer', ...mapPointer(event), held: true});
  });
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', releasePointer);
  window.addEventListener('blur', releasePointer);

  byId('target-minus').addEventListener('click', () => send({type: 'target', value: stats.target - 500000}));
  byId('target-plus').addEventListener('click', () => send({type: 'target', value: stats.target + 500000}));
  byId('respawn-minus').addEventListener('click', () => send({type: 'respawn', value: stats.respawn - 1}));
  byId('respawn-plus').addEventListener('click', () => send({type: 'respawn', value: stats.respawn + 1}));
  byId('choose-vacuum').addEventListener('click', () => start('vacuum'));
  byId('choose-gravity').addEventListener('click', () => start('gravity'));
  byId('restart-button').addEventListener('click', restart);
  byId('menu-button').addEventListener('click', goMenu);
  byId('win-back').addEventListener('click', goMenu);
  byId('help-top').addEventListener('click', () => toggleHelp(true));
  byId('help-close').addEventListener('click', () => toggleHelp(false));
  byId('help-done').addEventListener('click', () => toggleHelp(false));
  helpOverlay.addEventListener('pointerdown', event => { if (event.target === helpOverlay) toggleHelp(false); });
  winOverlay.addEventListener('pointerdown', event => { if (event.target === winOverlay && stats.state === 'win') goMenu(); });

  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = event.key.toLowerCase();
    if (isHelpOpen) {
      if (key === 'escape' || key === 'h') { event.preventDefault(); toggleHelp(false); }
      return;
    }
    if (stats.state === 'win') {
      // Match the original: completed game stays visible until user acts.
      if (key === 'enter' || key === 'escape' || key === 'm' || key === ' ') {
        event.preventDefault(); goMenu();
      }
      return;
    }
    if (key === 'h') { event.preventDefault(); toggleHelp(true); }
    else if (key === 'm' && stats.state !== 'menu') { event.preventDefault(); goMenu(); }
    else if (key === 'r' && stats.state !== 'menu') { event.preventDefault(); restart(); }
    else if (stats.state === 'menu' && (key === '1' || key === '2')) {
      event.preventDefault(); start(key === '1' ? 'vacuum' : 'gravity');
    } else if (stats.state === 'menu' && (key === 'arrowleft' || key === 'arrowright')) {
      event.preventDefault(); send({type: 'target', value: stats.target + (key === 'arrowright' ? 500000 : -500000)});
    } else if (['[', ']', '-', '='].includes(key)) {
      event.preventDefault();
      send({type: 'respawn', value: stats.respawn + ('[ -'.includes(key) ? -1 : 1)});
    }
  });

  function axisCount(value) {
    const n = Math.round(value);
    if (n >= 1e6) return `${Number((n / 1e6).toPrecision(2))}M`;
    if (n >= 1e3) return `${Number((n / 1e3).toPrecision(2))}K`;
    return String(n);
  }

  function drawChart(id, points, logarithmic, target, stroke) {
    const el = byId(id);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    // Draw at backing resolution. CSS scales the simple chart with the sidebar.
    const width = el.width, height = el.height;
    ctx.clearRect(0, 0, width, height);
    const padL = 42, padR = 9, padT = 10, padB = 22;
    const plotW = width - padL - padR, plotH = height - padT - padB;
    const arr = points && points.length ? points : [[0, 0]];
    const maxT = Math.max(15, arr[arr.length - 1][0] || 0);
    const maxN = Math.max(10, target || 10, ...arr.map(p => p[1]));
    const toY = v => logarithmic
      ? Math.log10(Math.max(1, v)) / Math.log10(maxN)
      : Math.max(0, v) / maxN;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
      const q = i / 3;
      const y = padT + plotH * (1 - q);
      ctx.strokeStyle = 'rgba(113, 141, 184, .16)';
      ctx.beginPath(); ctx.moveTo(padL, y + .5); ctx.lineTo(width - padR, y + .5); ctx.stroke();
      const number = logarithmic ? Math.pow(maxN, q) : maxN * q;
      ctx.fillStyle = '#637795';
      ctx.textAlign = 'right';
      ctx.fillText(axisCount(number), padL - 7, y);
    }
    ctx.fillStyle = '#697b99';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('0s', padL, height - 5);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(maxT)}s`, width - padR, height - 5);
    if (arr.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const px = padL + (arr[i][0] / maxT) * plotW;
        const py = padT + plotH * (1 - limit(toY(arr[i][1]), 0, 1));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      const last = arr[arr.length - 1];
      const endX = padL + (last[0] / maxT) * plotW;
      const endY = padT + plotH * (1 - limit(toY(last[1]), 0, 1));
      ctx.lineTo(endX, padT + plotH);
      ctx.lineTo(padL, padT + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, logarithmic ? 'rgba(96,184,255,.26)' : 'rgba(173,135,255,.24)');
      grad.addColorStop(1, 'rgba(90,110,170,0)');
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const px = padL + (arr[i][0] / maxT) * plotW;
        const py = padT + plotH * (1 - limit(toY(arr[i][1]), 0, 1));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    ctx.restore();
  }

  function initMainThread() {
    if (!window.CircleLeakEngine) throw new Error('无法加载模拟引擎 engine.js');
    onPageEngine = new window.CircleLeakEngine({canvas, onStats: updateTelemetry, onState: switchState});
    lastRender = performance.now();
    function render(now) {
      // In menu/win mode the frame can remain static, saving CPU.
      if (stats.state === 'play' || now - lastRender > 700) {
        onPageEngine.frame(now);
        lastRender = now;
      } else {
        // Prevent a huge delta when returning to playing from a static screen.
        onPageEngine.lastFrame = now;
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  function init() {
    const canWorker = location.protocol !== 'file:' &&
      typeof Worker !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' &&
      !new URLSearchParams(location.search).has('no-worker');
    if (canWorker) {
      try {
        worker = new Worker('./engine-worker.js');
        worker.onmessage = event => {
          const msg = event.data;
          if (msg.type === 'stats') updateTelemetry(msg.stats);
          else if (msg.type === 'state') switchState(msg);
          else if (msg.type === 'error') {
            console.error('粒子计算线程错误', msg.message);
          }
        };
        worker.onerror = event => {
          console.error('Worker 初始化异常', event.message);
        };
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({type: 'init', canvas: offscreen}, [offscreen]);
        return;
      } catch (error) {
        console.warn('Worker 不可用，改用页面主线程', error);
        if (worker) worker.terminate();
        worker = null;
      }
    }
    initMainThread();
  }

  updateTelemetry(stats);
  init();
  // Read-only hooks for smoke tests and performance checks.
  window.__circleLeak = Object.freeze({
    getStats: () => ({...stats}),
    send: message => send(message),
    usesWorker: () => !!worker
  });
})();
