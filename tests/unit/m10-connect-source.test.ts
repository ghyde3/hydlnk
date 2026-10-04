import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESS_LIFETIME_WORDS,
  ANALYTICS_HISTORY,
  CONNECTION_IDLE_DAYS,
  CONNECTOR_ADDRESS,
  historyWords,
} from "@/components/marketing/connect-facts";
import { FAQ_GROUPS, HOME_FAQ } from "@/components/marketing/faq-data";
import { FOOTER_COLUMNS, MAIN_NAV, SITEMAP_PATHS } from "@/components/marketing/site-map";
import { PLAN_LIMITS } from "@/lib/limits";
import {
  MCP_ACTIVITY_RETENTION_DAYS,
  MCP_PUBLISH_PER_HOUR,
  MCP_USER_PER_MINUTE,
} from "@/lib/mcp/constants";
import { ACCESS_TOKEN_SECONDS, REFRESH_IDLE_SECONDS } from "@/lib/oauth/constants";
import { PRODUCT_DOMAIN } from "@/lib/pages/plans";

/**
 * M10-34 and M10-35: the source of the /connect page, the privacy section, the FAQ group, the
 * Features section and the navigation, read as files so the page cannot drift from the constants
 * it states and from the documentation it was written against. What a visitor sees is proved in
 * tests/e2e/m10/connect.spec.ts and connect-links.spec.ts.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const CONNECT_PAGE = "src/app/(marketing)/connect/page.tsx";
const PRIVACY_PAGE = "src/app/(marketing)/privacy/page.tsx";
const FEATURES_PAGE = "src/app/(marketing)/features/page.tsx";

describe("M10-34 the connector address", () => {
  it("is the production one, built from PRODUCT_DOMAIN and never from the local root domain", () => {
    expect(PRODUCT_DOMAIN).toBe("hydlnk.com");
    expect(CONNECTOR_ADDRESS).toBe("https://app.hydlnk.com/mcp");
    const facts = read("src/components/marketing/connect-facts.ts");
    expect(facts).toContain("`https://app.${PRODUCT_DOMAIN}/mcp`");
    expect(facts).not.toMatch(/NEXT_PUBLIC_ROOT_DOMAIN|clientEnv|appOrigin|rootOrigin/);
  });

  it("is the one string the page and the Copy button use: the page imports it, never retypes it", () => {
    const page = read(CONNECT_PAGE);
    expect(page).toContain("CONNECTOR_ADDRESS");
    expect(page).toMatch(/from "@\/components\/marketing\/connect-facts"/);
    // The address appears in the page's comments (it documents the steps), never as a string in the markup.
    const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("app.hydlnk.com");
    expect(code).not.toContain("hydlnk.com/mcp");
    const button = read("src/components/marketing/connect-address.tsx");
    expect(button).toContain("navigator.clipboard.writeText(address)");
    expect(button).toContain('"use client"');
  });
});

describe("M10-34 the documentation the steps were written against", () => {
  const page = read(CONNECT_PAGE);
  const comment = page.match(/\/\*[\s\S]*?\*\//)?.[0] ?? "";

  it("names each documentation URL and the date they were read, in a source comment", () => {
    expect(comment).toContain("2026-10-04");
    expect(comment).toContain("https://claude.com/docs/connectors/custom/add-unlisted");
    expect(comment).toContain("https://developers.openai.com/apps-sdk/deploy/connect-chatgpt");
    expect(comment).toContain("https://code.claude.com/docs/en/mcp-quickstart");
  });

  it("imports the numbers it states: rate limits and retention from the connector's constants, analytics windows from the plan table", () => {
    for (const name of [
      "MCP_USER_PER_MINUTE",
      "MCP_PUBLISH_PER_HOUR",
      "MCP_ACTIVITY_RETENTION_DAYS",
    ]) {
      expect(page, name).toMatch(
        new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/mcp/constants"`),
      );
      expect(page, name).toContain(`{${name}}`);
    }
    expect(page).toMatch(/import \{[^}]*\bANALYTICS_HISTORY\b[^}]*\} from/);
    expect(page).toContain("{ANALYTICS_HISTORY.free}");
    expect(page).toContain("{ANALYTICS_HISTORY.paid}");
  });

  it("keeps the facts module free of the MCP and OAuth packages and of server-only code", () => {
    for (const file of [
      "src/components/marketing/connect-facts.ts",
      "src/components/marketing/connect-address.tsx",
      CONNECT_PAGE,
      PRIVACY_PAGE,
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/mcp-handler|@modelcontextprotocol|server-only/);
    }
  });
});

describe("M10-34 the numbers the page states", () => {
  it("the analytics windows come from the plan table: Free 30 days, Pro and Studio up to a year", () => {
    expect(PLAN_LIMITS.pro.analyticsHistoryDays).toBe(PLAN_LIMITS.studio.analyticsHistoryDays);
    expect(ANALYTICS_HISTORY.free).toBe("30 days");
    expect(ANALYTICS_HISTORY.paid).toBe("a year");
    expect(historyWords(30)).toBe("30 days");
    expect(historyWords(365)).toBe("a year");
    expect(historyWords(90)).toBe("90 days");
  });

  it("the rate limits, the retention and the lifetimes read as the specs pin them", () => {
    expect(MCP_USER_PER_MINUTE).toBe(60);
    expect(MCP_PUBLISH_PER_HOUR).toBe(10);
    expect(MCP_ACTIVITY_RETENTION_DAYS).toBe(90);
    expect(ACCESS_TOKEN_SECONDS).toBe(3600);
    expect(ACCESS_LIFETIME_WORDS).toBe("an hour");
    expect(REFRESH_IDLE_SECONDS).toBe(60 * 24 * 60 * 60);
    expect(CONNECTION_IDLE_DAYS).toBe(60);
  });
});

/**
 * The rate limits and the retention come from src/lib/mcp/constants.ts and the two lifetimes the
 * privacy policy states from src/lib/oauth/constants.ts: files that import nothing but each other,
 * so a marketing page may read them without reaching the MCP packages (M10-01). The marketing facts hold
 * no second copy of any of the five numbers, so the page and the policy cannot drift from the server.
 */
