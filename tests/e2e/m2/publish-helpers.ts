import http from "node:http";
import { crc32, deflateSync } from "node:zlib";

/**
 * Helpers for the media, publishing and public-page specs (M2-08, M2-22 to M2-30): raw requests
 * with a Buffer body and any port (the production-build check runs on another port), multipart
 * bodies, and tiny valid image files.
 */

/** Port of the server under test: the shared dev server, or a production build (HL_PROD_PORT). */
export const SERVER_PORT = Number(process.env.HL_PROD_PORT ?? 3000);

export interface RawBufferResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
}

/** One request to 127.0.0.1:SERVER_PORT naming `host`, redirects not followed. */
export function rawBuffer(
  host: string,
  path: string,
  opts: {
    method?: string;
    cookie?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    port?: number;
  } = {},
): Promise<RawBufferResponse> {
  const headers: Record<string, string | number> = { Host: host, ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  const payload = typeof opts.body === "string" ? Buffer.from(opts.body) : opts.body;
  if (payload) headers["content-length"] = payload.length;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: opts.port ?? SERVER_PORT,
        path,
        method: opts.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            text: body.toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** GET a tenant page or its sub-resource on `${handle}.localhost:SERVER_PORT`. */
export const tenantGet = (handle: string, path = "/", headers: Record<string, string> = {}) =>
  rawBuffer(`${handle}.localhost:${SERVER_PORT}`, path, { headers });

export interface Part {
  name: string;
  value?: string;
  file?: { filename: string; contentType: string; data: Buffer };
}

/** A multipart/form-data body (Buffer) and its Content-Type header. */
export function multipart(parts: Part[]): { body: Buffer; contentType: string } {
  const boundary = `----hl${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.file) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.file.filename}"\r\n` +
            `Content-Type: ${part.file.contentType}\r\n\r\n`,
        ),
        part.file.data,
        Buffer.from("\r\n"),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ""}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------------------------------------
// Image fixtures
// ---------------------------------------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdr(width: number, height: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 2; // RGB
  return pngChunk("IHDR", data);
}

/** A real, decodable solid-colour PNG (keep width x height modest: raw RGB is built in memory). */
export function makePng(
  width: number,
  height: number,
  rgb: [number, number, number] = [196, 106, 79],
): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr(width, height),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A PNG with a valid signature and IHDR of any size and no pixel data (the route never decodes). */
export function makePngHeader(width: number, height: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height), pngChunk("IEND", Buffer.alloc(0))]);
}

/** A JPEG whose header (SOI, APP0, SOF0) names the size; there is no scan data. */
export function makeJpegHeader(width: number, height: number): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ]);
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** A lossless (VP8L) WebP whose header names the size; the bitstream is not decodable. */
export function makeWebpHeader(width: number, height: number): Buffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const vp8l = Buffer.alloc(5 + 4);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(bits >>> 0, 1);
  const chunk = Buffer.concat([Buffer.from("VP8L"), u32le(vp8l.length), vp8l]);
  return Buffer.concat([Buffer.from("RIFF"), u32le(4 + chunk.length), Buffer.from("WEBP"), chunk]);
}

function u32le(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

/** `data` followed by zero bytes up to exactly `size` bytes (the sniffers only read the start). */
export function padTo(data: Buffer, size: number): Buffer {
  return Buffer.concat([data, Buffer.alloc(Math.max(0, size - data.length))]);
}

export const SVG_AS_PNG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
);
export const HTML_AS_PNG = Buffer.from("<!doctype html><script>alert(1)</script>");
export const GIF = Buffer.concat([
  Buffer.from("GIF89a"),
  Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x2c]),
  Buffer.alloc(16),
]);

/** Reads width and height from a PNG's IHDR (for asserting a generated OG image). */
export function pngSizeOf(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(12) !== 0x49484452) throw new Error("not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
