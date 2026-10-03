// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundSection } from "@/components/design/sections/background-section";
import { resolveTokens, tokenSetSchema, type TokenSet } from "@/lib/theme";
import { OWNER_UID, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * M3-14, M3-15, M3-16: the Background group (Solid, Gradient, Image...), the image upload through
 * POST /api/media with kind=background, its two client-side refusals, Remove image, and the Overlay
 * and Blur sliders that exist only while an image is the background.
 */

const BASE = "http://127.0.0.1:54321/storage/v1/object/public/page-media";
const FILE = "0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e.jpg";
const OWN = `${BASE}/${OWNER_UID}/${FILE}`;
const MIB = 1024 * 1024;

/** An XMLHttpRequest the test drives by hand. */
class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: { onprogress: ((event: unknown) => void) | null } = { onprogress: null };
  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  progress(loaded: number, total: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total }));
  }
  /** The server answered. Async: the component's code after the request runs in later microtasks. */
  async respond(status: number, json: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(json);
    await act(async () => this.onload?.());
  }
  async fail() {
    await act(async () => this.onerror?.());
  }
}

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  // The token schema accepts a background image only on this project's own Storage origin.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Call = [keyof TokenSet, unknown];

function mount(theme: Partial<TokenSet> = {}) {
  const calls: Call[] = [];
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<TokenSet>>({});
    const resolved = resolveTokens({ ...noirTokens, ...theme }, overrides);
    return createElement(BackgroundSection, {
      resolved,
      overrides,
      pageId: "00000000-0000-4000-8000-0000000000b1",
      ownerId: OWNER_UID,
      setToken: (key, value) => {
        calls.push([key, value]);
        setOverrides((current) => {
          const next: Partial<TokenSet> = { ...current };
          if (value === undefined) delete next[key];
          else (next as Record<string, unknown>)[key] = value;
          return next;
        });
      },
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { host, calls };
}

const buttons = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
const button = (host: HTMLElement, name: string) =>
  buttons(host).find((b) => b.textContent?.trim() === name);
const pressed = (host: HTMLElement) =>
  buttons(host)
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);
const slider = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLInputElement>(`input[type=range][id]`)
    ? Array.from(host.querySelectorAll<HTMLInputElement>("input[type=range]")).find(
        (input) => host.querySelector(`label[for="${input.id}"]`)?.textContent === name,
      )
    : undefined;

function jpeg(size = 1200): File {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([bytes], "bg.jpg", { type: "image/jpeg" });
}

/** Picks a file the way the browser does: set `files`, fire change, let the sniff promise settle. */
async function choose(host: HTMLElement, file: File) {
  const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const stored = {
  path: `${OWNER_UID}/${FILE}`,
  width: 1600,
  height: 900,
  url: OWN,
};

describe("M3-14 the Background group", () => {
  it("offers Solid, Gradient and an Image… button, and presses the resolved type", () => {
    const { host } = mount({ bgType: "solid" });
    const group = host.querySelector('[role="group"][aria-label="Background"]')!;
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Solid",
      "Gradient",
      "Image…",
    ]);
    expect(pressed(host)).toEqual(["Solid"]);
  });

  it("shows the Smoke theme's gradient as pressed, and Solid writes bgType solid", () => {
    const { host, calls } = mount({ bgType: "gradient" });
    expect(pressed(host)).toEqual(["Gradient"]);
    act(() => button(host, "Solid")!.click());
    expect(calls).toEqual([["bgType", "solid"]]);
    expect(pressed(host)).toEqual(["Solid"]);
    act(() => button(host, "Gradient")!.click());
    expect(calls.at(-1)).toEqual(["bgType", "gradient"]);
  });

  it("every control is at least 44px tall on a phone", () => {
    const { host } = mount({ bgType: "image", bgImage: OWN });
    for (const b of buttons(host)) expect(b.className, b.textContent ?? "").toContain("min-h-11");
    for (const input of host.querySelectorAll("input[type=range]")) {
      expect(input.className).toContain("h-11");
    }
  });
});

