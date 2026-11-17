/* OffscreenCanvas worker: physics and framebuffer stay off the UI thread. */
importScripts('./engine.js');
let engine;
let started = false;
function loop(timestamp) {
  if (!engine) return;
  engine.frame(timestamp || performance.now());
  if (typeof self.requestAnimationFrame === 'function') self.requestAnimationFrame(loop);
  else setTimeout(() => loop(performance.now()), 16);
}
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    engine = new self.CircleLeakEngine({
      canvas: data.canvas,
      onStats: stats => self.postMessage({ type: 'stats', stats }),
      onState: state => self.postMessage({ type: 'state', ...state })
    });
    if (!started) { started = true; loop(performance.now()); }
  } else if (engine) {
    engine.command(data);
  }
};
