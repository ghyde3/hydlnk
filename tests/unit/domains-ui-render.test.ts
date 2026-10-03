import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/domains/actions", () => ({
  addDomainAction: vi.fn(),
  checkDomainAction: vi.fn(),
  setDomainPageAction: vi.fn(),
  removeDomainAction: vi.fn(),
}));

const { CustomDomainCard } = await import("@/components/domains/custom-domain-card");
const { StudioUpsell } = await import("@/components/domains/studio-upsell");
const { HydlnkAddressCard } = await import("@/components/domains/hydlnk-address-card");
const { RecordsBlock } = await import("@/components/domains/records-block");
const { StepList } = await import("@/components/domains/step-list");
const { StatusChip } = await import("@/components/domains/status-chip");
const { stepsFor } = await import("@/components/domains/view-model");

/**
 * The server-rendered shape of the Domains screen's pieces (M4-10, M4-12, M4-13, M4-14, M5-18),
 * rendered for real without a browser: which plan sees which control, and that the markup carries
 * what the acceptance steps look for (a locked Free card has no input, an ordered list with
 * labelled circles, an apex note built from the server's values). Layout is the Playwright specs.
 */

const pages = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    name: "Main page",
    address: "mara.hydlnk.com",
    published: true,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    name: "Page 2",
    address: "studio.hydlnk.com",
    published: false,
  },
];
const card = (plan: "free" | "pro" | "studio", used: number) =>
  renderToStaticMarkup(
    createElement(CustomDomainCard, { plan, used, pages, currentPageId: pages[0]!.id }),
  );

describe("M4-10 Custom domain card by plan", () => {
  it("Free: the locked state, a See plans link, and no input or select in the DOM", () => {
    const out = card("free", 0);
    expect(out).toContain("Custom domains start on Pro.");
    expect(out).toContain('href="/settings#plans"');
    expect(out).toContain("See plans");
    expect(out).not.toMatch(/<input|<select|<form/);
    expect(out).not.toContain("data-domain-usage");
  });

  it("Pro with a free slot: usage line and the add form with the account's pages", () => {
    const out = card("pro", 0);
    expect(out).toContain("0 of 1 used on Pro");
    expect(out).toContain("<form");
    expect(out).toContain('placeholder="links.yourname.com"');
    expect(out).toContain("Add domain");
    expect(out).toContain("mara.hydlnk.com");
    expect(out).toContain("studio.hydlnk.com");
    expect(out).toMatch(/<label[^>]*>Domain<\/label>/);
    expect(out).toMatch(/<label[^>]*>Serves<\/label>/);
    expect(out).not.toContain("Custom domains start on Pro.");
  });

  it("M4-12 at the limit the form is gone and the usage line stays", () => {
    const pro = card("pro", 1);
    expect(pro).toContain("1 of 1 used on Pro");
    expect(pro).not.toMatch(/<input|<select|<form|Add domain/);
    const studio = card("studio", 15);
    expect(studio).toContain("15 of 15 used on Studio");
    expect(studio).not.toMatch(/<input|<form/);
    expect(card("studio", 14)).toContain("<form");
  });
});

describe("M4-10 pieces", () => {
  it("the Studio strip links to /settings#plans", () => {
    const out = renderToStaticMarkup(createElement(StudioUpsell));
    expect(out).toContain("Running pages for clients? Studio includes 15 custom domains.");
    expect(out).toContain('href="/settings#plans"');
    expect(out).toContain("Compare plans");
    expect(out).toContain("border-dashed");
  });

  it("the address card shows Live for a published page and Not published yet otherwise", () => {
    const live = renderToStaticMarkup(
      createElement(HydlnkAddressCard, { handle: "mara", published: true }),
    );
    expect(live).toContain("mara.hydlnk.com");
    expect(live).toContain("Included on every plan. Keeps working alongside a custom domain.");
    expect(live).toContain(">Live<");
    expect(live).toContain(">SSL<");
    expect(live).not.toContain("Not published yet");
    const draft = renderToStaticMarkup(
      createElement(HydlnkAddressCard, { handle: "mara", published: false }),
    );
    expect(draft).toContain("Not published yet");
    expect(draft).not.toContain(">Live<");
  });
});

describe("M4-14 step list and chip markup", () => {
  it("a real ordered list with a labelled circle per step", () => {
    const steps = stepsFor({ status: "pending", hostname: "links.example.test", stale: false });
    const out = renderToStaticMarkup(createElement(StepList, { steps }));
    expect(out).toMatch(/^<ol/);
    expect(out.match(/<li/g)).toHaveLength(3);
    expect(out).toContain('aria-label="Step 2 of 3, current"');
    expect(out).toContain('data-step-state="todo"');
  });

  it("the chip is a polite live region", () => {
    const out = renderToStaticMarkup(createElement(StatusChip, { status: "pending" }));
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Waiting for DNS");
  });
});

describe("M4-13 records block", () => {
  const props = { retrying: false, onRetry: () => undefined, unavailable: false, apex: null };

  it("renders each record twice (table and stacked list), each with its own Copy button", () => {
    const records = [
      { type: "CNAME", name: "links", value: "abc123.example-dns.test" },
      { type: "TXT", name: "_vercel", value: "vc-domain-verify=links.example.test,abc" },
    ];
    const out = renderToStaticMarkup(createElement(RecordsBlock, { ...props, records }));
    expect(out).toContain('role="table"');
    expect(out.match(/aria-label="Copy record value"/g)).toHaveLength(4);
    expect(out).toContain("abc123.example-dns.test");
    expect(out).toContain("vc-domain-verify=links.example.test,abc");
    expect(out).toContain("<dl");
    expect(out).not.toContain("data-apex-note");
  });

  it("builds the apex note from the server's apex name and address", () => {
    const out = renderToStaticMarkup(
      createElement(RecordsBlock, {
        ...props,
        records: [{ type: "CNAME", name: "links", value: "abc123.example-dns.test" }],
        apex: { name: "example.test", ipv4: "198.51.100.7" },
      }),
    );
    const text = out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(text).toContain(
      "Using a root domain like example.test instead? Add an A record for @ pointing to 198.51.100.7.",
    );
  });

  it("when the records could not be loaded: the sentence and Try again, and no record values", () => {
    const out = renderToStaticMarkup(
      createElement(RecordsBlock, { ...props, records: [], unavailable: true }),
    );
    expect(out).toContain("We couldn’t load your DNS records.");
    expect(out).toContain("Try again");
    expect(out).not.toContain("Copy record value");
    expect(out).not.toContain('role="table"');
  });
});