describe("M3-15 image upload", () => {
  it("Image… opens the file picker", () => {
    const { host } = mount();
    const input = host.querySelector<HTMLInputElement>("input[type=file]")!;
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    const click = vi.spyOn(input, "click");
    act(() => button(host, "Image…")!.click());
    expect(click).toHaveBeenCalledOnce();
  });

  it("posts the file to /api/media with kind=background, shows progress, then applies the image", async () => {
    const { host, calls } = mount();
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const [request] = FakeXhr.instances;
    expect(request!.method).toBe("POST");
    expect(request!.url).toBe("/api/media");
    expect(request!.body!.get("kind")).toBe("background");
    expect((request!.body!.get("file") as File).name).toBe("bg.jpg");

    // Busy: a progress bar and a disabled button; nothing is stored in the draft yet.
    expect(button(host, "Image…")!.disabled).toBe(true);
    request!.progress(300, 1200);
    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("25");
    expect(host.textContent).toContain("Uploading… 25%");
    expect(calls).toEqual([]);

    await request!.respond(200, stored);
    expect(calls).toEqual([
      ["bgImage", OWN],
      ["bgType", "image"],
    ]);
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(button(host, "Image…")!.disabled).toBe(false);
    // The draft value is a token the schema accepts.
    expect(tokenSetSchema.shape.bgImage.safeParse(OWN).success).toBe(true);
    // The thumbnail is the stored object.
    const thumb = host.querySelector('[role="img"][aria-label="Current background image"] img');
    expect(thumb?.getAttribute("src")).toBe(OWN);
    expect(pressed(host)).toEqual([]);
    expect(button(host, "Image…")!.getAttribute("data-active")).toBe("true");
  });

  it("stores the URL built from the response path, not whatever url the response carries", async () => {
    const { host, calls } = mount();
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await FakeXhr.instances[0]!.respond(200, { ...stored, url: "https://evil.example/x.jpg" });
    expect(calls[0]).toEqual(["bgImage", OWN]);
  });

  it.each([
    ["a .txt file", new File(["hello"], "notes.txt", { type: "text/plain" })],
    [
      "an SVG",
      new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], "bg.svg", { type: "image/svg+xml" }),
    ],
    ["a GIF", new File([new TextEncoder().encode("GIF89a....")], "bg.gif", { type: "image/gif" })],
    // The declared type and name are not trusted: a text file called .jpg is still refused.
    ["text named .jpg", new File(["hello"], "bg.jpg", { type: "image/jpeg" })],
  ])("%s shows the not-an-image message and sends nothing", async (_name, file) => {
    const { host, calls } = mount();
    await choose(host, file);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "That file type isn’t supported. Use JPEG, PNG or WebP.",
    );
    expect(FakeXhr.instances).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("a JPEG over 4 MB shows the too-big message and sends nothing", async () => {
    const { host, calls } = mount();
    await choose(host, jpeg(5 * MIB));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "That file is too big. Use an image under 4 MB.",
    );
    expect(FakeXhr.instances).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  it("a JPEG of exactly 4 MB is sent", async () => {
    const { host } = mount();
    await choose(host, jpeg(4 * MIB));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
  });

  it.each([
    [413, "That file is too big. Use an image under 4 MB."],
    [415, "That file type isn’t supported. Use JPEG, PNG or WebP."],
    [422, "We couldn’t read that image. Try a different file."],
    [401, "You’re signed out. Sign in again to upload."],
    [500, "Couldn’t upload that image. Try again."],
  ])("a %i answer shows its message and leaves the draft alone", async (status, message) => {
    const { host, calls } = mount();
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await FakeXhr.instances[0]!.respond(status, { error: "x" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(calls).toEqual([]);
    expect(button(host, "Image…")!.disabled).toBe(false);
  });

  it("an answer that is not an image reference is a failure, not an image", async () => {
    const { host, calls } = mount();
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await FakeXhr.instances[0]!.respond(200, { path: "../../etc/passwd", width: 1, height: 1 });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn’t upload that image. Try again.",
    );
    expect(calls).toEqual([]);
  });

  it("a network failure shows the failed message", async () => {
    const { host, calls } = mount();
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await FakeXhr.instances[0]!.fail();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn’t upload that image. Try again.",
    );
    expect(calls).toEqual([]);
  });

  it("choosing a new image replaces the draft's image and keeps the type image", async () => {
    const { host, calls } = mount({ bgType: "image", bgImage: OWN });
    const second = `${OWNER_UID}/1c9d3b64-5f02-4d11-8e68-7a2d3e634b2f.png`;
    await choose(host, jpeg());
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    await FakeXhr.instances[0]!.respond(200, { path: second, width: 800, height: 600 });
    expect(calls).toEqual([
      ["bgImage", `${BASE}/${second}`],
      ["bgType", "image"],
    ]);
  });
});

