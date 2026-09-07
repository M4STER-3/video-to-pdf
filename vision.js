// Pure, deterministic image processing. No browser, network or dependencies.
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export function quantile(values, fraction) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(clamp(fraction, 0, 1) * (sorted.length - 1))];
}
export function dimensions(width, height, longest = 192) {
  const scale = Math.min(1, longest / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function describe(gray, width, height) {
  const edge = new Uint8Array(gray.length), signature = new Float32Array(128), counts = new Uint32Array(64);
  let laplacian = 0, ink = 0, border = 0, borderCount = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const gx = Math.abs(gray[i + 1] - gray[i - 1]), gy = Math.abs(gray[i + width] - gray[i - width]);
    edge[i] = Math.min(255, (gx + gy) / 2);
    const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
    laplacian += Math.min(lap * lap, 65536);
    if (edge[i] > 18) ink++;
    if (x < 4 || y < 4 || x > width - 5 || y > height - 5) { borderCount++; if (edge[i] > 25) border++; }
    const tile = Math.min(7, Math.floor(y * 8 / height)) * 8 + Math.min(7, Math.floor(x * 8 / width));
    signature[tile * 2] += gray[i]; signature[tile * 2 + 1] += edge[i]; counts[tile]++;
  }
  for (let i = 0; i < 64; i++) { signature[i * 2] /= (counts[i] || 1) * 255; signature[i * 2 + 1] /= (counts[i] || 1) * 255; }
  return { gray, edge, width, height, signature, sharpness: laplacian / Math.max(1, gray.length) / 65536, texture: ink / gray.length, borderInk: border / Math.max(1, borderCount) };
}
export function signatureDistance(a, b) {
  let sum = 0; for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]) * (i % 2 ? 1.5 : 1);
  return sum / a.length;
}

// Block matching on edges and luminance. Textured pixels get most of the weight;
// empty margins cannot hide a document displacement. Search is bounded.
export function estimateTranslation(a, b, range = 4) {
  if (a.width !== b.width || a.height !== b.height) return { dx: 0, dy: 0, gain: 0, residual: 1 };
  const { width: w, height: h } = a, points = [];
  for (let y = range + 2; y < h - range - 2; y += 3) for (let x = range + 2; x < w - range - 2; x += 3) {
    const i = y * w + x; if (a.edge[i] > 10 || b.edge[i] > 10) points.push(i);
  }
  if (points.length < 16) return { dx: 0, dy: 0, gain: 0, residual: 0 };
  function cost(dx, dy) {
    let sum = 0; const offset = dy * w + dx;
    for (const i of points) sum += Math.min(100, Math.abs(a.gray[i] - b.gray[i + offset])) * 0.4 + Math.abs(a.edge[i] - b.edge[i + offset]) * 0.6;
    return sum / points.length / 255;
  }
  const zero = cost(0, 0); let best = zero, dx = 0, dy = 0;
  if (zero < 0.002) return { dx, dy, gain: 0, residual: zero };
  for (let y = -range; y <= range; y += 2) for (let x = -range; x <= range; x += 2) {
    const value = cost(x, y) + (Math.abs(x) + Math.abs(y)) * 0.00012;
    if (value < best) { best = value; dx = x; dy = y; }
  }
  const cx = dx, cy = dy;
  for (let y = Math.max(-range, cy - 1); y <= Math.min(range, cy + 1); y++) for (let x = Math.max(-range, cx - 1); x <= Math.min(range, cx + 1); x++) {
    const value = cost(x, y) + (Math.abs(x) + Math.abs(y)) * 0.00012;
    if (value < best) { best = value; dx = x; dy = y; }
  }
  return { dx, dy, gain: (zero - best) / Math.max(zero, 0.0001), residual: best };
}

