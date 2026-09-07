import { WindowTracker, motionMetrics, adaptiveThreshold, signatureDistance, verifyDuplicate, clamp } from './vision.js';
import { seekVideoTo, createSampler, captureFrame, checkAbort } from './video-analyzer.js';

const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
const MAX_WINDOWS = 2500;

export async function calibrate(video, sampler, settings, signal, progress) {
  const measurements = [], duration = video.duration;
  for (let i = 0; i < 6; i++) {
    const t = Math.max(0, (duration - 0.15) * i / 6);
    await seekVideoTo(video, t, signal); const a = sampler.read(video);
    await seekVideoTo(video, Math.min(duration - 0.001, t + 0.065), signal); const b = sampler.read(video);
    measurements.push(motionMetrics(a, b, settings.motion).robust); progress((i + 1) / 6);
  }
  return adaptiveThreshold(measurements, settings.motion);
}

export async function scanWindows(video, sampler, settings, threshold, signal, progress) {
  const tracker = new WindowTracker(settings, threshold), step = 1 / settings.fps;
  const end = Math.max(0, video.duration - 0.002), total = Math.ceil(end / step);
  let previous = null, previousTime = 0, wasMoving = false;
  for (let i = 0; i <= total; i++) {
    checkAbort(signal); const time = Math.min(end, i * step);
    await seekVideoTo(video, time, signal); const frame = sampler.read(video);
    const coarse = previous ? motionMetrics(previous, frame, threshold) : null;
    const moving = Boolean(coarse && (coarse.changed || coarse.shifted));
    // Refine motion boundaries chronologically. Extra samples are observations,
    // never automatic captures at a fixed interval.
    if (previous && moving !== wasMoving && time - previousTime > 0.07) {
      for (const fraction of [1 / 3, 2 / 3]) {
        const intermediate = previousTime + (time - previousTime) * fraction;
        await seekVideoTo(video, intermediate, signal); tracker.add(sampler.read(video), intermediate);
      }
    }
    tracker.add(frame, time); previous = frame; previousTime = time; wasMoving = moving;
    if (tracker.windows.length > MAX_WINDOWS) throw new Error('Trop de changements dans cette vidéo. Essayez un extrait plus court pour terminer l’analyse.');
    progress((i + 1) / (total + 1), tracker.windows.length);
    if (i % 3 === 0) await yieldUI();
  }
  return tracker.finish();
}

export async function refineWindow(video, sampler, window, settings, threshold, signal) {
  const duration = window.end - window.start;
  const minimumCandidate = Math.max(0.24, settings.stable * 0.75);
  if (duration + 1e-6 < minimumCandidate) return null;
  const margin = Math.min(settings.settle, duration * 0.15);
  const from = window.start + margin, to = Math.max(from, window.end - Math.min(0.025, duration * 0.08));
  const times = [from, from + (to - from) * 0.25, (from + to) / 2, from + (to - from) * 0.75, to];
  for (const item of window.samples.slice(0, 3)) if (item.time >= from && item.time <= to) times.push(item.time);
  const unique = [...new Set(times.map(t => +t.toFixed(4)))].sort((a, b) => a - b);
  // Only bounded medium-resolution candidates are held, never original canvases.
  const choices = [];
  for (const time of unique) {
    await seekVideoTo(video, time, signal); choices.push({ time, frame: sampler.read(video), stable: false, score: 0 });
  }
  for (let i = 1; i < choices.length; i++) {
    const a = choices[i - 1], b = choices[i], metrics = motionMetrics(a.frame, b.frame, threshold * 1.35);
    const stable = !metrics.changed && (!metrics.shifted || Math.hypot(metrics.translation.dx, metrics.translation.dy) <= 1);
    if (stable && b.time - a.time >= 0.025) a.stable = b.stable = true;
  }
  const sharpest = Math.max(0.000001, ...choices.map(c => c.frame.sharpness)), middle = (from + to) / 2;
  for (const c of choices) {
    c.score = (c.stable ? 2 : 0) + c.frame.sharpness / sharpest - Math.abs(c.time - middle) / Math.max(0.01, duration) * 0.15;
  }
  choices.sort((a, b) => b.score - a.score);
  const best = choices[0];
  // Never rescue an interval by taking a moving frame merely to return a page.
  if (!best?.stable) return null;
  if (best.frame.texture === 0 && best.frame.sharpness < 0.000001) return null;
  const reasons = [];
  if (window.short) reasons.push('Pause brève');
  if (window.localAnimation) reasons.push('Animation près du bord');
  if (best.frame.texture < 0.003) reasons.push('Très peu de détails visibles');
  if (best.frame.borderInk > 0.22) reasons.push('Contenu proche du bord');
  return { time: best.time, signature: best.frame.signature, reasons, sharpness: best.frame.sharpness, start: window.start, end: window.end };
}