describe("M3-15 an image only counts when it is one of the owner's page-media URLs", () => {
  it("Remove image reverts to Solid and clears bgImage", () => {
    const { host, calls } = mount({ bgType: "image", bgImage: OWN });
    expect(button(host, "Remove image")).toBeDefined();
    act(() => button(host, "Remove image")!.click());
    expect(calls).toEqual([
      ["bgType", "solid"],
      ["bgImage", null],
    ]);
    expect(button(host, "Remove image")).toBeUndefined();
    expect(pressed(host)).toEqual(["Solid"]);
    expect(host.querySelector("input[type=range]")).toBeNull();
  });

  it("a third-party URL in the token shows no image, no Remove button and no sliders", () => {
    const { host } = mount({ bgType: "image", bgImage: "https://images.example.com/bg.webp" });
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(button(host, "Remove image")).toBeUndefined();
    expect(host.querySelector("input[type=range]")).toBeNull();
    expect(pressed(host)).toEqual(["Solid"]);
  });

  it("a stored image under solid or gradient is not offered or drawn", () => {
    for (const bgType of ["solid", "gradient"] as const) {
      const { host } = mount({ bgType, bgImage: OWN });
      expect(host.querySelector('[role="img"]')).toBeNull();
      expect(button(host, "Remove image")).toBeUndefined();
    }
  });
});

describe("M3-16 overlay and blur", () => {
  it("are not shown for a solid or gradient background", () => {
    for (const bgType of ["solid", "gradient"] as const) {
      const { host } = mount({ bgType });
      expect(host.querySelector("input[type=range]")).toBeNull();
      expect(host.textContent).not.toContain("Overlay");
      expect(host.textContent).not.toContain("Blur");
    }
  });

  it("with an image: Overlay 0-100% and Blur 0-max px sliders with visible values", () => {
    const { host } = mount({ bgType: "image", bgImage: OWN, overlayOpacity: 0.6, blur: 12 });
    const overlay = slider(host, "Overlay")!;
    const blur = slider(host, "Blur")!;
    expect([overlay.min, overlay.max, overlay.value, overlay.step]).toEqual([
      "0",
      "100",
      "60",
      "1",
    ]);
    expect([blur.min, blur.value, blur.step]).toEqual(["0", "12", "1"]);
    // The slider follows the token's own range, so a value it offers always validates.
    expect(Number(blur.max)).toBe(tokenSetSchema.shape.blur.maxValue);
    expect(overlay.getAttribute("aria-valuetext")).toBe("60%");
    expect(blur.getAttribute("aria-valuetext")).toBe("12px");
    expect(host.textContent).toContain("60%");
    expect(host.textContent).toContain("12px");
  });

  it("moving a slider writes overlayOpacity as a 0-1 fraction and blur in px", () => {
    const { host, calls } = mount({ bgType: "image", bgImage: OWN });
    const set = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    set(slider(host, "Overlay")!, "60");
    set(slider(host, "Blur")!, "12");
    expect(calls).toEqual([
      ["overlayOpacity", 0.6],
      ["blur", 12],
    ]);
    expect(slider(host, "Overlay")!.value).toBe("60");
    expect(host.textContent).toContain("60%");
    expect(host.textContent).toContain("12px");
  });

  it("every value the sliders can reach is a valid token value", () => {
    for (const percent of [0, 1, 7, 29, 33, 58, 60, 99, 100]) {
      expect(
        tokenSetSchema.shape.overlayOpacity.safeParse(percent / 100).success,
        `${percent}%`,
      ).toBe(true);
    }
    const max = tokenSetSchema.shape.blur.maxValue!;
    expect(tokenSetSchema.shape.blur.safeParse(max).success).toBe(true);
  });
});
