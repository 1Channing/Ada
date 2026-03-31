import { PDFPage, PDFFont, rgb } from 'pdf-lib';

export function renderBoxedField(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  charSpacing: number = 12
): void {
  console.log(`[DRAW_BOXED] Rendering boxed field: "${text}" at (${x}, ${y}) with char spacing ${charSpacing}`);

  const chars = text.toUpperCase().split('');

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charX = x + (i * charSpacing);

    page.drawText(char, {
      x: charX,
      y: y,
      size: size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log(`[DRAW_BOXED] Rendered ${chars.length} characters`);
}

export function renderMultilineText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  maxCharsPerLine: number = 60,
  maxLines: number = 5,
  lineHeight: number = 12
): void {
  console.log(`[DRAW_MULTILINE] Rendering multiline text at (${x}, ${y}), max ${maxLines} lines`);

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  const linesToRender = lines.slice(0, maxLines);

  for (let i = 0; i < linesToRender.length; i++) {
    const line = linesToRender[i];
    const lineY = y - (i * lineHeight);

    page.drawText(line, {
      x: x,
      y: lineY,
      size: size,
      font: font,
      color: rgb(0, 0, 0),
    });
  }

  console.log(`[DRAW_MULTILINE] Rendered ${linesToRender.length} lines`);
}
