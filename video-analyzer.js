import { describe, dimensions } from './vision.js';
export const RECOMMENDED = Object.freeze({ fps: 8, stable: 0.3, motion: 0.012, duplicate: 0.006, settle: 0.06, jpeg: 0.96 });
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

export function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Mémoire insuffisante pour cette image. Fermez les autres applications ou utilisez une vidéo moins grande.')), 'image/jpeg', quality));
}

export async function captureFrame(video, crop, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = crop.w; canvas.height = crop.h;
  const context = canvas.getContext('2d');
  if (!context) { canvas.width = canvas.height = 1; throw new Error('Mémoire insuffisante pour capturer la page.'); }
  try {
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    context.fillStyle = '#fff';
    for (const mask of crop.masks || []) {
      // Recheck each exported frame: never erase a footer that now contains
      // actual document content instead of the detected viewer badge.
      const pixels = context.getImageData(mask.x, mask.y, mask.w, mask.h);
      if (isViewerBadge(pixels.data, mask.w, mask.h)) context.fillRect(mask.x, mask.y, mask.w, mask.h);
    }
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

export function createSampler(crop, longest = 192) {
  const canvas = document.createElement('canvas'), size = dimensions(crop.w, crop.h, longest);
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { canvas.width = canvas.height = 1; throw new Error('Mémoire insuffisante pour analyser la vidéo.'); }
  let sourceWidth = null, sourceHeight = null;
  return {
    read(video) {
      if ((sourceWidth !== null && (sourceWidth !== video.videoWidth || sourceHeight !== video.videoHeight)) || crop.x + crop.w > video.videoWidth || crop.y + crop.h > video.videoHeight) throw new Error('Les dimensions de la vidéo changent pendant la lecture. Utilisez un extrait avec une orientation constante pour conserver un cadrage correct.');
      sourceWidth = video.videoWidth; sourceHeight = video.videoHeight;
      context.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < gray.length; i++) gray[i] = Math.round(pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114);
      return describe(gray, canvas.width, canvas.height);
    },
    dispose() { canvas.width = canvas.height = 1; }
  };
}

export function isViewerBadge(rgba, w, h) {
  let ring = 0, white = 0, inner = 0, grey = 0;
  const mx = Math.max(2, Math.round(w * 0.17)), my = Math.max(1, Math.round(h * 0.14));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, value = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { ring++; if (value >= 245) white++; }
    if (x >= mx && x < w - mx && y >= my && y < h - my) {
      inner++;
      if (value >= 175 && value <= 245 && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 12) grey++;
    }
  }
  return white / Math.max(1, ring) >= 0.85 && grey / Math.max(1, inner) >= 0.6;
}
