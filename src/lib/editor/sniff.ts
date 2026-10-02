/**
 * The image type a file really is, from its first bytes: JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A,
 * WebP "RIFF" ???? "WEBP". The file name and the declared type are not looked at (a text file
 * renamed .jpg must be refused). The upload route sniffs again on the server; this is the early,
 * friendly answer.
 */
export async function sniffImageType(file: Blob): Promise<"jpg" | "png" | "webp" | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const at = (i: number) => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => at(i) === byte)) return "png";
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (riff.every((byte, i) => at(i) === byte) && webp.every((byte, i) => at(8 + i) === byte)) {
    return "webp";
  }
  return null;
}
