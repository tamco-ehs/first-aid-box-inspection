type PdfFont = 'regular' | 'bold';

type TextOptions = {
  size?: number;
  font?: PdfFont;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 42;
const BOTTOM = 44;

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?');
}

function escapePdfText(value: unknown): string {
  return cleanText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const clean = cleanText(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const maxChars = Math.max(12, Math.floor(maxWidth / (fontSize * 0.52)));
  const words = clean.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }

    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export class SimplePdf {
  private pages: string[] = [];
  private commands: string[] = [];
  private y = PAGE_HEIGHT - MARGIN;

  constructor(private readonly title: string) {
    this.newPage();
  }

  heading(text: string, size = 16): void {
    this.ensureSpace(size + 10);
    this.text(text, MARGIN, this.y, { size, font: 'bold' });
    this.y -= size + 10;
  }

  paragraph(text: string, options: TextOptions = {}): void {
    const size = options.size ?? 9;
    const lines = wrapText(text, PAGE_WIDTH - MARGIN * 2, size);
    for (const line of lines) {
      this.ensureSpace(size + 4);
      this.text(line, MARGIN, this.y, { size, font: options.font });
      this.y -= size + 4;
    }
  }

  keyValue(label: string, value: unknown): void {
    this.ensureSpace(14);
    this.text(`${label}:`, MARGIN, this.y, { size: 9, font: 'bold' });
    this.text(cleanText(value || '-'), MARGIN + 130, this.y, { size: 9 });
    this.y -= 14;
  }

  rule(): void {
    this.ensureSpace(12);
    this.commands.push(`0.75 w 0.82 0.86 0.91 RG ${MARGIN} ${this.y} m ${PAGE_WIDTH - MARGIN} ${this.y} l S`);
    this.y -= 12;
  }

  spacer(height = 8): void {
    this.ensureSpace(height);
    this.y -= height;
  }

  tableHeader(columns: string[], widths: number[]): void {
    this.ensureSpace(18);
    this.commands.push(`0.94 0.96 0.98 rg ${MARGIN} ${this.y - 4} ${PAGE_WIDTH - MARGIN * 2} 16 re f`);
    let x = MARGIN + 4;
    for (let i = 0; i < columns.length; i++) {
      this.text(columns[i] ?? '', x, this.y, { size: 8, font: 'bold' });
      x += widths[i] ?? 60;
    }
    this.y -= 18;
  }

  tableRow(values: string[], widths: number[], minHeight = 24): void {
    const size = 7.5;
    const wrapped = values.map((value, i) => wrapText(value, Math.max(20, (widths[i] ?? 60) - 8), size));
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = Math.max(minHeight, lineCount * (size + 3) + 8);
    this.ensureSpace(height);
    this.commands.push(`0.90 0.93 0.96 RG 0.35 w ${MARGIN} ${this.y - height + 4} m ${PAGE_WIDTH - MARGIN} ${this.y - height + 4} l S`);
    let x = MARGIN + 4;
    for (let i = 0; i < wrapped.length; i++) {
      let lineY = this.y - 8;
      for (const line of wrapped[i] ?? []) {
        this.text(line, x, lineY, { size });
        lineY -= size + 3;
      }
      x += widths[i] ?? 60;
    }
    this.y -= height;
  }

  toBytes(): Uint8Array {
    this.finishPage();
    return buildPdf(this.pages, this.title);
  }

  private text(text: string, x: number, y: number, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const font = options.font === 'bold' ? 'F2' : 'F1';
    this.commands.push(`BT /${font} ${size} Tf 0 0 0 rg ${x} ${y} Td (${escapePdfText(text)}) Tj ET`);
  }

  private ensureSpace(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  private newPage(): void {
    this.finishPage();
    this.commands = [];
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private finishPage(): void {
    if (this.commands.length > 0) this.pages.push(this.commands.join('\n'));
  }
}

function buildPdf(pageStreams: string[], title: string): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  let nextId = 5;
  for (const stream of pageStreams) {
    const pageId = nextId++;
    const contentId = nextId++;
    pageIds.push(pageId);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const infoId = nextId++;
  objects[infoId] = `<< /Title (${escapePdfText(title)}) /Producer (First Aid Box Inspection System) >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xref = byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    const offset = offsets[id] ?? 0;
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
