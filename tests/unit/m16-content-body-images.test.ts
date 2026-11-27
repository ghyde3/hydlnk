// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The project URL as the upload check reads it, and as `storageUrl` reads it: one value, twice.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

import { BODY_IMAGES_MAX, bodyImageIssue, bodyImages, uploadPathOf } from "@/lib/content/images";
import { mediaPathOf } from "@/lib/themes/bg-image";
import { storageUrl } from "@/lib/media/url";

/**
 * M16-04 and M16-17: images in a post body. Tenant content is untrusted, so Publish takes an image
 * only when its address is, character for character, the stored form of an upload
 * (`storageUrl(path)`). Everything else is refused with one message; whose upload it is and whether
 * the file exists is `checkOwnImages`' part (m16-content-body-images-publish.test.ts).
 */
const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PATH = `${UID}/img-0123456789ab.webp`;
const OWN = storageUrl(PATH);
const BASE = "https://proj.supabase.test/storage/v1/object/public/page-media";
const MESSAGE = "Use an image from your uploads.";

describe("bodyImages: every image of a Markdown body that is an upload's stored address", () => {
  it("finds an image and names the body as its field", () => {
    expect(bodyImages(`Intro\n\n![A photo](${OWN})\n`)).toEqual([{ path: PATH, field: "body" }]);
  });

  it("finds images wherever Markdown allows one", () => {
    const second = `${UID}/img-aaaaaaaaaaaa.webp`;
    const third = `${UID}/img-bbbbbbbbbbbb.webp`;
    const fourth = `${UID}/img-cccccccccccc.webp`;
    const fifth = `${UID}/img-dddddddddddd.webp`;
    const body = [
      `[![linked](${OWN})](https://example.com/)`,
      `> ![quoted](${storageUrl(second)} "a title")`,
      `- item ![in a list](${storageUrl(third)})`,
      `| a |\n|---|\n| ![in a table](${storageUrl(fourth)}) |`,
      `![by reference][ref]\n\n[ref]: ${storageUrl(fifth)}`,
    ].join("\n\n");
    expect(bodyImages(body).map((use) => use.path)).toEqual([PATH, second, third, fourth, fifth]);
    expect(bodyImageIssue({ body })).toBeNull();
  });

  it("lists an image used twice once", () => {
    expect(bodyImages(`![a](${OWN})\n\n![b](${OWN})`)).toHaveLength(1);
  });

  it("keeps another user's upload in the list, so the ownership check sees it", () => {
    const theirs = `${OTHER}/img-0123456789ab.webp`;
    expect(bodyImages(`![x](${storageUrl(theirs)})`)).toEqual([{ path: theirs, field: "body" }]);
  });

  it("a body with no image, an empty body and a draft with no body have nothing to check", () => {
    expect(bodyImages("Just *text* and a [link](https://example.com/).")).toEqual([]);
    expect(bodyImages("")).toEqual([]);
    expect(bodyImageIssue({ body: "" })).toBeNull();
    expect(bodyImageIssue({})).toBeNull();
    expect(bodyImageIssue(null)).toBeNull();
    expect(bodyImageIssue({ body: 7 })).toBeNull();
  });
});

describe("uploadPathOf: the stored form of an upload and nothing else", () => {
  it("takes exactly what storageUrl builds, and agrees with the media parser on it", () => {
    expect(uploadPathOf(OWN)).toBe(PATH);
    expect(mediaPathOf(OWN, "https://proj.supabase.test")).toBe(PATH);
    for (const ext of ["jpg", "png", "webp"]) {
      const path = `${UID}/img-0123456789ab.${ext}`;
      expect(uploadPathOf(storageUrl(path))).toBe(path);
    }
  });

  it("is stricter than the media parser: what a URL parser would normalize into an upload is refused", () => {
    const normalized = `${BASE}/../page-media/${PATH}`;
    expect(mediaPathOf(normalized, "https://proj.supabase.test")).toBe(PATH);
    expect(uploadPathOf(normalized)).toBeNull();
  });

  it("with no project URL set, nothing is an upload", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(uploadPathOf(OWN)).toBeNull();
    expect(bodyImageIssue({ body: `![x](${OWN})` })).toMatchObject({ ok: false, error: "invalid" });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  });

  it("a trailing slash on the project URL changes nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test/");
    expect(uploadPathOf(OWN)).toBe(PATH);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
  });
});