export function motionMetrics(a, b, threshold = 0.012) {
  const grid = 6, sums = new Float64Array(36), edges = new Float64Array(36), counts = new Uint32Array(36), texture = new Float64Array(36);
  const { width: w, height: h } = a;
  let absolute = 0, changed = 0, maxDetail = 0;
  const cellW = Math.ceil(w / 16), detailCells = new Uint16Array(cellW * Math.ceil(h / 16));
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, tile = Math.min(5, Math.floor(y * grid / h)) * grid + Math.min(5, Math.floor(x * grid / w));
    const difference = Math.abs(a.gray[i] - b.gray[i]); absolute += difference;
    if (difference > 18) { changed++; if (difference > 30) maxDetail = Math.max(maxDetail, ++detailCells[Math.floor(y / 16) * cellW + Math.floor(x / 16)]); }
    sums[tile] += difference; edges[tile] += Math.abs(a.edge[i] - b.edge[i]); texture[tile] += Math.max(a.edge[i], b.edge[i]); counts[tile]++;
  }
  let active = 0, changedTiles = 0, centerTiles = 0, outerOnly = true;
  const tileScores = [];
  for (let i = 0; i < 36; i++) {
    const denom = Math.max(1, counts[i]) * 255, score = (sums[i] * 0.45 + edges[i] * 0.55) / denom;
    tileScores.push(score); if (texture[i] / denom > 0.006) active++;
    if (score > threshold) {
      changedTiles++; const x = i % 6, y = Math.floor(i / 6);
      if (x > 0 && x < 5 && y > 0 && y < 5) { centerTiles++; outerOnly = false; }
    }
  }
  const localAnimation = outerOnly && changedTiles <= 2 && changed / a.gray.length < 0.035;
  const translation = absolute / (a.gray.length * 255) > 0.0015 ? estimateTranslation(a, b) : { dx: 0, dy: 0, gain: 0, residual: 0 };
  const shifted = translation.gain > 0.24 && (translation.dx !== 0 || translation.dy !== 0) && translation.residual < 0.1;
  const smallEdit = maxDetail >= 2 && changed / a.gray.length < 0.015;
  return { mean: absolute / (a.gray.length * 255), robust: quantile(tileScores, 0.7), changedTiles, centerTiles, active, localAnimation, shifted, translation, smallEdit,
    changed: !localAnimation && (smallEdit || centerTiles > 0 || changedTiles >= Math.max(3, Math.ceil(active * 0.3))) };
}

// Strict duplicate verification at up to 1280 px. Mean difference alone is
// insufficient: one changed word must survive. Local 16x16 cells catch it.
export function verifyDuplicate(a, b, sensitivity = 0.006) {
  if (sensitivity <= 0 || a.width !== b.width || a.height !== b.height) return { kind: 'different' };
  const factor = clamp(sensitivity / 0.006, 0.35, 2), w = a.width, h = a.height;
  function compare(dx = 0, dy = 0) {
    let sum = 0, edgeSum = 0, changed = 0, maxCell = 0, borderChange = 0, count = 0;
    const cellW = Math.ceil(w / 16), cells = new Uint16Array(cellW * Math.ceil(h / 16));
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, xx = x + dx, yy = y + dy;
      if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) {
        if (Math.abs(a.gray[i] - b.gray[i]) > 20 * factor) borderChange++;
        continue;
      }
      const j = yy * w + xx, d = Math.abs(a.gray[i] - b.gray[j]); sum += d; edgeSum += Math.abs(a.edge[i] - b.edge[j]); count++;
      if (d > 20 * factor) { changed++; const cell = Math.floor(y / 16) * cellW + Math.floor(x / 16); maxCell = Math.max(maxCell, ++cells[cell]); }
    }
    const mean = sum / Math.max(1, count) / 255, edge = edgeSum / Math.max(1, count) / 255;
    const exact = mean < 0.006 * factor && edge < 0.007 * factor && changed <= Math.max(2, count * 0.000025 * factor) && maxCell <= 2 * factor && borderChange <= 2;
    return { kind: exact ? 'duplicate' : mean < 0.038 * factor && edge < 0.045 * factor ? 'possible' : 'different', mean, changed, maxCell, dx, dy };
  }
  const direct = compare(); if (direct.kind === 'duplicate') return direct;
  // Tiny framing corrections are duplicates only if alignment explains the
  // differences AND no new detail appears in the interior or entering border.
  const range = Math.min(4, Math.max(1, Math.round(Math.min(w, h) * 0.006)));
  const shift = estimateTranslation(a, b, range);
  if (shift.gain > 0.5 && Math.hypot(shift.dx, shift.dy) <= range) {
    const aligned = compare(shift.dx, shift.dy);
    if (aligned.kind === 'duplicate') return aligned;
  }
  return direct;
}

