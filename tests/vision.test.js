import { describe, dimensions, estimateTranslation, motionMetrics, verifyDuplicate, adaptiveThreshold, WindowTracker } from '../vision.js';
import { inferCrop } from '../auto-crop.js';
import { RECOMMENDED, seekVideoTo, isViewerBadge } from '../video-analyzer.js';
import { analyzeVideo, refineWindow } from '../analysis-engine.js';
import { TEXT_PATCHES } from './text-fixtures.js';

function assert(condition, detail) { if (!condition) throw new Error(detail); }
function rectangle(data, w, h, x, y, rw, rh, color) {
  for (let yy = Math.max(0, y); yy < Math.min(h, y + rh); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + rw); xx++) data[yy * w + xx] = color;
}
export function page(seed = 1, w = 144, h = 192, background = 246, foreground = 28) {
  const data = new Uint8Array(w * h).fill(background);
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  rectangle(data, w, h, 14, 12, w - 35, 5, foreground);
  // Deterministic glyph-like strokes, variable line lengths, margins and a figure.
  for (let y = 30; y < h - 20; y += 11) {
    const end = w - 15 - Math.floor(random() * 24);
    for (let x = 14; x < end; x += 6) {
      const bits = Math.floor(random() * 31) + 1;
      for (let dy = 0; dy < 5; dy++) if (bits & (1 << dy)) rectangle(data, w, h, x, y + dy, 3, 1, foreground);
      rectangle(data, w, h, x, y, 1, 5, foreground);
    }
  }
  return describe(data, w, h);
}
function shifted(frame, dx, dy) {
  const { width: w, height: h } = frame, data = new Uint8Array(w * h).fill(frame.gray[0]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x - dx >= 0 && x - dx < w && y - dy >= 0 && y - dy < h) data[y * w + x] = frame.gray[(y - dy) * w + x - dx];
  }
  return describe(data, w, h);
}
function blurred(frame) {
  const { width: w, height: h } = frame, data = frame.gray.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let sum = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += frame.gray[(y + dy) * w + x + dx]; data[y * w + x] = sum / 9;
  }
  return describe(data, w, h);
}
function screenshot(seed, dark = false, menu = false) {
  const w = 200, h = 280, data = new Uint8Array(w * h).fill(dark ? 165 : 42), inner = page(seed, 152, 216, dark ? 25 : 246, dark ? 230 : 25);
  for (let y = 0; y < 216; y++) data.set(inner.gray.subarray(y * 152, (y + 1) * 152), (y + 32) * w + 24);
  if (menu) rectangle(data, w, h, 60, 90, 80, 100, 105);
  return describe(data, w, h);
}
class TestSignal {
  constructor() { this.aborted = false; this.listeners = new Set(); }
  addEventListener(type, fn) { this.listeners.add(fn); }
  removeEventListener(type, fn) { this.listeners.delete(fn); }
  abort() { this.aborted = true; for (const fn of [...this.listeners]) fn(); }
}
class TestVideo {
  constructor(duration = 3) { this.duration = duration; this.readyState = 2; this.seeking = false; this.time = 0; this.listeners = new Map(); this.seeks = 0; this.concurrent = 0; }
  pause() {}
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  get currentTime() { return this.time; }
  set currentTime(value) {
    if (this.seeking) this.concurrent++;
    this.time = value; this.seeks++; this.seeking = true;
    Promise.resolve().then(() => { this.seeking = false; for (const fn of [...(this.listeners.get('seeked') || [])]) fn(); });
  }
  listenerCount() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
}

