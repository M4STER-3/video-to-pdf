import { clamp, quantile } from './vision.js';
import { seekVideoTo, createSampler, checkAbort } from './video-analyzer.js';

// Look for long, persistent boundaries, not "a white rectangle". Combining
// several frames prevents a heading or a temporary menu from defining the crop.
export function inferCrop(frames, originalWidth, originalHeight) {
  const full = { x: 0, y: 0, w: originalWidth, h: originalHeight };
  if (frames.length < 3) return { crop: full, confidence: 'low', reason: 'Pas assez d’images pour déterminer les marges.' };
  const { width: w, height: h } = frames[0];
  if (frames.some(f => f.width !== w || f.height !== h)) return { crop: full, confidence: 'low', reason: 'La disposition change pendant la vidéo.' };
  function boundary(frame, axis, p, from, to) {
    const data = frame.gray, values = []; let strong = 0;
    for (let q = from; q < to; q++) {
      const length = axis === 'x' ? w : h;
      // A thin rule in a document is not a change of background. Require the
      // contrast to persist at several distances on both sides of the edge.
      let d = 1, direction = 0;
      for (const gap of [2, 5, 8]) {
        const beforeP = clamp(p - gap, 0, length - 1), afterP = clamp(p + gap, 0, length - 1);
        const before = axis === 'x' ? data[q * w + beforeP] : data[beforeP * w + q];
        const after = axis === 'x' ? data[q * w + afterP] : data[afterP * w + q];
        const sign = Math.sign(before - after);
        if (direction && sign !== direction) { d = 0; break; }
        direction = sign;
        d = Math.min(d, Math.abs(before - after) / 255);
      }
      values.push(d); if (d > 0.055) strong++;
    }
    return { score: quantile(values, 0.5), coverage: strong / Math.max(1, values.length) };
  }
  function candidates(axis, side, from, to) {
    const length = axis === 'x' ? w : h, options = [];
    const start = side === 'start' ? 3 : Math.floor(length * 0.72);
    const end = side === 'start' ? Math.ceil(length * 0.28) : length - 3;
    for (let p = start; p < end; p++) {
      const measurements = frames.map(f => boundary(f, axis, p, from, to));
      const support = measurements.filter(m => m.coverage >= 0.72 && m.score >= 0.055).length / frames.length;
      if (support >= 0.8) {
        const score = quantile(measurements.map(m => m.score), 0.2);
        // Prefer an outside boundary when two equally plausible lines exist.
        const inset = side === 'start' ? p / length : (length - p) / length;
        options.push({ p, score: score * support - inset * 0.06, support });
      }
    }
    options.sort((a, b) => b.score - a.score);
    return options[0] || null;
  }
  let left = candidates('x', 'start', Math.floor(h * 0.16), Math.ceil(h * 0.84));
  let right = candidates('x', 'end', Math.floor(h * 0.16), Math.ceil(h * 0.84));
  // A lone vertical line can be a table border. Require two sides for lateral crop.
  if (!left || !right) left = right = null;
  const from = left ? left.p + 4 : Math.floor(w * 0.08), to = right ? right.p - 4 : Math.ceil(w * 0.92);
  let top = candidates('y', 'start', from, to), bottom = candidates('y', 'end', from, to);
  // Temporal activity outside a proposed edge means it could cut real content.
  function outsideMoves(axis, edge, side) {
    if (!edge) return false;
    let changed = 0, count = 0;
    for (let n = 1; n < frames.length; n++) for (let y = 3; y < h - 3; y += 3) for (let x = 3; x < w - 3; x += 3) {
      const p = axis === 'x' ? x : y;
      if (side === 'start' ? p >= edge.p - 3 : p <= edge.p + 3) continue;
      const i = y * w + x; count++; if (Math.abs(frames[n].gray[i] - frames[n - 1].gray[i]) > 24) changed++;
    }
    return changed / Math.max(1, count) > 0.025;
  }
  if (outsideMoves('x', left, 'start') || outsideMoves('x', right, 'end')) left = right = null;
  if (outsideMoves('y', top, 'start')) top = null;
  if (outsideMoves('y', bottom, 'end')) bottom = null;
  let found = [left, right, top, bottom].filter(Boolean).length;
  if (!found && frames.length >= 5) {
    // Some tablets render a soft shadow beside the document. The strict
    // multi-gap test above intentionally rejects that shadow; recover only
    // when a broad, persistent luminance step confirms all four sides.
    const median = (axis, from, to) => {
      const length = axis === 'x' ? w : h, profiles = [];
      for (const frame of frames) {
        const values = [];
        for (let p = 0; p < length; p++) {
          let sum = 0, n = 0;
          for (let q = from; q < to; q += 2) {
            sum += axis === 'x' ? frame.gray[q * w + p] : frame.gray[p * w + q]; n++;
          }
          values.push(sum / Math.max(1, n));
        }
        profiles.push(values);
      }
      return Array.from({ length }, (_, p) => quantile(profiles.map(profile => profile[p]), 0.5));
    };
    const edgeFromProfile = (axis, side, from, to, minimumContrast = 18) => {
      const length = axis === 'x' ? w : h, profile = median(axis, from, to), start = side === 'start' ? 8 : Math.floor(length * 0.62), end = side === 'start' ? Math.floor(length * 0.38) : length - 8;
      let best = null;
      for (let p = start; p < end; p++) {
        const before = profile.slice(Math.max(0, p - 4), p), after = profile.slice(p, Math.min(length, p + 4));
        const a = before.reduce((sum, value) => sum + value, 0) / Math.max(1, before.length), b = after.reduce((sum, value) => sum + value, 0) / Math.max(1, after.length), contrast = Math.abs(a - b);
        if (!best || contrast > best.contrast) best = { p, contrast };
      }
      return best && best.contrast >= minimumContrast ? best : null;
    };
    const robustLeft = edgeFromProfile('x', 'start', Math.floor(h * 0.16), Math.ceil(h * 0.84));
    const robustRight = edgeFromProfile('x', 'end', Math.floor(h * 0.16), Math.ceil(h * 0.84));
    const robustTop = edgeFromProfile('y', 'start', robustLeft?.p ?? Math.floor(w * 0.08), robustRight?.p ?? Math.ceil(w * 0.92));
    if (robustLeft && robustRight) {
      left = { p: robustLeft.p, score: robustLeft.contrast / 255, support: 1 };
      right = { p: robustRight.p, score: robustRight.contrast / 255, support: 1 };
      if (robustTop) top = { p: robustTop.p, score: robustTop.contrast / 255, support: 1 };
      // Bottom chrome often contains a home indicator with a stronger edge
      // than the actual page. Keep that side uncropped unless the strict
      // detector already proved it safe.
      found = [left, right, top, bottom].filter(Boolean).length;
    }
  }
  if (!found && !(left && right && top && bottom)) return { crop: full, confidence: 'low', reason: 'Bords incertains : l’image entière est conservée pour éviter de couper du contenu.' };
  // Keep a safety margin inside the excluded UI, outside the document boundary.
  const x = left ? Math.max(0, left.p - 3) : 0, y = top ? Math.max(0, top.p - 3) : 0;
  const endX = right ? Math.min(w, right.p + 3) : w, endY = bottom ? Math.min(h, bottom.p + 3) : h;
  if ((endX - x) * (endY - y) < w * h * 0.38) return { crop: full, confidence: 'low', reason: 'Zone détectée trop petite : l’image entière est conservée.' };
  const sx = originalWidth / w, sy = originalHeight / h;
  const crop = { x: Math.floor(x * sx), y: Math.floor(y * sy), w: 0, h: 0 };
  crop.w = clamp(Math.ceil(endX * sx) - crop.x, 1, originalWidth - crop.x);
  crop.h = clamp(Math.ceil(endY * sy) - crop.y, 1, originalHeight - crop.y);
  return { crop, confidence: found === 4 ? 'high' : 'medium', reason: found === 4 ? 'Les quatre bords sont cohérents sur plusieurs images.' : 'Certaines marges sont identifiées ; les autres sont conservées par précaution.' };
}

export async function detectAutoCrop(video, signal, onProgress = () => {}) {
  const full = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }, sampler = createSampler(full, 320), frames = [];
  const end = Math.max(0, video.duration - 0.02), count = Math.min(11, Math.max(3, Math.ceil(video.duration * 2)));
  try {
    for (let i = 0; i < count; i++) {
      checkAbort(signal); await seekVideoTo(video, end * (0.03 + 0.94 * i / (count - 1)), signal);
      frames.push(sampler.read(video)); onProgress(Math.round((i + 1) / count * 100));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return inferCrop(frames, video.videoWidth, video.videoHeight);
  } finally { sampler.dispose(); }
}