// Browser adapters can be replaced by deterministic adapters in integration tests.
export async function analyzeVideo(video, crop, settings, signal, onProgress, onPage, options = {}) {
  const makeSampler = options.createSampler || createSampler;
  const capture = options.captureFrame || captureFrame;
  const samplers = [];
  const ownSampler = longest => { const sampler = makeSampler(crop, longest); samplers.push(sampler); return sampler; };
  const report = { windows: 0, pages: 0, duplicates: [], rejected: 0, reviews: 0, threshold: 0, elapsed: 0 };
  const index = [], started = Date.now(); let lastProgress = 0;
  const progress = (percent, phase, extra = '') => {
    lastProgress = Math.max(lastProgress, clamp(percent, 0, 100));
    onProgress(Math.floor(lastProgress), report.pages, phase, extra);
  };
  try {
    const low = ownSampler(192), scan = ownSampler(384), medium = ownSampler(640), detail = ownSampler(1280);
    const threshold = await calibrate(video, low, settings, signal, part => progress(part * 7, 'Réglage automatique'));
    report.threshold = threshold;
    const windows = await scanWindows(video, scan, settings, threshold, signal, (part, count) => progress(7 + part * 53, 'Recherche des pauses', `${count} arrêts candidats`));
    report.windows = windows.length;
    for (let i = 0; i < windows.length; i++) {
      checkAbort(signal);
      const candidate = await refineWindow(video, medium, windows[i], settings, threshold, signal);
      if (!candidate) { report.rejected++; progress(60 + (i + 1) / windows.length * 39, 'Vérification des images', `${report.rejected} images vides ou instables écartées`); await yieldUI(); continue; }
      let duplicate = null, possible = null;
      const nearest = settings.duplicate > 0 ? index.map(entry => ({ entry, distance: signatureDistance(entry.signature, candidate.signature) })).filter(x => x.distance < 0.075).sort((a, b) => a.distance - b.distance).slice(0, 5) : [];
      if (nearest.length) {
        await seekVideoTo(video, candidate.time, signal); const current = detail.read(video);
        for (const { entry } of nearest) {
          await seekVideoTo(video, entry.time, signal); const comparison = verifyDuplicate(current, detail.read(video), settings.duplicate);
          if (comparison.kind === 'duplicate') { duplicate = entry; break; }
          if (comparison.kind === 'possible') possible = entry;
          await yieldUI(); checkAbort(signal);
        }
      }
      if (duplicate) {
        const item = { time: candidate.time, matchedTime: duplicate.time, matchedId: duplicate.id, reason: 'Contenu déjà retenu' };
        report.duplicates.push(item); options.onDuplicate?.(item);
      } else {
        if (possible) candidate.reasons.push('Page ressemblante : détails conservés');
        // A short-lived state surrounded by near-identical layouts can be a menu.
        // Keep it reviewable, since a small actual text edit can look the same.
        if (possible && candidate.end - candidate.start < 1.1) candidate.reasons.push('Élément temporaire possible');
        if (options.cropConfidence === 'low') candidate.reasons.push('Recadrage à vérifier');
        await seekVideoTo(video, candidate.time, signal);
        const page = await capture(video, crop, settings.jpeg); checkAbort(signal);
        page.id = `auto-${i}-${candidate.time.toFixed(4)}`; page.reasons = candidate.reasons; page.reviewed = !page.reasons.length;
        page.interval = { start: candidate.start, end: candidate.end };
        await onPage(page);
        index.push({ time: candidate.time, signature: candidate.signature, id: page.id });
        report.pages++; if (candidate.reasons.length) report.reviews++;
      }
      progress(60 + (i + 1) / Math.max(1, windows.length) * 39, 'Vérification et extraction', `${report.duplicates.length} doublons écartés`);
      await yieldUI();
    }
    report.elapsed = (Date.now() - started) / 1000;
    progress(100, 'Analyse terminée', `${report.duplicates.length} doublons écartés`);
    return report;
  } finally { for (const sampler of samplers) sampler.dispose(); options.onFinish?.(report); }
}
