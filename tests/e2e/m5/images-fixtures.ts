import sharp from "sharp";

/**
 * Real images for the image specs (M5-11 to M5-14), made with sharp: the upload route decodes what
 * it is sent, so the header-only and zero-padded stand-ins of the older specs no longer pass for
 * photos. Pure (no Playwright, no network), so Vitest imports it too.
 */

export interface PhotoOptions {
  width: number;
  height: number;
  /** Noise makes the file photographic (hard to compress); flat colours compress to almost nothing. */
  noise?: boolean;
  /** EXIF orientation tag (6 means "rotate 90 degrees clockwise to display"). */
  orientation?: number;
  /** Embeds GPS EXIF (latitude and longitude). */
  gps?: boolean;
  quality?: number;
  /** Flat colour of a non-noise image (distinct colours give distinct stored bytes). */
  color?: [number, number, number];
}

const EXIF_GPS = {
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "40/1 26/1 46/1",
    GPSLongitudeRef: "W",
    GPSLongitude: "79/1 58/1 56/1",
  },
};

const rgb = ([r, g, b]: [number, number, number]) => ({ r, g, b });

/** A JPEG. */
export async function makeJpeg(opts: PhotoOptions): Promise<Buffer> {
  const base = opts.noise
    ? sharp({
        create: {
          width: opts.width,
          height: opts.height,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: "gaussian", mean: 128, sigma: 40 },
        },
      })
    : sharp({
        create: {
          width: opts.width,
          height: opts.height,
          channels: 3,
          background: rgb(opts.color ?? [196, 106, 79]),
        },
      });
  let image = base.jpeg({ quality: opts.quality ?? 88 });
  if (opts.gps || opts.orientation) {
    image = image.withMetadata({
      ...(opts.orientation ? { orientation: opts.orientation } : {}),
      ...(opts.gps ? { exif: EXIF_GPS } : {}),
    });
  }
  return image.toBuffer();
}

/** A PNG (flat colour, or noise when `noise` is set). */
export async function makePngImage(opts: PhotoOptions): Promise<Buffer> {
  const base = opts.noise
    ? sharp({
        create: {
          width: opts.width,
          height: opts.height,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: "gaussian", mean: 128, sigma: 50 },
        },
      })
    : sharp({
        create: {
          width: opts.width,
          height: opts.height,
          channels: 3,
          background: rgb(opts.color ?? [40, 90, 160]),
        },
      });
  return base.png({ compressionLevel: opts.noise ? 1 : 9 }).toBuffer();
}

/** A WebP. */
export async function makeWebpImage(opts: PhotoOptions): Promise<Buffer> {
  return sharp({
    create: {
      width: opts.width,
      height: opts.height,
      channels: 3,
      background: { r: 20, g: 120, b: 90 },
    },
  })
    .webp({ quality: 80 })
    .toBuffer();
}

/** The first bytes of an MP4 file (ftyp box, brand mp42), padded: video is embed-only, never uploaded. */
export const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypmp42"),
  Buffer.alloc(2000),
]);

/** A QuickTime .mov (ftyp box, brand "qt  "). */
export const MOV_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x14]),
  Buffer.from("ftypqt  "),
  Buffer.alloc(2000),
]);

/** A WebM (Matroska EBML header 1A 45 DF A3). */
export const WEBM_BYTES = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  Buffer.alloc(2000),
]);

/** A PNG with a transparent half, to check that alpha survives the conversion. */
export async function makeAlphaPng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 220;
      raw[i + 1] = 40;
      raw[i + 2] = 40;
      raw[i + 3] = x < width / 2 ? 0 : 255;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** The first `length` bytes of a buffer: a truncated, corrupt image. */
export const truncated = (data: Buffer, length: number): Buffer => data.subarray(0, length);
