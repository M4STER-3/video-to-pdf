export const RECOMMENDED = Object.freeze({ fps: 4, stable: 0.5, motion: 0.012, duplicate: 0.006, settle: 0.25, jpeg: 0.94 });
export function checkAbort(signal) { if (signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError'); }

// All callers await this function. No concurrent seeks are permitted by the UI.
export async function seekVideoTo(video, time, signal) {
  checkAbort(signal); video.pause();
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));
  if (!Number.isFinite(target)) throw new Error('La durée de cette vidéo est illisible.');
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', ready); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', error); signal?.removeEventListener('abort', abort); };
    const done = (reason) => { cleanup(); reason ? reject(reason) : resolve(); };
    const ready = () => { if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.08) done(); };
    const error = () => done(new Error('Safari ne parvient pas à lire cette partie de la vidéo. Essayez une vidéo MP4 compatible ou un extrait plus court.'));
    const abort = () => done(new DOMException('Analyse annulée', 'AbortError'));
    video.addEventListener('seeked', ready); video.addEventListener('loadeddata', ready); video.addEventListener('error', error); signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => done(new Error('La lecture de la vidéo prend trop de temps. Réessayez ou choisissez un extrait plus court.')), 12000);
    try { if (Math.abs(video.currentTime - target) > 0.001 || video.readyState < 2) video.currentTime = target; ready(); } catch (e) { done(e); }
  });
  // seeked + HAVE_CURRENT_DATA guarantee a decoded current frame, including on
  // paused Safari videos where requestVideoFrameCallback may never fire.
  checkAbort(signal);
}

export function calculateFrameDifference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 1;
  let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

export class StabilityDetector {
  constructor(settings) { this.s = settings; this.previous = null; this.anchor = null; this.start = 0; this.end = 0; }
  finish() {
    if (!this.anchor || this.end - this.start + 1e-6 < this.s.stable + this.s.settle) return null;
    return { time: (this.start + this.s.settle + this.end) / 2 };
  }
  push(frame, time) {
    let candidate = null;
    // The anchored comparison catches cumulative slow scrolling that adjacent
    // frame comparisons alone would incorrectly classify as a stable page.
    if (!this.anchor || calculateFrameDifference(frame, this.previous) > this.s.motion || calculateFrameDifference(frame, this.anchor) > this.s.motion * 1.5) {
      candidate = this.finish(); this.start = time; this.anchor = frame;
    }
    this.end = time; this.previous = frame; return candidate;
  }
}

export function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Mémoire insuffisante pour cette image. Fermez les autres applications ou utilisez une vidéo moins grande.')), 'image/jpeg', quality));
}

export async function captureFrame(video, crop, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = crop.w; canvas.height = crop.h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Mémoire insuffisante pour capturer la page.');
  try {
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const blob = await canvasBlob(canvas, quality);
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(220 * crop.w / Math.max(crop.w, crop.h)));
    thumb.height = Math.max(1, Math.round(220 * crop.h / Math.max(crop.w, crop.h)));
    try {
      const tc = thumb.getContext('2d'); if (!tc) throw new Error('Mémoire insuffisante.');
      tc.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const thumbnail = await canvasBlob(thumb, 0.7);
      return { blob, thumbnail, width: crop.w, height: crop.h, time: video.currentTime };
    } finally { thumb.width = thumb.height = 1; }
  } finally { canvas.width = canvas.height = 1; }
}

export async function analyzeVideo(video, crop, settings, signal, onProgress, onPage) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('L’analyse ne peut pas démarrer : mémoire insuffisante.');
  const detector = new StabilityDetector(settings), fingerprints = [];
  const duration = video.duration, total = Math.ceil(duration * settings.fps);
  let accepted = 0;
  function sample() {
    ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data, gray = new Uint8Array(4096);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114);
    return gray;
  }
  async function retain(candidate) {
    if (!candidate) return;
    await seekVideoTo(video, candidate.time, signal);
    const fingerprint = sample();
    if (settings.duplicate > 0 && fingerprints.some(f => calculateFrameDifference(f, fingerprint) < settings.duplicate)) return;
    checkAbort(signal);
    const page = await captureFrame(video, crop, settings.jpeg); checkAbort(signal);
    await onPage(page); fingerprints.push(fingerprint); accepted++;
  }
  try {
    for (let i = 0; i <= total; i++) {
      checkAbort(signal); const time = Math.min(i / settings.fps, Math.max(0, duration - 0.001));
      await seekVideoTo(video, time, signal);
      const candidate = detector.push(sample(), time);
      await retain(candidate);
      onProgress(Math.min(99, Math.floor(i / Math.max(1, total) * 100)), accepted);
      // Allow paint, taps and the cancel button even on very fast decoders.
      if (i % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    await retain(detector.finish()); onProgress(100, accepted);
  } finally { canvas.width = canvas.height = 1; }
}