describe("M10-34 the facts are the connector's own constants, not copies", () => {
  it("both owning files import only each other, so a marketing page may read them without reaching the MCP packages", () => {
    const allowed = new Set(["@/lib/oauth/constants", "@/lib/mcp/constants"]);
    for (const file of ["src/lib/mcp/constants.ts", "src/lib/oauth/constants.ts"]) {
      const source = read(file);
      const imported = [
        ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\sfrom\s+["']([^"']+)["']/gm),
      ].map((match) => match[1]!);
      expect(
        imported.filter((specifier) => !allowed.has(specifier)),
        `${file} imports something other than the two constants modules`,
      ).toEqual([]);
      expect(source, file).not.toMatch(/mcp-handler|@modelcontextprotocol|server-only/);
    }
  });

  it("the facts module and the pages import them and define none of the five themselves", () => {
    const facts = read("src/components/marketing/connect-facts.ts");
    expect(facts).toMatch(
      /import \{ ACCESS_TOKEN_SECONDS, REFRESH_IDLE_SECONDS \} from "@\/lib\/oauth\/constants"/,
    );
    for (const file of ["src/components/marketing/connect-facts.ts", CONNECT_PAGE, PRIVACY_PAGE]) {
      expect(read(file), file).not.toMatch(
        /export const (MCP_USER_PER_MINUTE|MCP_PUBLISH_PER_HOUR|MCP_ACTIVITY_RETENTION_DAYS|ACCESS_TOKEN_SECONDS|REFRESH_IDLE_SECONDS)\b/,
      );
    }
  });
});

describe("M10-35 navigation", () => {
  it("puts /connect in the sitemap once and in the footer's Product column as 'Use with Claude or ChatGPT'", () => {
    expect(SITEMAP_PATHS.filter((path) => path === "/connect")).toHaveLength(1);
    const product = FOOTER_COLUMNS.find((column) => column.title === "Product");
    expect(product?.links).toContainEqual({
      href: "/connect",
      label: "Use with Claude or ChatGPT",
    });
    // Only the Product column carries it.
    const hits = FOOTER_COLUMNS.filter((column) =>
      column.links.some((link) => link.href === "/connect"),
    );
    expect(hits.map((column) => column.title)).toEqual(["Product"]);
  });

  it("leaves the header's six links as they were", () => {
    expect(MAIN_NAV.map((item) => item.href)).toEqual([
      "/features",
      "/design-control",
      "/custom-domains",
      "/link-analytics",
      "/pricing",
      "/learn",
    ]);
    expect(MAIN_NAV.map((item) => item.href)).not.toContain("/connect");
  });
});

