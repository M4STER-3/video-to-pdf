import { RECOMMENDED, seekVideoTo, captureFrame } from './video-analyzer.js';
import { analyzeVideo } from './analysis-engine.js';
import { detectAutoCrop } from './auto-crop.js';
import { generatePDF } from './pdf-generator.js';

const $ = id => document.getElementById(id), video = $('video');
let videoURL = null, pdfURL = null, pdfFile = null, crop = null;
let pages = [], deleted = [], busy = false, controller = null, stage = 1;
let cropInfo = null, cropBackup = null, duplicates = [], analysisReport = null;
let previewPage = null, previewURL = null, wakeLock = null;
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
function clearPages() { closePreview(); $('work-image').removeAttribute('src'); $('work-image').hidden = true; pages.forEach(releasePage); deleted.forEach(item => releasePage(item.page)); pages = []; deleted = []; duplicates = []; analysisReport = null; invalidatePDF(); renderPages(); renderDuplicates(); }
function setStage(next) {
  stage = next;
  document.querySelectorAll('.steps li').forEach((li, i) => { if (i === next - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
  $('video-actions').hidden = busy || next !== 1;
  $('crop-actions').hidden = busy || next !== 2;
  $('analysis-actions').hidden = busy || next !== 3;
  $('manual-actions').hidden = busy || next < 4;
  $('crop-overlay').hidden = next !== 2;
  $('video-stage').classList.toggle('cropping', next === 2);
  $('timeline-panel').hidden = next < 2;
  video.controls = next !== 2 && !busy;
  $('pages-panel').hidden = next < 4;
  $('pdf-panel').hidden = next < 4;
  $('advanced').hidden = next < 2;
  if (next === 2) drawCrop();
}
function setBusy(value, label = 'Analyse en cours') {
  busy = value;
  document.querySelectorAll('button,input,select').forEach(el => { if (el.id !== 'cancel') el.disabled = value; });
  $('progress-panel').hidden = !value; $('progress-title').textContent = label;
  $('cancel').textContent = 'Annuler le traitement';
  video.controls = !value && stage !== 2;
  if (value) ['video-actions', 'crop-actions', 'analysis-actions', 'manual-actions'].forEach(id => $(id).hidden = true);
  else { $('work-cover').hidden = true; setStage(stage); renderPages(); renderDuplicates(); }
}
async function task(fn, label) {
  if (busy) return;
  closePreview();
  controller = new AbortController(); message(''); $('progress').value = 0; $('progress-text').textContent = 'Préparation…'; setBusy(true, label);
  try {
    if (navigator.wakeLock?.request) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Optional: screen lock is not required. */ } }
    if (controller.signal.aborted) throw new DOMException('Annulé', 'AbortError');
    await fn(controller.signal);
  } catch (error) { message(friendly(error)); }
  finally { try { await wakeLock?.release(); } catch { /* Already released. */ } wakeLock = null; setBusy(false); controller = null; }
}
function readSettings() {
  const result = {};
  for (const key of Object.keys(RECOMMENDED)) {
    const input = $(`setting-${key}`);
    if (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber < Number(input.min) || input.valueAsNumber > Number(input.max)) { throw new Error('Vérifiez les valeurs des réglages avancés : elles doivent rester dans les limites indiquées.'); }
    const steps = (input.valueAsNumber - Number(input.min)) / Number(input.step);
    if (Math.abs(steps - Math.round(steps)) > 0.00001) throw new Error('Utilisez les incréments indiqués dans les réglages avancés.');
    result[key] = input.valueAsNumber / (['motion', 'duplicate', 'jpeg'].includes(key) ? 100 : 1);
  }
  return result;
}
function totalBytes() { return [...pages, ...deleted.map(x => x.page)].reduce((sum, p) => sum + p.blob.size + p.thumbnail.size, 0); }
function acceptPage(page) {
  if (pages.length + deleted.length >= MAX_PAGES || totalBytes() + page.blob.size + page.thumbnail.size > MAX_BYTES) throw new Error('La limite de sécurité mémoire est atteinte (200 pages ou 160 Mo). Exportez les pages présentes, puis traitez un extrait plus court.');
  page.id ||= `manual-${Date.now()}-${pages.length}`;
  page.url = URL.createObjectURL(page.thumbnail); pages.push(page); invalidatePDF();
  if (!$('work-cover').hidden) { $('work-image').src = page.url; $('work-image').hidden = false; $('work-caption').textContent = `Dernière page retenue · ${pages.length}`; }
}
function renderPages() {
  const grid = $('pages-grid'); grid.replaceChildren();
  pages.forEach((page, index) => {
    if ($('page-filter').value === 'review' && (page.reviewed || !page.reasons?.length)) return;
    const card = document.createElement('article'); card.className = 'page-card';
    const img = new Image(); img.src = page.url; img.alt = `Agrandir la page ${index + 1}`; img.loading = 'lazy';
    const imageButton = document.createElement('button'); imageButton.className = 'page-image-button'; imageButton.onclick = () => openPreview(page); imageButton.disabled = busy; imageButton.append(img);
    const caption = document.createElement('div'); caption.className = 'page-caption';
    const number = document.createElement('strong'); number.textContent = `Page ${index + 1}`;
    const time = document.createElement('span'); time.textContent = formatTime(page.time); caption.append(number, time);
    const buttons = document.createElement('div'); buttons.className = 'page-buttons';
    for (const [label, text, action, disabled, css] of [
      [`Avancer la page ${index + 1}`, '←', () => move(index, -1), index === 0, ''],
      [`Reculer la page ${index + 1}`, '→', () => move(index, 1), index === pages.length - 1, ''],
      [`Supprimer la page ${index + 1}`, '×', () => remove(index), false, 'delete']
    ]) { const button = document.createElement('button'); button.textContent = text; button.setAttribute('aria-label', label); button.className = css; button.disabled = busy || disabled; button.onclick = action; buttons.append(button); }
    const badge = document.createElement('p'); badge.className = 'page-badge';
    badge.textContent = page.reasons?.length && !page.reviewed ? 'À vérifier' : page.reasons?.length ? 'Vérifiée' : page.reviewed ? 'Retenue' : 'Capture manuelle';
    if (page.reasons?.length && !page.reviewed) badge.classList.add('review');
    card.append(imageButton, caption, badge, buttons); grid.append(card);
  });
  $('page-count').textContent = pages.length; $('empty-pages').hidden = pages.length > 0;
  $('undo').disabled = busy || !deleted.length; $('create-pdf').disabled = busy || !pages.length;
  const size = pages.reduce((sum, p) => sum + p.blob.size, 0);
  $('size-warning').hidden = pages.length < 80 && size < 50 * 1024 * 1024;
  $('size-warning').textContent = `Document volumineux : ${pages.length} pages, ${formatSize(size)} d’images. Préférez la qualité normale ou plusieurs petits PDF si Safari manque de mémoire.`;
  const reviewCount = pages.filter(p => p.reasons?.length && !p.reviewed).length;
  $('analysis-summary').textContent = `${pages.length} pages retenues · ${reviewCount} à vérifier · ${duplicates.length} doublons écartés${cropInfo ? ` · ${cropInfo.reason}` : ''}`;
  if ($('page-filter').value === 'review' && !reviewCount) { $('empty-pages').hidden = false; $('empty-pages').textContent = 'Aucune page en attente de vérification.'; }
  else $('empty-pages').textContent = 'Aucune page pour le moment. Ajoutez une frame avec le lecteur ci-dessus.';
}
function move(index, direction) {
  if (busy) return; const target = index + direction;
  if (target < 0 || target >= pages.length) return;
  [pages[index], pages[target]] = [pages[target], pages[index]]; invalidatePDF(); renderPages(); renderDuplicates();
  $('pages-grid').children[target]?.querySelector('button:not(:disabled)')?.focus();
}
function remove(index) {
  if (busy) return; deleted.push({ page: pages.splice(index, 1)[0], index });
  if (deleted.length > 5) releasePage(deleted.shift().page); invalidatePDF(); renderPages(); renderDuplicates();
}
$('undo').onclick = () => {
  if (busy || !deleted.length) return; const entry = deleted.pop();
  if (pages.some(p => p.id === entry.page.id)) { releasePage(entry.page); message('Cette page a déjà été récupérée dans la sélection.'); }
  else pages.splice(Math.min(entry.index, pages.length), 0, entry.page);
  invalidatePDF(); renderPages(); renderDuplicates();
};

function closePreview() {
  if ($('page-preview').open) $('page-preview').close();
  $('preview-image').removeAttribute('src');
  if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; previewPage = null;
}
function openPreview(page) {
  if (busy) return; closePreview(); previewPage = page;
  previewURL = URL.createObjectURL(page.blob); $('preview-image').src = previewURL;
  $('preview-image').classList.remove('full-size'); $('zoom-preview').setAttribute('aria-pressed', 'false'); $('zoom-preview').textContent = 'Voir à taille réelle';
  $('preview-title').textContent = `Page ${pages.indexOf(page) + 1} · ${formatTime(page.time)}`;
  $('preview-reasons').textContent = page.reasons?.join(' · ') || 'Vérifiez le contenu et la netteté de la page.';
  $('page-preview').showModal();
}
$('close-preview').onclick = closePreview;
$('zoom-preview').onclick = () => { const enabled = $('preview-image').classList.toggle('full-size'); $('zoom-preview').setAttribute('aria-pressed', String(enabled)); $('zoom-preview').textContent = enabled ? 'Adapter à l’écran' : 'Voir à taille réelle'; };
$('page-preview').addEventListener('close', () => { $('preview-image').removeAttribute('src'); if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; previewPage = null; });
$('approve-page').onclick = () => { if (previewPage) previewPage.reviewed = true; closePreview(); renderPages(); };
$('delete-preview').onclick = () => { const index = pages.indexOf(previewPage); closePreview(); if (index >= 0) remove(index); };
function renderDuplicates() {
  $('duplicates-panel').hidden = !duplicates.length;
  $('duplicates-summary').textContent = `${duplicates.length} doublons écartés`;
  $('duplicates-list').replaceChildren();
  for (const item of duplicates) {
    const row = document.createElement('div'); row.className = 'duplicate-row';
    const text = document.createElement('span'), match = pages.find(p => p.id === item.matchedId);
    text.textContent = `${formatTime(item.time)} · ${match ? `identique à la page ${pages.indexOf(match) + 1}` : 'page correspondante supprimée'}`;
    const inspect = document.createElement('button'); inspect.textContent = 'Voir dans la vidéo'; inspect.disabled = busy;
    inspect.onclick = () => { void manualSeek(item.time); $('video-stage').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    const restore = document.createElement('button'); restore.textContent = item.restored ? 'Récupérée' : 'Récupérer'; restore.disabled = busy || Boolean(item.restored) || Boolean(match);
    restore.title = match ? 'La même page est déjà dans la sélection.' : 'Récupérer cette image après suppression de sa page correspondante.';
    restore.onclick = () => void task(async signal => {
      await seekVideoTo(video, item.time, signal); const page = await captureFrame(video, crop, readSettings().jpeg);
      if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
      page.id = item.matchedId; page.reviewed = true; acceptPage(page); item.restored = true;
    }, 'Récupération de la page');
    row.append(text, inspect, restore); $('duplicates-list').append(row);
  }
}

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
      crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }; cropInfo = null; cropBackup = null;
      $('file-name').textContent = file.name; $('file-meta').textContent = `${formatSize(file.size)} · ${formatTime(video.duration)} · ${video.videoWidth} × ${video.videoHeight}`;
      $('timeline').max = Math.max(0, video.duration - 0.001); $('import-panel').hidden = true; $('workspace').hidden = false; setStage(3);
    } catch (error) {
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(videoURL); videoURL = null; crop = null;
      $('workspace').hidden = true; $('import-panel').hidden = false; stage = 1; throw error;
    } finally { event.target.value = ''; }
    try { await automaticCrop(signal); await runAnalysis(signal); }
    finally { stage = 4; }
  }, 'Ouverture de la vidéo');
};
$('change-video').onclick = () => { if (!busy) $('file-input').click(); };
$('continue').onclick = () => void task(async signal => { try { await automaticCrop(signal); await runAnalysis(signal); } finally { stage = 4; } }, 'Analyse automatique');
function drawCrop() {
  if (!crop) return;
  const width = video.videoWidth, height = video.videoHeight;
  Object.assign($('crop-rect').style, { left: `${crop.x / width * 100}%`, top: `${crop.y / height * 100}%`, width: `${crop.w / width * 100}%`, height: `${crop.h / height * 100}%` });
  $('crop-size').textContent = `${crop.w} × ${crop.h} pixels conservés`;
  $('manual-crop').textContent = `Recadrage appliqué : ${crop.w} × ${crop.h} pixels.`;
}
function markManualCrop() { cropInfo = { confidence: 'manual', reason: 'Recadrage choisi manuellement.' }; $('crop-reason').textContent = cropInfo.reason; }
function resetCrop() { crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }; markManualCrop(); drawCrop(); }
$('reset-crop').onclick = resetCrop; $('no-crop').onclick = resetCrop;
$('full-width').onclick = () => { crop.x = 0; crop.w = video.videoWidth; markManualCrop(); drawCrop(); };
$('validate-crop').onclick = () => {
  try { readSettings(); } catch (error) { message(friendly(error)); return; }
  void task(async signal => { drawCrop(); try { await runAnalysis(signal); } finally { stage = 4; cropBackup = null; } }, 'Analyse automatique');
};
function reviewCrop() { video.pause(); cropBackup = { crop: { ...crop }, info: cropInfo }; $('crop-reason').textContent = cropInfo?.reason || 'Ajustez les quatre bords.'; setStage(2); }
$('edit-crop').onclick = reviewCrop;
$('review-crop').onclick = reviewCrop;
$('cancel-crop').onclick = () => { if (cropBackup) { crop = cropBackup.crop; cropInfo = cropBackup.info; cropBackup = null; } drawCrop(); setStage(4); };
$('auto-crop').onclick = () => void task(automaticCrop, 'Recherche du cadrage');
function adjustEdge(edge, position, original) {
  const right = original.x + original.w, bottom = original.y + original.h;
  const minimum = Math.min(32, video.videoWidth, video.videoHeight);
  position = Math.round(position);
  if (edge === 'left') { crop.x = Math.max(0, Math.min(position, right - minimum)); crop.w = right - crop.x; }
  if (edge === 'right') crop.w = Math.max(minimum, Math.min(video.videoWidth, position) - original.x);
  if (edge === 'top') { crop.y = Math.max(0, Math.min(position, bottom - minimum)); crop.h = bottom - crop.y; }
  if (edge === 'bottom') crop.h = Math.max(minimum, Math.min(video.videoHeight, position) - original.y);
  markManualCrop(); drawCrop();
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
  if (pages.some(p => Math.abs(p.time - video.currentTime) < 1 / 60)) { message('Cette frame est déjà présente dans la sélection.'); return; }
  const settings = readSettings(); await seekVideoTo(video, video.currentTime, signal);
  const page = await captureFrame(video, crop, settings.jpeg);
  if (signal.aborted) throw new DOMException('Annulé', 'AbortError');
  acceptPage(page); stage = 4; message(`Page ${pages.length} ajoutée à la sélection.`);
}, 'Capture de la page');
async function automaticCrop(signal) {
  $('work-cover').hidden = false; $('work-image').hidden = true; $('work-caption').textContent = 'Recherche de la zone du document…';
  const result = await detectAutoCrop(video, signal, percent => { $('progress-title').textContent = 'Recadrage automatique'; $('progress').value = percent; $('progress-text').textContent = `Recherche des bords : ${percent} %`; });
  crop = result.crop; cropInfo = result; $('crop-reason').textContent = result.reason; drawCrop();
}
async function runAnalysis(signal) {
  const settings = readSettings(); clearPages(); setStage(3);
  $('work-cover').hidden = false; $('work-caption').textContent = 'Recherche des pages stables…';
  try {
    analysisReport = await analyzeVideo(video, crop, settings, signal,
      (percent, count, phase, extra) => { $('progress-title').textContent = phase; $('progress').value = percent; $('progress-text').textContent = `${percent} % · ${count} pages retenues${extra ? ` · ${extra}` : ''}`; }, acceptPage,
      { cropConfidence: cropInfo?.confidence, onDuplicate: item => duplicates.push(item), onFinish: report => { analysisReport = report; } });
    message(pages.length ? `${pages.length} pages retenues ; ${duplicates.length} doublons écartés. Touchez une page pour vérifier sa netteté et son cadrage.` : 'Aucune image assez stable n’a été confirmée. Vérifiez le cadrage ou ajoutez les pages manuellement.');
  } finally { stage = 4; }
}
function rerun() { void task(runAnalysis, 'Analyse automatique'); }
$('analyze').onclick = rerun;
$('rerun').onclick = rerun;
$('page-filter').onchange = renderPages;
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
  if (previewURL) URL.revokeObjectURL(previewURL);
  if (videoURL) URL.revokeObjectURL(videoURL);
  if (pdfURL) URL.revokeObjectURL(pdfURL);
  pages.forEach(releasePage); deleted.forEach(item => releasePage(item.page));
});
renderPages();
