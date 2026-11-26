// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BlockView, type BlockContext } from "@/components/page/blocks";
import { blockDefaults, type FormBlock } from "@/lib/document";
import type { FormRenderState } from "@/lib/forms/contract";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { contactFormBlock, noirTokens } from "./fixtures/page-document";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M17-04: the form block's one renderer. Both kinds as plain HTML posting to `/f/{pageId}/{blockId}`
 * with labelled fields, the honeypot off screen and out of the tab order, the button and the consent
 * line under it; author and visitor text escaped; the phone dock holds no control; the three result
 * views; tenant variables only.
 */

const PAGE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const signup = (over: Partial<FormBlock> = {}): FormBlock =>
  ({ ...(blockDefaults.form() as FormBlock), id: "form-sign-0001", ...over }) as FormBlock;
const draw = (block: FormBlock, extra: Partial<BlockContext> = {}) =>
  renderToStaticMarkup(
    <BlockView block={block} ctx={{ pageId: PAGE, tokens: noirTokens, mode: "live", ...extra }} />,
  );
const doc = (html: string) => {
  const host = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return host.body;
};

describe("M17-04 the form markup", () => {
  it("a sign-up: the form, its email field, the honeypot, the token field, the button and the consent", () => {
    const html = draw(signup({ heading: "News", description: "Now and then." }));
    expect(html).toBe(
      `<form class="pg-form" data-block-id="form-sign-0001" data-block-type="form" data-form-kind="signup" data-button-style="${noirTokens.buttonStyle}" action="/f/${PAGE}/form-sign-0001" method="post">` +
        '<h2 class="pg-form-heading">News</h2><p class="pg-form-desc">Now and then.</p>' +
        '<label class="pg-form-label" for="f-form-sign-0001-email">Email</label>' +
        '<input class="pg-form-input" id="f-form-sign-0001-email" type="email" autoComplete="email" maxLength="254" required="" name="email"/>' +
        '<div class="pg-form-hp" aria-hidden="true"><label for="f-form-sign-0001-hp">Leave this field empty</label>' +
        '<input id="f-form-sign-0001-hp" type="text" tabindex="-1" autoComplete="off" name="hl_confirm"/></div>' +
        '<input type="hidden" name="t" value=""/>' +
        '<button class="pg-form-submit" type="submit">Subscribe</button>' +
        '<p class="pg-form-consent">Your details go to the owner of this page, who may contact you.</p></form>',
    );
  });

  it("a sign-up that asks for a name has an optional name field before the email", () => {
    const body = doc(draw(signup({ askName: true })));
    const fields = [...body.querySelectorAll("input:not([type=hidden]), textarea")].map((el) =>
      el.getAttribute("name"),
    );
    expect(fields).toEqual(["name", "email", "hl_confirm"]);
    expect(body.querySelector('input[name="name"]')!.hasAttribute("required")).toBe(false);
  });

  it("a contact form: a required name, the email and a required message, each with its label", () => {
    const body = doc(draw(contactFormBlock));
    const form = body.querySelector("form")!;
    expect(form.getAttribute("data-form-kind")).toBe("contact");
    for (const name of ["name", "email", "message"]) {
      const control = form.querySelector(`[name="${name}"]`)!;
      expect(control.hasAttribute("required"), name).toBe(true);
      expect(form.querySelector(`label[for="${control.id}"]`), name).not.toBeNull();
    }
    expect(form.querySelector("textarea")!.getAttribute("maxlength")).toBe("2000");
    expect(form.querySelector('input[name="name"]')!.getAttribute("maxlength")).toBe("80");
    // The consent line sits directly under the button.
    expect(form.querySelector("button")!.nextElementSibling!.className).toBe("pg-form-consent");
  });

  it("escapes every author text: a heading of an image tag shows as text", () => {
    const html = draw(
      signup({
        heading: "<img src=x onerror=alert(1)>",
        buttonLabel: '"><script>x</script>',
        consent: "</form><form action=//evil>",
      }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(doc(html).querySelectorAll("form")).toHaveLength(1);
  });

  it("the same markup in the editor preview as on the live page", () => {
    expect(draw(contactFormBlock, { mode: "preview" })).toBe(draw(contactFormBlock));
  });

  it("in the phone dock it holds no form, input, button, textarea or label", () => {
    const body = doc(draw(contactFormBlock, { thumbnail: true }));
    expect(body.querySelector("form, input, button, textarea, label")).toBeNull();
    expect(body.querySelector(".pg-form-submit")!.textContent).toBe("Send");
  });

  it("block overrides sit on its own root, as --t-* variables only", () => {
    const html = draw(signup({ overrides: { buttonBg: "#C46A4F", radius: 4 } }));
    const root = doc(html).querySelector("form")!;
    expect(root.getAttribute("style")).toContain("--t-button-bg:#C46A4F");
    expect(html).not.toContain("--hl-");
    const css = pageRulesCss(["form"]);
    expect(css).toContain(".pg-form-input");
    expect(css).not.toContain("--hl-");
  });

  it("a hidden form draws nothing", () => {
    expect(draw(signup({ visible: false }))).toBe("");
  });
});

describe("M17-06 the result views", () => {
  const state = (over: Partial<FormRenderState>): FormRenderState => ({
    blockId: contactFormBlock.id,
    view: "confirm",
    values: { email: "bo@example.test", name: '<b>Bo</b>"', message: "Hi\n</textarea><script>" },
    token: "v1.1700000000000.abc",
    ...over,
  });

  it("confirm: the values typed (escaped), the token, no heading of the block", () => {
    const body = doc(draw({ ...contactFormBlock, heading: "Write" }, { form: state({}) }));
    const form = body.querySelector("form")!;
    expect(form.getAttribute("data-form-view")).toBe("confirm");
    expect(body.querySelector(".pg-form-heading")).toBeNull();
    expect((form.querySelector('input[name="name"]') as HTMLInputElement).value).toBe('<b>Bo</b>"');
    expect(form.querySelector("textarea")!.textContent).toBe("Hi\n</textarea><script>");
    expect((form.querySelector('input[name="t"]') as HTMLInputElement).value).toBe(
      "v1.1700000000000.abc",
    );
    expect(body.querySelector("script")).toBeNull();
  });

  it("error: one sentence per field, tied to its control", () => {
    const body = doc(
      draw(contactFormBlock, {
        form: state({ view: "error", errors: { email: "Enter an email address." } }),
      }),
    );
    const email = body.querySelector('input[name="email"]')!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    const said = body.querySelector(`#${email.getAttribute("aria-describedby")}`)!;
    expect(said.textContent).toBe("Enter an email address.");
    expect(body.querySelector(".pg-form-note")!.getAttribute("role")).toBe("alert");
  });

  it("sent: the success message as a status and a Back link, no fields", () => {
    const html = draw(contactFormBlock, { form: state({ view: "sent", backHref: "/about" }) });
    const body = doc(html);
    expect(body.querySelector('[role="status"]')!.textContent).toBe(
      contactFormBlock.successMessage,
    );
    expect(body.querySelector("a")!.getAttribute("href")).toBe("/about");
    expect(body.querySelector("form, input")).toBeNull();
  });

  it("sent: an unsafe Back address falls back to Home", () => {
    const html = draw(contactFormBlock, {
      form: state({ view: "sent", backHref: "//evil.example" }),
    });
    expect(doc(html).querySelector("a")!.getAttribute("href")).toBe("/");
  });

  it("a state for another block changes nothing", () => {
    expect(draw(signup(), { form: state({ blockId: "someone-else1" }) })).toBe(draw(signup()));
  });
});
