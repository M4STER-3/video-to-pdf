/* ImagePDF — MIT license, see LICENSE.txt. JPEG-only, binary-safe PDF writer. */
export class ImagePDF {
  constructor() { this.parts = []; this.offsets = [0]; this.length = 0; this.pages = []; this.write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'); }
  write(value) {
    const part = typeof value === 'string' ? Uint8Array.from(value, c => c.charCodeAt(0)) : value;
    this.parts.push(part); this.length += part.size === undefined ? part.byteLength : part.size;
  }
  object(id, value) { this.offsets[id] = this.length; this.write(`${id} 0 obj\n${value}\nendobj\n`); }
  addJPEG(blob, width, height) {
    if (!blob.size || width < 1 || height < 1) throw new Error('Image invalide.');
    const id = 3 + this.pages.length * 3, image = id + 1, stream = id + 2;
    // Longest edge 842 points. This preserves every pixel and the exact image ratio.
    const scale = 842 / Math.max(width, height), w = +(width * scale).toFixed(5), h = +(height * scale).toFixed(5);
    this.object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${stream} 0 R >>`);
    this.offsets[image] = this.length;
    this.write(`${image} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${blob.size} >>\nstream\n`);
    this.write(blob); this.write('\nendstream\nendobj\n');
    const commands = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    this.object(stream, `<< /Length ${commands.length} >>\nstream\n${commands}endstream`);
    this.pages.push(id);
  }
  finish() {
    if (!this.pages.length) throw new Error('Ajoutez au moins une page.');
    this.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    this.object(2, `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map(id => `${id} 0 R`).join(' ')}] >>`);
    const start = this.length, count = this.offsets.length;
    this.write(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let id = 1; id < count; id++) this.write(`${String(this.offsets[id]).padStart(10, '0')} 00000 n \n`);
    this.write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    const result = new Blob(this.parts, { type: 'application/pdf' }); this.parts = []; return result;
  }
}