export async function runTests(onResult = () => {}) {
  const results = [];
  async function test(name, fn) {
    try { await fn(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error.message }); }
    onResult(results[results.length - 1]);
  }
  const a = page(1), b = page(91), settings = { ...RECOMMENDED };
  await test('Proportions portrait, paysage et petites images', () => {
    assert(dimensions(1600, 2400, 192).width === 128, 'ratio portrait');
    assert(dimensions(2400, 1600, 192).height === 128, 'ratio paysage');
    assert(dimensions(50, 80, 192).width === 50, 'pas d’agrandissement');
  });
  await test('Le score de netteté préfère les caractères nets', () => assert(a.sharpness > blurred(a).sharpness * 2, 'netteté'));
  await test('Translation verticale estimée sur du texte', () => {
    const movement = estimateTranslation(a, shifted(a, 0, -3));
    assert(movement.dy === -3 && movement.gain > 0.5, JSON.stringify(movement));
  });
  await test('Translation horizontale estimée sur du texte', () => assert(estimateTranslation(a, shifted(a, 2, 0)).dx === 2, 'translation'));
  await test('Pause longue : une seule fenêtre, pas une photo toutes les 0,5 s', () => {
    const tracker = new WindowTracker(settings, 0.006);
    for (let i = 0; i <= 80; i++) tracker.add(a, i / 8);
    assert(tracker.finish().length === 1, 'nombre de fenêtres');
  });
  await test('Pause de 0,5 s reconnue pour 12 décalages d’échantillonnage', () => {
    for (let offset = 0; offset < 12; offset++) {
      const tracker = new WindowTracker(settings, 0.006), start = 0.5 + offset / 96;
      for (let i = 0; i <= 20; i++) {
        const t = i / 8, frame = t >= start && t < start + 0.5 ? a : shifted(b, 0, -((i * 3) % 30)); tracker.add(frame, t);
      }
      const windows = tracker.finish();
      assert(windows.some(x => x.start >= start && x.end < start + 0.5 && !x.short), `pause manquée, décalage ${offset}: ${JSON.stringify(windows)}`);
    }
  });
  await test('Un gel de 0,18 s ne devient pas une page', () => {
    const tracker = new WindowTracker(settings, 0.006);
    for (let i = 0; i < 20; i++) tracker.add(i >= 5 && i <= 6 ? a : shifted(b, 0, -((i * 3) % 30)), i / 8);
    assert(tracker.finish().every(x => x.end - x.start >= 0.24), 'gel trop court retenu');
  });
  await test('Scroll continu rapide : aucune fenêtre stable', () => {
    const tracker = new WindowTracker(settings, 0.006);
    for (let i = 0; i < 35; i++) tracker.add(shifted(a, 0, -(i * 3 % 55)), i / 8);
    assert(tracker.finish().length === 0, 'scroll retenu');
  });
  await test('Scroll continu lent : aucune fenêtre stable', () => {
    const tracker = new WindowTracker(settings, 0.006);
    for (let i = 0; i < 30; i++) tracker.add(shifted(a, 0, -i), i / 8);
    assert(tracker.finish().length === 0, 'scroll lent retenu');
  });
  await test('Animation locale dans un coin : la page reste stable', () => {
    const data = a.gray.slice(); rectangle(data, a.width, a.height, 2, 2, 7, 7, 20);
    assert(motionMetrics(a, describe(data, a.width, a.height), 0.006).localAnimation, 'coin non ignoré');
  });
  await test('Un numéro modifié durablement dans un coin crée une candidate', () => {
    const tracker = new WindowTracker(settings, 0.006), data = a.gray.slice(); rectangle(data, a.width, a.height, 3, 3, 5, 7, 20);
    const changed = describe(data, a.width, a.height);
    for (let i = 0; i < 16; i++) tracker.add(i < 8 ? a : changed, i / 8);
    assert(tracker.finish().length === 2, 'changement persistant ignoré');
  });
  await test('Une petite modification noyée dans les marges reste détectable', () => {
    const first = page(1, 384, 512), data = first.gray.slice(); rectangle(data, 384, 512, 190, 250, 3, 4, 0);
    const second = describe(data, 384, 512), tracker = new WindowTracker(settings, 0.006);
    for (let i = 0; i < 12; i++) tracker.add(i < 6 ? first : second, i / 8);
    assert(tracker.finish().length === 2, 'petite différence noyée dans la moyenne');
  });
  await test('Un clignotement intermittent ne multiplie pas les pages', () => {
    const tracker = new WindowTracker(settings, 0.006), data = a.gray.slice(); rectangle(data, a.width, a.height, 3, 3, 5, 7, 20);
    const blink = describe(data, a.width, a.height);
    for (let i = 0; i < 32; i++) tracker.add(i % 2 ? a : blink, i / 8);
    assert(tracker.finish().length === 1, 'clignotement segmenté');
  });
  await test('Doublon exact supprimable', () => assert(verifyDuplicate(a, page(1)).kind === 'duplicate', 'doublon'));
  await test('Une petite correction de cadrage ne crée pas une seconde photo', () => assert(verifyDuplicate(a, shifted(a, 0, 1)).kind === 'duplicate', 'doublon décalé'));
  await test('Bruit faible de compression toléré', () => {
    const data = a.gray.map((n, i) => Math.max(0, Math.min(255, n + i % 3 - 1)));
    assert(verifyDuplicate(a, describe(data, a.width, a.height)).kind === 'duplicate', 'bruit pris pour un changement');
  });
  await test('Un petit caractère modifié doit rester une vraie page', () => {
    const data = a.gray.slice(); rectangle(data, a.width, a.height, 70, 90, 3, 5, 0);
    assert(verifyDuplicate(a, describe(data, a.width, a.height)).kind !== 'duplicate', 'petite modification supprimée');
  });
  await test('Vraies lettres anticrénelées : 17 et 18 restent deux pages', () => {
    const frames = TEXT_PATCHES.map(runs => {
      const original = page(1, 768, 1024), patch = [];
      for (const [value, count] of runs) for (let i = 0; i < count; i++) patch.push(value);
      for (let y = 0; y < 32; y++) original.gray.set(patch.slice(y * 135, (y + 1) * 135), (450 + y) * 768 + 300);
      return describe(original.gray, 768, 1024);
    });
    assert(verifyDuplicate(frames[0], frames[1]).kind !== 'duplicate', 'chiffre différent supprimé');
    assert(verifyDuplicate(frames[0], frames[0]).kind === 'duplicate', 'même texte conservé deux fois');
  });
  await test('Pages différentes et déduplication désactivée', () => {
    assert(verifyDuplicate(a, b).kind !== 'duplicate', 'pages confondues');
    assert(verifyDuplicate(a, a, 0).kind === 'different', 'désactivation ignorée');
  });
  await test('Calibration bornée même si toute la vidéo bouge', () => assert(adaptiveThreshold([0.3, 0.4, 0.2], 0.012) <= 0.022, 'seuil trop grand'));
  for (const dark of [false, true]) await test(`Recadrage automatique : document ${dark ? 'sombre' : 'clair'}`, () => {
    const result = inferCrop([screenshot(1, dark), screenshot(2, dark), screenshot(3, dark), screenshot(4, dark), screenshot(5, dark)], 2000, 2800);
    assert(result.confidence === 'high', JSON.stringify(result));
    const c = result.crop;
    assert(c.x <= 240 && c.x >= 190 && c.y <= 320 && c.y >= 270 && c.x + c.w >= 1760 && c.y + c.h >= 2480, JSON.stringify(c));
  });
  await test('Un menu temporaire ne détermine pas le recadrage', () => {
    const frames = [screenshot(1), screenshot(2), screenshot(3, false, true), screenshot(4), screenshot(5)];
    assert(inferCrop(frames, 200, 280).confidence === 'high', 'menu change le cadre');
  });
  await test('Sans limites fiables : conserver l’image entière', () => {
    const full = inferCrop([a, b, page(3), page(4), page(5), page(6), page(7)], 144, 192);
    assert(full.crop.x === 0 && full.crop.y === 0 && full.crop.w === 144 && full.crop.h === 192, JSON.stringify(full));
  });
  await test('Une ligne de tableau fine ne devient pas une marge', () => {
    const frames = [1, 2, 3, 4, 5, 6, 7].map(seed => { const f = page(seed); rectangle(f.gray, f.width, f.height, 1, 22, 142, 1, 0); return describe(f.gray, f.width, f.height); });
    assert(inferCrop(frames, 144, 192).crop.y === 0, 'ligne prise pour une bordure');
  });
  await test('Feuille avec ombres : quatre bords et proportions préservés', () => {
    const frames = Array.from({ length: 7 }, (_, seed) => {
      const w = 320, h = 240, data = new Uint8Array(w * h).fill(239);
      rectangle(data, w, h, 80, 16, 160, 217, 255);
      rectangle(data, w, h, 79, 15, 1, 219, 110);
      rectangle(data, w, h, 240, 15, 1, 219, 110);
      rectangle(data, w, h, 79, 15, 162, 1, 215);
      rectangle(data, w, h, 79, 233, 162, 1, 215);
      const inner = page(seed + 1, 140, 180);
      for (let y = 0; y < 180; y++) data.set(inner.gray.subarray(y * 140, (y + 1) * 140), (y + 25) * w + 90);
      return describe(data, w, h);
    });
    const result = inferCrop(frames, 960, 720), c = result.crop;
    assert(result.confidence === 'high' && c.x >= 230 && c.x <= 243 && c.y >= 42 && c.y <= 51 && c.y + c.h >= 690 && c.y + c.h <= 705 && c.x + c.w >= 717 && c.x + c.w <= 730, JSON.stringify(result));
  });
  function codecNoise(frame) {
    const data = frame.gray.slice(); let seed = 4;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (frame.edge[i] > 10 && seed % 10 === 0) data[i] = Math.max(0, Math.min(255, data[i] + (seed % 3 ? -24 : 24)));
    }
    return describe(data, frame.width, frame.height);
  }
  await test('Compression répartie : une seule page', () => {
    assert(verifyDuplicate(a, codecNoise(a)).kind === 'duplicate', 'bruit pris pour une page');
  });
  await test('Correction locale avec compression : conserver le texte modifié', () => {
    const noise = codecNoise(a); rectangle(noise.gray, a.width, a.height, 70, 90, 3, 5, 0);
    assert(verifyDuplicate(a, describe(noise.gray, a.width, a.height)).kind !== 'duplicate', 'correction supprimée');
  });
  await test('Panneau système assombrissant la même feuille : image masquée reconnue', () => {
    const dimmed = describe(Uint8Array.from(a.gray, p => Math.round(p * 0.5 + 5)), a.width, a.height);
    assert(verifyDuplicate(a, dimmed).kind === 'obscured', 'image assombrie non reconnue');
    const other = describe(Uint8Array.from(b.gray, p => Math.round(p * 0.5 + 5)), b.width, b.height);
    assert(verifyDuplicate(a, other).kind !== 'obscured', 'autre feuille rejetée');
  });
  await test('Nettoyage du compteur : ne pas effacer une note de bas de page', () => {
    const w = 48, h = 21, data = new Uint8Array(w * h * 4).fill(255);
    for (let y = 3; y < h - 3; y++) for (let x = 8; x < w - 8; x++) for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = 220;
    assert(isViewerBadge(data, w, h), 'compteur gris non reconnu');
    data.fill(255);
    for (let y = 7; y < 13; y++) for (let x = 8; x < w - 8; x += 4) for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = 25;
    assert(!isViewerBadge(data, w, h), 'texte de pied de page effacé');
  });
  await test('Seek séquentiel, timestamp identique et libération des écouteurs', async () => {
    const v = new TestVideo(), signal = new TestSignal(); await seekVideoTo(v, 1, signal); await seekVideoTo(v, 1, signal);
    assert(!v.concurrent && !v.listenerCount() && !signal.listeners.size, 'écouteurs ou seeks concurrents');
  });
  await test('Annulation avant un seek', async () => {
    const v = new TestVideo(), signal = new TestSignal(); signal.abort(); let aborted = false;
    try { await seekVideoTo(v, 1, signal); } catch (e) { aborted = e.name === 'AbortError'; }
    assert(aborted && !v.seeks, 'annulation ignorée');
  });
  await test('Annulation pendant un seek et nettoyage des événements', async () => {
    const v = new TestVideo(), signal = new TestSignal(); let aborted = false;
    const pending = seekVideoTo(v, 2, signal); signal.abort();
    try { await pending; } catch (e) { aborted = e.name === 'AbortError'; }
    assert(aborted && !v.listenerCount() && !signal.listeners.size, 'écouteurs après annulation');
  });
  await test('Erreur de décodage : message lisible et écouteurs libérés', async () => {
    const v = new TestVideo(), signal = new TestSignal(); let error = null;
    const pending = seekVideoTo(v, 2, signal);
    for (const handler of [...v.listeners.get('error')]) handler();
    try { await pending; } catch (e) { error = e; }
    assert(error?.message.includes('Safari') && !v.listenerCount() && !signal.listeners.size, 'erreur non gérée');
  });
  function scene(time) {
    if (time < 0.75) return a;
    if (time < 1.25) return shifted(b, 0, -Math.floor(time * 75) % 30);
    if (time < 1.75) return b;
    if (time < 2.25) return shifted(a, 0, -Math.floor(time * 75) % 30);
    return a;
  }
  async function integration(duplicate, shouldAbort = false) {
    const v = new TestVideo(3), signal = new TestSignal(), accepted = [], values = [], resolutions = [], disposed = [];
    const result = await analyzeVideo(v, { x: 0, y: 0, w: 144, h: 192 }, { ...settings, duplicate }, signal,
      (percent) => { values.push(percent); if (shouldAbort && percent > 20) signal.abort(); }, p => accepted.push(p), {
        createSampler(crop, max) { resolutions.push(max); return { read: video => scene(video.currentTime), dispose: () => disposed.push(max) }; },
        captureFrame: async video => ({ time: video.currentTime, width: 144, height: 192, blob: { size: 100 }, thumbnail: { size: 20 } })
      });
    assert(!v.concurrent && !v.listenerCount(), 'seeks ou écouteurs');
    assert(disposed.length === 4 && resolutions.includes(1280), 'samplers non libérés');
    assert(values.every((p, i) => !i || p >= values[i - 1]) && values.at(-1) === 100, 'progression');
    return { result, accepted };
  }
  await test('Pipeline A → B (pause 0,5 s) → A : deux images finales', async () => {
    const { result, accepted } = await integration(0.006);
    assert(accepted.length === 2 && result.duplicates.length >= 1, JSON.stringify({ count: accepted.length, result }));
    assert(accepted.some(p => p.time >= 1.25 && p.time < 1.75), 'pause de 0,5 s perdue');
  });
  await test('Pipeline sans suppression : le retour A reste récupérable', async () => assert((await integration(0)).accepted.length === 3, 'retour supprimé'));
  await test('Annulation pendant la recherche des pauses', async () => {
    let aborted = false; try { await integration(0.006, true); } catch (e) { aborted = e.name === 'AbortError'; }
    assert(aborted, 'traitement non annulé');
  });
  await test('Limite mémoire simulée : conserver la première page et tout libérer', async () => {
    const v = new TestVideo(3), signal = new TestSignal(), disposed = [], retained = []; let caught = false;
    try {
      await analyzeVideo(v, { x: 0, y: 0, w: 144, h: 192 }, settings, signal, () => {}, p => {
        if (retained.length) throw new Error('Mémoire insuffisante simulée'); retained.push(p);
      }, { createSampler: (crop, max) => ({ read: video => scene(video.currentTime), dispose: () => disposed.push(max) }), captureFrame: async video => ({ time: video.currentTime, blob: { size: 100 }, thumbnail: { size: 20 } }) });
    } catch (e) { caught = e.message.includes('Mémoire'); }
    assert(caught && retained.length === 1 && disposed.length === 4 && !v.listenerCount(), 'nettoyage après erreur');
  });
  await test('La meilleure candidate évite une image floue au milieu', async () => {
    const v = new TestVideo(), signal = new TestSignal();
    const sampler = { read: video => Math.abs(video.currentTime - 0.5) < 0.11 ? blurred(a) : a };
    const result = await refineWindow(v, sampler, { start: 0, end: 1, samples: [], short: false }, settings, 0.006, signal);
    assert(result && Math.abs(result.time - 0.5) >= 0.11, 'frame floue choisie');
  });
  await test('Un écran entièrement vide ne devient pas une page', async () => {
    const blank = describe(new Uint8Array(144 * 192).fill(255), 144, 192);
    const result = await refineWindow(new TestVideo(), { read: () => blank }, { start: 0, end: 1, samples: [], short: false }, settings, 0.006, new TestSignal());
    assert(result === null, 'écran vide retenu');
  });
  return results;
}
