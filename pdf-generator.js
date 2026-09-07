import { ImagePDF } from './lib/image-pdf.js';
import { canvasBlob, checkAbort } from './video-analyzer.js';

async function recompress(page, quality) {
  const url = URL.createObjectURL(page.blob), image = new Image(), canvas = document.createElement('canvas');
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Une page ne peut pas être lue. Supprimez-la puis ajoutez-la de nouveau.')); image.src = url; });
    canvas.width = page.width; canvas.height = page.height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Mémoire insuffisante. Essayez moins de pages.');
    ctx.drawImage(image, 0, 0); return await canvasBlob(canvas, quality);
  } finally { URL.revokeObjectURL(url); image.src = ''; canvas.width = canvas.height = 1; }
}

export async function generatePDF(pages, quality, signal, onProgress) {
  const pdf = new ImagePDF();
  for (let i = 0; i < pages.length; i++) {
    checkAbort(signal); const page = pages[i];
    const jpeg = quality === 'maximum' ? page.blob : await recompress(page, quality === 'high' ? 0.92 : 0.8);
    checkAbort(signal); pdf.addJPEG(jpeg, page.width, page.height);
    onProgress(Math.round((i + 1) / pages.length * 100));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkAbort(signal); return pdf.finish();
}
