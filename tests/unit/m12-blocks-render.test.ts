import { createElement } from "react";
import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { BlockView } from "@/components/page/blocks";
import { blocks, noirTokens } from "./fixtures/page-document";

/**
 * M12-01 and M12-02: the markup of the items and hours blocks, through the one `BlockView` the
 * editor preview and the live page share. Text is escaped, an item's link goes through `/r`, a
 * sold item says Sold with its price struck through, and the hours table is neutral static markup
 * (no day marked: the tenant script does that in the visitor's browser).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `/media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const PAGE_ID = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const draw = (block: unknown, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(BlockView, {
      block: block as never,
      ctx: { pageId: PAGE_ID, tokens: noirTokens as never, mode: "live", ...extra },
    }),
  );

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: "Print",
  price: "$40",
  description: "",
  sold: false,
  ...over,
});
const list = (items: unknown[], over: Record<string, unknown> = {}) => ({
  id: "items-render-01",
  type: "items",
  visible: true,
  layout: "list",
  items,
  ...over,
});

describe("M12-01 items markup", () => {
  it("draws the heading, the layout and each item with its name, price and description", () => {
    const html = draw(
      list([item("item-aaaa-0001", { description: "A3, signed" })], {
        heading: "Prints",
        layout: "grid",
      }),
    );
    expect(html).toContain('data-block-type="items"');
    expect(html).toContain('data-layout="grid"');
    expect(html).toContain('<h2 class="pg-items-heading">Prints</h2>');
    expect(html).toContain('data-item-id="item-aaaa-0001"');
    expect(html).toContain('<span class="pg-item-name">Print</span>');
    expect(html).toContain('<span class="pg-item-price">$40</span>');
    expect(html).toContain('<span class="pg-item-desc">A3, signed</span>');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("pg-item-sold");
  });

  it("an unknown layout draws as a list", () => {
    expect(draw(list([item("item-aaaa-0001")], { layout: "weird" }))).toContain(
      'data-layout="list"',
    );
  });

  it("a sold item strikes its price through and says Sold", () => {
    const html = draw(list([item("item-aaaa-0001", { sold: true })]));
    expect(html).toContain('data-sold="true"');
    expect(html).toContain('<span class="pg-item-price"><s>$40</s></span>');
    expect(html).toContain('<span class="pg-item-sold">Sold</span>');
  });

  it("an item with an address is one link through /r, with the same rel and no destination", () => {
    const html = draw(
      list([item("item-aaaa-0001", { url: "https://shop.example/secret-path?x=1" })]),
    );
    expect(html).toContain(`href="/r/${PAGE_ID}/item-aaaa-0001"`);
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).not.toContain("shop.example");
  });

  it("an unsafe or empty address is not a link", () => {
    expect(draw(list([item("item-aaaa-0001", { url: "javascript:alert(1)" })]))).not.toContain(
      "href=",
    );
    expect(draw(list([item("item-aaaa-0001", { url: "" })]))).not.toContain("<a ");
  });

  it("in a thumbnail a linked item is a plain box", () => {
    const html = draw(list([item("item-aaaa-0001", { url: "https://shop.example/x" })]), {
      thumbnail: true,
    });
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("escapes every tenant string", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const html = draw(
      list(
        [
          item("item-aaaa-0001", {
            name: evil,
            price: evil,
            description: evil,
            url: "https://ok.example/",
          }),
        ],
        { heading: evil },
      ),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("the photo comes from the page's own /media address, with an empty alt", () => {
    const html = draw(
      list([
        item("item-aaaa-0001", {
          image: {
            path: "0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e/item-abc123.webp",
            width: 800,
            height: 600,
          },
        }),
      ]),
    );
    expect(html).toContain('class="pg-item-img"');
    expect(html).toContain('src="/media/0b8f2f7a-1e01-4c0b-9d57-6f1c2a523a1e/item-abc123.webp"');
    expect(html).toContain('alt=""');
    expect(html).toContain('width="800"');
    expect(html).toContain('loading="lazy"');
  });

  it("applies the block's own overrides as inline variables on its root", () => {
    const html = draw(list([item("item-aaaa-0001")], { overrides: { accent: "#ff0000" } }));
    expect(html).toMatch(/<section class="pg-items"[^>]*style="[^"]*--t-accent:#ff0000/);
  });
});

describe("M12-02 hours markup", () => {
  it("draws an accessible table: seven rows, the day as a row header, ranges or Closed", () => {
    const html = draw(blocks.hours);
    expect(html).toContain('data-block-type="hours"');
    expect(html).toContain('data-tz="America/New_York"');
    expect(html).toContain("<caption");
    expect(html.match(/<tr /g)).toHaveLength(7);
    expect(html).toContain('<th scope="row" class="pg-hours-day">Monday</th>');
    expect(html).toContain('<td class="pg-hours-times">09:00–17:00</td>');
    expect(html).toContain('<td class="pg-hours-times">Closed</td>');
    expect(html).toContain('data-day="mon" data-ranges="09:00-17:00"');
    expect(html).toContain('data-day="sat" data-ranges=""');
    expect(html).toContain("Closed on public holidays.");
  });

  it("is neutral: no day is marked and the status line is empty, so a cached page is right for everyone", () => {
    const html = draw(blocks.hours);
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain("data-open");
    expect(html).toContain('<p class="pg-hours-status" role="status" data-hours-status=""></p>');
  });

  it("two ranges and a range past midnight keep their text and data", () => {
    const html = draw({
      ...blocks.hours,
      days: {
        ...blocks.hours.days,
        fri: {
          closed: false,
          ranges: [
            { open: "11:00", close: "14:00" },
            { open: "18:00", close: "02:00" },
          ],
        },
      },
    });
    expect(html).toContain("11:00–14:00, 18:00–02:00");
    expect(html).toContain('data-ranges="11:00-14:00,18:00-02:00"');
  });

  it("escapes the note, and a value that is not a time never reaches the script's data", () => {
    const html = draw({
      ...blocks.hours,
      note: "<b>open</b>",
      days: {
        ...blocks.hours.days,
        mon: { closed: false, ranges: [{ open: "<x>", close: "17:00" }] },
      },
    });
    expect(html).toContain("&lt;b&gt;open&lt;/b&gt;");
    expect(html).toContain('data-day="mon" data-ranges=""');
  });

  it("a time zone outside the list draws as UTC", () => {
    expect(draw({ ...blocks.hours, timezone: '"><script>' })).toContain('data-tz="UTC"');
  });
});

describe("M12-01, M12-02 stylesheet", () => {
  it("a page with an items block carries the items rules and not the hours rules, and the reverse", () => {
    const items = pageRulesCss(["items"]);
    const hours = pageRulesCss(["hours"]);
    expect(items).toContain(".pg-item-body");
    expect(items).toContain(".pg-item-sold");
    expect(items).not.toContain(".pg-hours-table");
    expect(hours).toContain(".pg-hours-table");
    expect(hours).toContain("aria-current");
    expect(hours).not.toContain(".pg-item-body");
  });
});
