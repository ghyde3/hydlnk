import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/lib/editor/sniff";

const bytes = (...values: number[]) => new Blob([new Uint8Array(values)]);

/** M2-09: the upload control checks the first bytes, never the name or the declared type. */
describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", async () => {
    expect(await sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpg");
    expect(
      await sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)),
    ).toBe("png");
    expect(
      await sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50),
      ),
    ).toBe("webp");
  });

  it("refuses text, GIF, SVG, HTML and an empty file, whatever they are called", async () => {
    for (const text of ["just some text", "GIF89a....", "<svg xmlns=", "<!doctype html>", ""]) {
      const file = new File([text], "photo.jpg", { type: "image/jpeg" });
      expect(await sniffImageType(file)).toBeNull();
    }
  });

  it("does not take RIFF alone for WebP (a WAV file starts the same way)", async () => {
    expect(
      await sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
  });
});
