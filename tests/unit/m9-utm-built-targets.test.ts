import { describe, expect, it, vi } from "vitest";
import type { PublishDoc } from "@/lib/document";
import { fullPublished } from "./fixtures/page-document";

/**
 * M9-27: a destination HYDLNK builds (the map's two buttons, M9-22) is never tagged, whatever the
 * page sets. `findLinkUrl` is stubbed to resolve the map's ids, as the M9-15 plumbing does, so this
 * holds however that function grows; every id the owner typed is still tagged.
 */

vi.mock("@/lib/analytics/ingest/target", async (original) => {
  const actual = await original<typeof import("@/lib/analytics/ingest/target")>();
  return {
    ...actual,
    findLinkUrl: (doc: PublishDoc, id: string) => {
      const map = doc.blocks.find((block) => block.type === "map");
      if (map?.type === "map" && id === map.googleId)
        return "https://www.google.com/maps/search/?api=1&query=Studio";
      if (map?.type === "map" && id === map.appleId) return "https://maps.apple.com/?q=Studio";
      return actual.findLinkUrl(doc, id);
    },
  };
});

const { resolveLink } = await import("@/lib/analytics/ingest/link-target");

describe("M9-27 built targets get no tags", () => {
  const doc = {
    ...fullPublished,
    utm: { source: "hydlnk", medium: "link-in-bio", campaign: "spring" },
  } as PublishDoc;
  const map = doc.blocks.find((block) => block.type === "map");

  it("the map's Google Maps and Apple Maps links are exactly the built URLs", () => {
    expect(map?.type).toBe("map");
    if (map?.type !== "map") return;
    expect(resolveLink(doc, map.googleId)?.url).toBe(
      "https://www.google.com/maps/search/?api=1&query=Studio",
    );
    expect(resolveLink(doc, map.appleId)?.url).toBe("https://maps.apple.com/?q=Studio");
  });

  it("a link the owner typed in the same document is tagged", () => {
    const link = doc.blocks.find((block) => block.type === "link");
    if (link?.type !== "link") throw new Error("fixture has no link");
    expect(resolveLink(doc, link.id)?.url).toContain("utm_source=hydlnk");
  });
});