export function adaptiveThreshold(metrics, base = 0.012) {
  const floor = quantile(metrics.filter(x => Number.isFinite(x)), 0.15);
  // Bounded: a video with only motion must never teach the detector that scroll
  // is noise. The user setting scales a conservative automatically found floor.
  return clamp(Math.max(0.004, floor * 2.5 + 0.002), 0.004, 0.014) * clamp(base / 0.012, 0.2, 5);
}

export class WindowTracker {
  constructor(settings, threshold) { this.s = settings; this.threshold = threshold; this.previous = null; this.anchor = null; this.run = null; this.lastShift = null; this.windows = []; this.pendingLocal = null; }
  close() {
    if (!this.run) return;
    const span = this.run.end - this.run.start;
    // A 0.5 s real pause may be observed as roughly 0.35–0.45 s at the
    // boundaries. Keep a safety floor so tiny accidental freezes are not pages.
    const minimum = Math.max(0.24, this.s.stable * 0.75);
    if (span + 1e-6 >= minimum) {
      this.run.short = span + 1e-6 < this.s.stable + this.s.settle;
      this.windows.push(this.run);
    }
  }
  add(frame, time) {
    let moving = false, local = false, confirmedLocal = null;
    if (this.previous) {
      const pair = motionMetrics(this.previous, frame, this.threshold), anchor = motionMetrics(this.anchor, frame, this.threshold * 1.4);
      local = pair.localAnimation;
      const shift = pair.shifted ? pair.translation : null;
      const consistent = shift && this.lastShift && (shift.dx * this.lastShift.dx + shift.dy * this.lastShift.dy > 0);
      const drift = anchor.shifted && Math.hypot(anchor.translation.dx, anchor.translation.dy) > 1.1;
      // An isolated one-pixel shift with negligible aligned residual is allowed;
      // sustained direction or accumulated displacement is a scroll.
      const jitter = pair.shifted && Math.hypot(pair.translation.dx, pair.translation.dy) <= 1.1 && pair.translation.residual < 0.012 && !consistent && !drift;
      moving = Boolean(consistent || drift || ((pair.changed || anchor.changed) && !jitter));
      this.lastShift = shift;
      // A blinking corner can be ignored, but a persistent changed page number
      // must start a new candidate. Confirm it over time and keep its true start.
      if (!moving && anchor.localAnimation && (anchor.smallEdit || anchor.mean > 0.0003)) {
        const pendingMetric = this.pendingLocal && motionMetrics(this.pendingLocal.frame, frame, this.threshold);
        const pendingChanged = pendingMetric && (pendingMetric.smallEdit || pendingMetric.mean > 0.0003);
        if (!this.pendingLocal || pendingChanged) this.pendingLocal = { start: time, previousEnd: this.run.end, frame, samples: [] };
        this.pendingLocal.samples.push({ time, sharpness: frame.sharpness });
        if (time - this.pendingLocal.start >= 0.2) { confirmedLocal = this.pendingLocal; moving = true; }
      } else this.pendingLocal = null;
    }
    if (!this.run || moving) {
      if (confirmedLocal) { this.run.end = confirmedLocal.previousEnd; this.run.samples = this.run.samples.filter(s => s.time <= this.run.end); }
      this.close(); this.run = { start: confirmedLocal?.start ?? time, end: time, samples: confirmedLocal?.samples.slice(0, -1) || [], localAnimation: false }; this.anchor = confirmedLocal?.frame || frame; this.pendingLocal = null;
    }
    this.run.end = time; this.run.localAnimation ||= local;
    this.run.samples.push({ time, sharpness: frame.sharpness });
    // Keep a bounded set of sharp representatives, plus interval endpoints.
    if (this.run.samples.length > 8) this.run.samples.sort((a, b) => b.sharpness - a.sharpness).length = 8;
    this.previous = frame;
    return moving;
  }
  finish() { this.close(); this.run = null; return this.windows; }
}