describe("M10-35 the FAQ group", () => {
  const group = FAQ_GROUPS.find((item) => item.id === "ai-apps");

  it("is 'Claude and ChatGPT' with the five questions, none of them on the home page", () => {
    expect(group?.title).toBe("Claude and ChatGPT");
    expect(group?.items.map((item) => item.question)).toEqual([
      "Can I use HYDLNK from Claude or ChatGPT?",
      "Is it on every plan?",
      "Can the AI publish my page without asking?",
      "What can the AI see?",
      "How do I turn it off?",
    ]);
    for (const item of group!.items) {
      expect(item.home, item.question).toBeUndefined();
      expect(item.answer.length).toBeGreaterThan(40);
    }
    expect(HOME_FAQ.map((item) => item.question)).toEqual(
      expect.not.arrayContaining(group!.items.map((item) => item.question)),
    );
    expect(HOME_FAQ).toHaveLength(6);
  });

  it("answers the way /connect does: every plan, publishing only if allowed, Revoke in Connected apps", () => {
    const answer = (question: string) =>
      group!.items.find((item) => item.question === question)!.answer;
    expect(answer("Is it on every plan?")).toMatch(/Free, Pro and Studio/);
    expect(answer("Can the AI publish my page without asking?")).toMatch(/Only if you allow it/);
    expect(answer("Can the AI publish my page without asking?")).toMatch(/may ask you first/);
    expect(answer("What can the AI see?")).toMatch(/drafts/);
    expect(answer("What can the AI see?")).toMatch(/numbers/);
    expect(answer("What can the AI see?")).toMatch(/custom domains/);
    expect(answer("How do I turn it off?")).toMatch(
      /Settings & billing, find Connected apps and choose Revoke/,
    );
  });
});

describe("M10-35 the privacy policy", () => {
  const privacy = read(PRIVACY_PAGE);

  it("has the section after 'How we use information', with its contents entry in the same place", () => {
    const toc = [...privacy.matchAll(/^\s*\["([a-z-]+)", "([^"]+)"\],$/gm)].map((m) => m[1]);
    expect(toc.indexOf("use")).toBeGreaterThan(-1);
    expect(toc[toc.indexOf("use") + 1]).toBe("connected-apps");
    expect(toc[toc.indexOf("connected-apps") + 1]).toBe("legal-bases");
    expect(privacy).toContain('["connected-apps", "Connected AI apps"]');
    const order = ['<h2 id="use">', '<h2 id="connected-apps">', '<h2 id="legal-bases">'].map(
      (tag) => privacy.indexOf(tag),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("reads the activity retention from the one constant, in the section and in the retention list", () => {
    expect(privacy).toMatch(/import \{[^}]*MCP_ACTIVITY_RETENTION_DAYS[^}]*\} from/);
    expect(privacy.match(/\{MCP_ACTIVITY_RETENTION_DAYS\}/g)).toHaveLength(2);
    // And no typed 90 next to the word days.
    expect(privacy).not.toMatch(/\b90 days\b/);
  });

  it("states the lifetimes from constants, and adds the three lines to the short version, retention and sharing", () => {
    expect(privacy).toContain("{ACCESS_LIFETIME_WORDS}");
    expect(privacy).toContain("{CONNECTION_IDLE_DAYS}");
    expect(privacy).toContain(
      "If you connect an AI app, it can only do what you allow, and you can remove it at any time.",
    );
    expect(privacy).toMatch(/<strong>Connected app activity<\/strong>/);
    expect(privacy).toContain("only what you ask it to read, through the permissions you allowed.");
  });

  it("does not touch the shared 'Last updated' date (Gary decides; PROGRESS.md lists it)", () => {
    expect(privacy).not.toMatch(/updated=/);
    // Read as source: the legal-page module pulls in the page chrome, which needs the client env.
    expect(read("src/components/marketing/legal-page.tsx")).toContain(
      'export const LEGAL_UPDATED = { iso: "2026-10-02", label: "October 2, 2026" }',
    );
  });
});

describe("M10-35 the Features section", () => {
  const features = read(FEATURES_PAGE);

  it("sits between Publishing and Safe by default, with its own id and the link to /connect", () => {
    const publishing = features.indexOf('<Section id="publishing"');
    const ai = features.indexOf('<Section id="ai-apps"');
    const safety = features.indexOf('<Section id="safety"');
    expect(publishing).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(publishing);
    expect(safety).toBeGreaterThan(ai);
    expect(features).toContain('titleId="ai-apps-title"');
    expect(features).toContain('title="Use it from Claude or ChatGPT"');
    expect(features).toMatch(
      /<ArrowLink href="\/connect"[^>]*>\s*See how to connect\s*<\/ArrowLink>/,
    );
    // The bands keep alternating: Publishing white, the new one page, Safety white again.
    expect(features).toMatch(/<Section id="ai-apps" tone="page"/);
    expect(features).toMatch(/<Section id="safety" labelledBy/);
  });
});