describe("bodyImageIssue: hostile and foreign image addresses are refused at publish", () => {
  const hostile: Array<[string, string]> = [
    ["another host", "https://evil.example/storage/v1/object/public/page-media/" + PATH],
    ["a tracking pixel", "https://tracker.example/pixel.gif?u=1"],
    ["http instead of https", OWN.replace("https://", "http://")],
    ["a protocol-relative address", OWN.replace("https:", "")],
    ["a relative address", `/storage/v1/object/public/page-media/${PATH}`],
    ["the browser-facing /media form", `https://hydlnk.test/media/${PATH}`],
    [
      "userinfo in front of the host",
      OWN.replace("https://", "https://proj.supabase.test@evil.example/"),
    ],
    ["userinfo on the right host", OWN.replace("https://", "https://user:pw@")],
    ["a look-alike host", OWN.replace("proj.supabase.test", "proj.supabase.test.evil.example")],
    ["a port", OWN.replace("proj.supabase.test", "proj.supabase.test:8443")],
    [
      "an upper-case scheme and host",
      OWN.replace("https://proj.supabase.test", "HTTPS://PROJ.SUPABASE.TEST"),
    ],
    ["a query string", `${OWN}?download=1`],
    ["a fragment", `${OWN}#x`],
    ["another bucket", OWN.replace("/page-media/", "/private-media/")],
    ["the signed-object route", OWN.replace("/object/public/", "/object/sign/")],
    ["dot segments that land on the right path", `${BASE}/../page-media/${PATH}`],
    ["dot segments that leave the bucket", `${BASE}/${UID}/../../other-bucket/x.webp`],
    ["an encoded slash", `${BASE}/${UID}%2Fimg-0123456789ab.webp`],
    ["an encoded dot segment", `${BASE}/%2e%2e/page-media/${PATH}`],
    ["a backslash", `${BASE}/${UID}\\img-0123456789ab.webp`],
    ["a percent-encoded letter in the file name", OWN.replace("img-0", "%69mg-0")],
    ["a percent-encoded letter in the fixed part", OWN.replace("/object/", "/%6fbject/")],
    ["a file that is not an image", `${BASE}/${UID}/img-0123456789ab.svg`],
    ["a nested folder", `${BASE}/${UID}/deep/img-0123456789ab.webp`],
    ["a folder that is not a uid", `${BASE}/shared/img-0123456789ab.webp`],
    ["a data: address", "data:image/png;base64,iVBORw0KGgo="],
    ["a javascript: address", "javascript:alert(1)"],
    ["a blob: address", "blob:https://proj.supabase.test/0000"],
    ["a file: address", "file:///etc/passwd"],
    ["leading whitespace kept by angle brackets", `< ${OWN}>`.replace("< ", "<%20")],
    ["a trailing encoded space", `${OWN}%20`],
    ["a character reference in the host", OWN.replace("proj.", "proj&#46;")],
    ["a tab inside the address", `<${OWN.replace("/storage", "/\tstorage")}>`],
  ];

  for (const [name, address] of hostile) {
    it(`refuses ${name}`, () => {
      const body = `Text\n\n![x](${address})\n`;
      // The case is real only if Markdown reads it as an image at all.
      const out = bodyImageIssue({ body });
      expect(out, address).toMatchObject({ ok: false, error: "invalid", status: 422 });
      expect(out?.issues?.[0]).toEqual({ path: "body", message: MESSAGE });
      expect(bodyImages(body), address).toEqual([]);
    });
  }

  it("refuses a foreign image hidden in a table, a link, a quote, a list and a reference", () => {
    const evil = "https://evil.example/x.png";
    const bodies = [
      `| a |\n|---|\n| ![t](${evil}) |`,
      `[![l](${evil})](${OWN})`,
      `> ![q](${evil})`,
      `1. ![li](${evil})`,
      `![r][ref]\n\n[ref]: ${evil}`,
      `![own](${OWN}) and ![theirs](${evil})`,
    ];
    for (const body of bodies) {
      expect(bodyImageIssue({ body }), body).toMatchObject({ ok: false, error: "invalid" });
    }
  });

  it("reports one issue however many foreign images there are", () => {
    const body = Array.from({ length: 40 }, (_, i) => `![x](https://evil.example/${i}.png)`).join(
      "\n\n",
    );
    expect(bodyImageIssue({ body })?.issues).toEqual([{ path: "body", message: MESSAGE }]);
  });

  it("refuses more images than a post may hold, so a publish cannot ask Storage about thousands", () => {
    const own = (i: number) => storageUrl(`${UID}/img-${i.toString(16).padStart(12, "0")}.webp`);
    const at = Array.from({ length: BODY_IMAGES_MAX }, (_, i) => `![x](${own(i)})`).join("\n\n");
    expect(bodyImageIssue({ body: at })).toBeNull();
    expect(bodyImages(at)).toHaveLength(BODY_IMAGES_MAX);
    const over = `${at}\n\n![x](${own(BODY_IMAGES_MAX)})`;
    const out = bodyImageIssue({ body: over });
    expect(out).toMatchObject({ ok: false, error: "invalid" });
    expect(out?.issues?.[0]?.path).toBe("body");
    expect(out?.issues?.[0]?.message).toContain(String(BODY_IMAGES_MAX));
  });

  it("raw HTML is not an image: the renderer shows it as text, so it is neither listed nor trusted", () => {
    const body = `<img src="${OWN}">\n\n<img src="https://evil.example/x.png">`;
    expect(bodyImages(body)).toEqual([]);
  });
});

describe("the link blocklist and uploads in a body", () => {
  const spy = () => {
    const seen: string[] = [];
    const admin = {
      rpc: async (_name: string, args: { p_draft: { blocks: Array<{ url: string }> } }) => {
        seen.push(...args.p_draft.blocks.map((block) => block.url));
        return { data: [], error: null };
      },
    };
    return { seen, admin: admin as never };
  };

  it("an upload's stored address is not sent to the blocklist; every other address still is", async () => {
    const { blockedBodyLinks } = await import("@/lib/content/blocklist");
    const { seen, admin } = spy();
    const lookalike = OWN.replace("proj.supabase.test", "proj.supabase.test.evil.example");
    const body = `![own](${OWN})\n\n![x](${lookalike})\n\n![q](${OWN}?x=1)\n\n[link](https://example.com/a)`;
    expect(await blockedBodyLinks(admin, { body })).toBeNull();
    expect(seen).toEqual([lookalike, `${OWN}?x=1`, "https://example.com/a"]);
  });
});
