import { QR_PNG_SIZE, drawnSize, type QrCode } from "./generate";

/**
 * The PNG of a QR code (M6-31): 1024x1024 pixels, black modules on white with the quiet zone,
 * drawn on a canvas in the browser. Each module's edges are rounded to whole pixels, so the modules
 * are crisp and differ by at most one pixel in size. Browser only (it needs a canvas); resolves
 * null when the browser cannot make the file.
 */
export function renderQrPng(code: QrCode): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = QR_PNG_SIZE;
  canvas.height = QR_PNG_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  const unit = QR_PNG_SIZE / drawnSize(code);
  const edge = (index: number): number => Math.round(index * unit);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, QR_PNG_SIZE, QR_PNG_SIZE);
  context.fillStyle = "#000000";
  const offset = (drawnSize(code) - code.size) / 2;
  for (let row = 0; row < code.size; row += 1) {
    let col = 0;
    while (col < code.size) {
      if (!code.modules[row]![col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < code.size && code.modules[row]![col]) col += 1;
      const x0 = edge(start + offset);
      const x1 = edge(col + offset);
      const y0 = edge(row + offset);
      const y1 = edge(row + 1 + offset);
      context.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Saves `blob` as `filename` through a temporary link to an object URL: no request is made. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
