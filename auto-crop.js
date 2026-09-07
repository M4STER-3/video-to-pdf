import { clamp, quantile } from './vision.js';
import { seekVideoTo, createSampler, checkAbort } from './video-analyzer.js';

// Look for long, persistent boundaries, not "a white rectangle". Combining
// several frames prevents a heading or a temporary menu from defining the crop.
export function inferCrop(frames, originalWidth, originalHeight) {
  const full = { x: 0, y: 0, w: originalWidth, h: originalHeight };
  if (frames.length < 3) return { crop: full, confidence: 'low', reason: 'Pas assez d’images pour déterminer les marges.' };
  const { width: w, height: h } = frames[0];
  if (frames.some(f => f.width !== w || f.height !== h)) return { crop: full, confidence: 'low', reason: 'La disposition change pendant la vidéo.' };
  const paper = inferPaperFrame(frames, originalWidth, originalHeight);
  if (paper) return paper;
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
  if (!found) return { crop: full, confidence: 'low', reason: 'Bords incertains : l’image entière est conservée pour éviter de couper du contenu.' };
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

// A sheet shadow is a thin trough, unlike a background step. Require a pair
// of long sides, flat exterior strips and two independently observed ends.
// The aspect ratio is measured from those edges, never imposed as A4.
export function inferPaperFrame(frames, originalWidth, originalHeight) {
  if (frames.length < 5) return null;
  const { width: w, height: h } = frames[0];
  const median = new Uint8Array(w * h);
  for (let i = 0; i < median.length; i++) median[i] = quantile(frames.map(f => f.gray[i]), 0.5);
  function lines(axis, side, from, to) {
    const length = axis === 'x' ? w : h, result = [];
    const start = side === 'start' ? 4 : Math.floor(length * 0.62);
    const end = side === 'start' ? Math.ceil(length * 0.38) : length - 4;
    const pixel = (p, q) => median[axis === 'x' ? q * w + p : p * w + q];
    for (let p = start; p < end; p++) {
      let strong = 0, flat = 0, count = 0, strength = 0;
      for (let q = from; q < to; q++) {
        const trough = Math.min(pixel(p - 2, q), pixel(p + 2, q)) - pixel(p, q);
        if (trough >= 10) { strong++; strength += trough; }
        const outside = side === 'start' ? p - 4 : p + 4;
        const further = side === 'start' ? Math.max(0, p - 8) : Math.min(length - 1, p + 8);
        if (Math.abs(pixel(outside, q) - pixel(further, q)) <= 8) flat++;
        count++;
      }
      if (strong / count >= 0.65 && flat / count >= 0.85) result.push({ p, score: strength / count });
    }
    return result;
  }
  const lefts = lines('x', 'start', Math.floor(h * 0.2), Math.ceil(h * 0.8));
  const rights = lines('x', 'end', Math.floor(h * 0.2), Math.ceil(h * 0.8));
  if (!lefts.length || !rights.length) return null;
  const left = lefts.sort((a, b) => b.score - a.score)[0].p;
  const right = rights.sort((a, b) => b.score - a.score)[0].p;
  if (right - left < w * 0.3) return null;
  const tops = lines('y', 'start', left + 3, right - 3);
  const bottoms = lines('y', 'end', left + 3, right - 3);
  if (!tops.length || !bottoms.length) return null;
  const top = Math.min(...tops.map(x => x.p)), bottom = Math.max(...bottoms.map(x => x.p));
  const x = Math.max(0, left - 1), endX = Math.min(w, right + 1);
  const y = top + 1, endY = bottom;
  const ratio = (endX - x) / (endY - y), area = (endX - x) * (endY - y) / (w * h);
  if (ratio < 0.5 || ratio > 2 || area < 0.2 || area > 0.96) return null;
  const sx = originalWidth / w, sy = originalHeight / h;
  const crop = { x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round((endX - x) * sx), h: Math.round((endY - y) * sy) };
  const badge = findViewerBadge(frames, median, w, h, x, y, endX, endY);
  if (badge) crop.masks = [{ x: Math.round((badge.x - x) * sx), y: Math.round((badge.y - y) * sy), w: Math.round(badge.w * sx), h: Math.round(badge.h * sy) }];
  return { crop, confidence: 'high', reason: 'Feuille entière : les quatre limites sont détectées, proportions originales conservées.' };
}

// Only remove a persistent, filled grey viewer badge surrounded by blank
// white paper. Bare page numbers, footnotes and nonuniform footers survive.
function findViewerBadge(frames, median, w, h, left, top, right, bottom) {
  const pw = right - left, ph = bottom - top;
  const x0 = Math.floor(left + pw * 0.4), x1 = Math.ceil(right - pw * 0.4);
  const y0 = Math.floor(bottom - ph * 0.035), y1 = bottom - 1;
  const seen = new Set(), components = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const start = y * w + x;
    if (seen.has(start) || median[start] > 244) continue;
    const queue = [start]; seen.add(start); let minX = x, maxX = x, minY = y, maxY = y;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], xx = i % w, yy = Math.floor(i / w);
      minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy);
      for (const [nx, ny] of [[xx - 1, yy], [xx + 1, yy], [xx, yy - 1], [xx, yy + 1]]) {
        const j = ny * w + nx;
        if (nx >= x0 && nx < x1 && ny >= y0 && ny < y1 && !seen.has(j) && median[j] <= 244) { seen.add(j); queue.push(j); }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < 4 || bw > pw * 0.13 || bh < 2 || bh > ph * 0.035 || bw / bh < 1.4 || bw / bh > 5) continue;
    let support = 0;
    for (const frame of frames) {
      let grey = 0, white = 0, ring = 0;
      for (let yy = minY; yy <= maxY; yy++) for (let xx = minX; xx <= maxX; xx++) { const value = frame.gray[yy * w + xx]; if (value >= 180 && value <= 244) grey++; }
      for (let yy = minY - 1; yy <= maxY + 1; yy++) for (let xx = minX - 2; xx <= maxX + 2; xx++) {
        if (yy >= minY && yy <= maxY && xx >= minX - 1 && xx <= maxX + 1) continue;
        ring++; if (frame.gray[yy * w + xx] >= 248) white++;
      }
      if (grey / (bw * bh) >= 0.65 && white / ring >= 0.85) support++;
    }
    if (support >= 5 && support / frames.length >= 0.6) components.push({ x: minX - 2, y: minY - 1, w: bw + 4, h: bh + 2 });
  }
  return components.length === 1 ? components[0] : null;
}
