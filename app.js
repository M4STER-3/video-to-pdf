import { RECOMMENDED, seekVideoTo, captureFrame, analyzeVideo } from './video-analyzer.js';
import { generatePDF } from './pdf-generator.js';

const $ = id => document.getElementById(id), video = $('video');
let videoURL = null, pdfURL = null, pdfFile = null, crop = null;
let pages = [], deleted = [], busy = false, controller = null, stage = 1;
const MAX_BYTES = 160 * 1024 * 1024, MAX_PAGES = 200;
const formatSize = size => `${(size / 1024 / 1024).toFixed(1)} Mo`;
const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
function message(text) { $('message').textContent = text; $('message').hidden = !text; }
function friendly(error) {
  if (error?.name === 'AbortError') return 'Traitement annulé. Les pages déjà extraites restent disponibles.';
  if (error instanceof Error && !['SecurityError', 'InvalidStateError', 'EncodingError', 'QuotaExceededError'].includes(error.name) && /[àâéèêîôùûç]|Safari|JPEG|MP4/.test(error.message)) return error.message;
  return 'Cette opération n’a pas pu aboutir. Vérifiez que la vidéo est lisible, fermez les autres applications ou essayez un extrait plus court.';
}
function invalidatePDF() {
  if (pdfURL) URL.revokeObjectURL(pdfURL); pdfURL = null; pdfFile = null;
  $('download').removeAttribute('href'); $('export-result').hidden = true;
}
function releasePage(page) { if (page.url) URL.revokeObjectURL(page.url); }
function clearPages() { pages.forEach(releasePage); deleted.forEach(item => releasePage(item.page)); pages = []; deleted = []; invalidatePDF(); renderPages(); }
function setStage(next) {
  stage = next;
  document.querySelectorAll('.steps li').forEach((li, i) => { if (i === next - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  $('video-actions').hidden = next !== 1;
  $('crop-actions').hidden = next !== 2;
  $('analysis-actions').hidden = next !== 3;
  $('manual-actions').hidden = next < 4;
  $('crop-overlay').hidden = next !== 2;
  $('video-stage').classList.toggle('cropping', next === 2);
  $('timeline-panel').hidden = next < 2;
  video.controls = next !== 2 && !busy;
  $('pages-panel').hidden = next < 4;
  $('pdf-panel').hidden = next < 4;
  $('advanced').hidden = next < 3;
  if (next === 2) drawCrop();
}
function setBusy(value, label = 'Analyse en cours') {
  busy = value;
  document.querySelectorAll('button,input,select').forEach(el => { if (el.id !== 'cancel') el.disabled = value; });
  $('progress-panel').hidden = !value; $('progress-title').textContent = label;
  $('cancel').textContent = label.startsWith('Création') ? 'Annuler la création' : 'Annuler l’analyse';
  video.controls = !value && stage !== 2;
  if (value) ['video-actions', 'crop-actions', 'analysis-actions', 'manual-actions'].forEach(id => $(id).hidden = true);
  else { setStage(stage); renderPages(); }
}
async function task(fn, label) {
  if (busy) return;
  controller = new AbortController(); message(''); $('progress').value = 0; $('progress-text').textContent = 'Préparation…'; setBusy(true, label);
  try { await fn(controller.signal); } catch (error) { message(friendly(error)); }
  finally { setBusy(false); controller = null; }
}
function readSettings() {
  const result = {};
  for (const key of Object.keys(RECOMMENDED)) {
    const input = $(`setting-${key}`);
    if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) { input.reportValidity(); throw new Error('Vérifiez les valeurs des réglages avancés.'); }
    result[key] = input.valueAsNumber / (['motion', 'duplicate', 'jpeg'].includes(key) ? 100 : 1);
  }
  return result;
}
function totalBytes() { return [...pages, ...deleted.map(x => x.page)].reduce((sum, p) => sum + p.blob.size + p.thumbnail.size, 0); }
function acceptPage(page) {
  if (pages.length + deleted.length >= MAX_PAGES || totalBytes() + page.blob.size + page.thumbnail.size > MAX_BYTES) throw new Error('La limite de sécurité mémoire est atteinte (200 pages ou 160 Mo). Exportez les pages présentes, puis traitez un extrait plus court.');
  page.url = URL.createObjectURL(page.thumbnail); pages.push(page); invalidatePDF();
}
function renderPages() {
  const grid = $('pages-grid'); grid.replaceChildren();
  pages.forEach((page, index) => {
    const card = document.createElement('article'); card.className = 'page-card';
    const img = new Image(); img.src = page.url; img.alt = `Page ${index + 1}`; img.loading = 'lazy';
    const caption = document.createElement('div'); caption.className = 'page-caption';
    const number = document.createElement('strong'); number.textContent = `Page ${index + 1}`;
    const time = document.createElement('span'); time.textContent = formatTime(page.time); caption.append(number, time);
    const buttons = document.createElement('div'); buttons.className = 'page-buttons';
    for (const [label, text, action, disabled, css] of [
      [`Avancer la page ${index + 1}`, '←', () => move(index, -1), index === 0, ''],
      [`Reculer la page ${index + 1}`, '→', () => move(index, 1), index === pages.length - 1, ''],
      [`Supprimer la page ${index + 1}`, '×', () => remove(index), false, 'delete']
    ]) { const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', label); button.className = css; button.disabled = busy || disabled; button.onclick = action; buttons.append(button); }
    card.append(img, caption, buttons); grid.append(card);
  });
  $('page-count').textContent = pages.length; $('empty-pages').hidden = pages.length > 0;
  $('undo').disabled = busy || !deleted.length; $('create-pdf').disabled = busy || !pages.length;
  const size = pages.reduce((sum, p) => sum + p.blob.size, 0);
  $('size-warning').hidden = pages.length < 80 && size < 50 * 1024 * 1024;
  $('size-warning').textContent = `Document volumineux : ${pages.length} pages, ${formatSize(size)} d’images. Préférez la qualité normale ou plusieurs petits PDF si Safari manque de mémoire.`;
}
function move(index, direction) {
  if (busy) return; const target = index + direction;
  if (target < 0 || target >= pages.length) return;
  [pages[index], pages[target]] = [pages[target], pages[index]]; invalidatePDF(); renderPages();
  $('pages-grid').children[target]?.querySelector('button:not(:disabled)')?.focus();
}
function remove(index) {
  if (busy) return; deleted.push({ page: pages.splice(index, 1)[0], index });
  if (deleted.length > 5) releasePage(deleted.shift().page); invalidatePDF(); renderPages();
}
$('undo').onclick = () => { if (busy || !deleted.length) return; const entry = deleted.pop(); pages.splice(Math.min(entry.index, pages.length), 0, entry.page); invalidatePDF(); renderPages(); };

function waitForMetadata(signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('loadedmetadata', ready); video.removeEventListener('error', failed); signal?.removeEventListener('abort', abort); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Cette vidéo ne peut pas être décodée par ce navigateur. Choisissez une vidéo MP4 ou MOV lisible dans Safari.')); };
    const abort = () => { cleanup(); reject(new DOMException('Ouverture annulée', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('La vidéo n’a pas pu être ouverte. Téléchargez-la d’abord sur cet iPad depuis Fichiers ou Photos, puis réessayez.')); }, 20000);
    video.addEventListener('loadedmetadata', ready, { once: true }); video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
  });
}
$('file-input').onchange = async event => {
  const file = event.target.files?.[0]; if (!file || busy) return;
  if (!file.size || (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm)$/i.test(file.name))) { message('Choisissez un fichier vidéo MP4 ou MOV valide.'); event.target.value = ''; return; }
  await task(async signal => {
    clearPages(); video.pause(); video.removeAttribute('src'); video.load();
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(file);
    try {
      const ready = waitForMetadata(signal); video.src = videoURL; video.load(); await ready;
      if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Les dimensions ou la durée de cette vidéo sont illisibles. Essayez un autre enregistrement.');
      await seekVideoTo(video, 0, signal);
      crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
      $('file-name').textContent = file.name; $('file-meta').textContent = `${formatSize(file.size)} · ${formatTime(video.duration)} · ${video.videoWidth} × ${video.videoHeight}`;
      $('timeline').max = Math.max(0, video.duration - 0.001); $('import-panel').hidden = true; $('workspace').hidden = false; stage = 1;
    } catch (error) {
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(videoURL); videoURL = null; crop = null;
      $('workspace').hidden = true; $('import-panel').hidden = false; stage = 1; throw error;
    } finally { event.target.value = ''; }
  }, 'Ouverture de la vidéo');
};
$('change-video').onclick = () => { if (!busy) $('file-input').click(); };
$('continue').onclick = () => { video.pause(); setStage(2); };
function drawCrop() {
  if (!crop) return;
  const width = video.videoWidth, height = video.videoHeight;
  Object.assign($('crop-rect').style, { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`, width: `${crop.w / width * 100}%`, height: `${crop.h / height * 100}%` });
  $('crop-size').textContent = `${crop.w} × ${crop.h} pixels conservés`;
  $('manual-crop').textContent = `Recadrage appliqué : ${crop.w} × ${crop.h} pixels.`;
}
function resetCrop() { crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }; drawCrop(); }
$('reset-crop').onclick = resetCrop; $('no-crop').onclick = resetCrop;
$('full-width').onclick = () => { crop.x = 0; crop.w = video.videoWidth; drawCrop(); };
$('validate-crop').onclick = () => { drawCrop(); setStage(3); };
$('edit-crop').onclick = () => setStage(2);
function adjustEdge(edge, position, original) {
  const right = original.x + original.w, bottom = original.y + original.h;
  const minimum = Math.min(32, video.videoWidth, video.videoHeight);
  position = Math.round(position);
  if (edge === 'left') { crop.x = Math.max(0, Math.min(position, right - minimum)); crop.w = right - crop.x; }
  if (edge === 'right') crop.w = Math.max(minimum, Math.min(video.videoWidth, position) - original.x);
  if (edge === 'top') { crop.y = Math.max(0, Math.min(position, bottom - minimum)); crop.h = bottom - crop.y; }
  if (edge === 'bottom') crop.h = Math.max(minimum, Math.min(video.videoHeight, position) - original.y);
  drawCrop();
}
document.querySelectorAll('[data-edge]').forEach(handle => {
  let drag = null;
  handle.onpointerdown = event => { if (busy) return; event.preventDefault(); drag = { x: event.clientX, y: event.clientY, crop: { ...crop }, bounds: $('crop-overlay').getBoundingClientRect() }; handle.setPointerCapture(event.pointerId); };
  handle.onpointermove = event => {
    if (!drag) return; const edge = handle.dataset.edge, c = drag.crop;
    const horizontal = edge === 'left' || edge === 'right';
    const delta = horizontal ? (event.clientX - drag.x) / drag.bounds.width * video.videoWidth : (event.clientY - drag.y) / drag.bounds.height * video.videoHeight;
    const start = edge === 'left' ? c.x : edge === 'right' ? c.x + c.w : edge === 'top' ? c.y : c.y + c.h;
    adjustEdge(edge, start + delta, c);
  };
  handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = () => { drag = null; };
  handle.onkeydown = event => {
    if (busy || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const edge = handle.dataset.edge, c = { ...crop };
    const start = edge === 'left' ? c.x : edge === 'right' ? c.x + c.w : edge === 'top' ? c.y : c.y + c.h;
    adjustEdge(edge, start + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) * (event.shiftKey ? 10 : 1), c);
  };
});
function syncTime() { $('timeline').value = video.currentTime || 0; $('timestamp').textContent = formatTime(video.currentTime || 0); }
video.addEventListener('timeupdate', syncTime);
video.addEventListener('error', () => { if (!busy && videoURL) message('La lecture s’est interrompue. Réessayez ou choisissez une vidéo que Safari sait lire.'); });
async function manualSeek(time) { await task(async signal => { await seekVideoTo(video, time, signal); syncTime(); }, 'Positionnement de la vidéo'); }
$('timeline').onchange = event => { const time = Number(event.target.value); void manualSeek(time); };
document.querySelectorAll('[data-seek]').forEach(button => button.onclick = () => void manualSeek(video.currentTime + Number(button.dataset.seek)));
$('skip-analysis').onclick = () => setStage(4);
$('add-frame').onclick = () => void task(async signal => {
  const settings = readSettings(); await seekVideoTo(video, video.currentTime, signal);
  const page = await captureFrame(video, crop, settings.jpeg);
  if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
  acceptPage(page); stage = 4; message(`Page ${pages.length} ajoutée à la sélection.`);
}, 'Capture de la page');
$('analyze').onclick = () => {
  let settings; try { settings = readSettings(); } catch (e) { message(friendly(e)); return; }
  void task(async signal => {
    try {
      await analyzeVideo(video, crop, settings, signal, (percent, count) => { $('progress').value = percent; $('progress-text').textContent = `Analyse : ${percent} % · ${count} pages détectées`; }, acceptPage);
      message(pages.length ? `${pages.length} pages détectées. Vérifiez la sélection avant de créer le PDF.` : 'Aucune pause assez nette n’a été détectée. Ajoutez les pages manuellement avec le lecteur.');
    } finally { stage = 4; }
  }, 'Analyse en cours');
};
$('cancel').onclick = () => controller?.abort();
$('restore-settings').onclick = () => { for (const [key, value] of Object.entries(RECOMMENDED)) $(`setting-${key}`).value = value * (['motion', 'duplicate', 'jpeg'].includes(key) ? 100 : 1); };
$('pdf-quality').onchange = invalidatePDF;
$('create-pdf').onclick = () => { if (!pages.length) return; void task(async signal => {
  invalidatePDF();
  const blob = await generatePDF(pages, $('pdf-quality').value, signal, percent => { $('progress').value = percent; $('progress-text').textContent = `Création du PDF : ${percent} %`; });
  const date = new Date(), stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const name = `document-${stamp}.pdf`;
  pdfFile = new File([blob], name, { type: 'application/pdf' }); pdfURL = URL.createObjectURL(blob);
  $('download').href = pdfURL; $('download').download = name; $('export-result').hidden = false;
  $('pdf-size').textContent = `Votre PDF est prêt · ${pages.length} pages · ${formatSize(blob.size)}`; stage = 5;
  $('export-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}, 'Création du PDF'); };
$('share').onclick = async () => {
  if (!pdfFile || busy) return;
  const shareButton = $('share'); shareButton.disabled = true;
  try {
    if (navigator.share && navigator.canShare?.({ files: [pdfFile] })) await navigator.share({ files: [pdfFile], title: 'Mon document PDF' });
    else { $('download').click(); message('Le partage de fichiers n’est pas disponible ici. Le téléchargement du PDF a été lancé.'); }
  } catch (error) { if (error.name !== 'AbortError') { $('download').click(); message('Le partage n’a pas abouti. Le PDF reste disponible avec « Télécharger le PDF ».'); } }
  finally { shareButton.disabled = false; }
};

// The service worker caches application files only, never the selected video.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => { $('offline-status').textContent = 'Disponible hors connexion'; })
    .catch(() => { $('offline-status').textContent = 'Hors connexion non disponible'; });
}
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  controller?.abort(); video.pause();
  if (videoURL) URL.revokeObjectURL(videoURL);
  if (pdfURL) URL.revokeObjectURL(pdfURL);
  pages.forEach(releasePage); deleted.forEach(item => releasePage(item.page));
});
renderPages();
