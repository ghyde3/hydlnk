import { describe, expect, it, vi } from "vitest";
import { validateClientDocument } from "@/lib/oauth/client-document";
import {
  KNOWN_CLIENT_IDS,
  VENDOR_NAME_REFUSAL,
  isKnownClientId,
  namesVendorWithoutRight,
} from "@/lib/oauth/known-clients";
import { consentHeading, unverifiedConsentHeading } from "@/lib/oauth/messages";
import { validateRedirectUriList } from "@/lib/oauth/redirect-uri";
import { TEST_STUB_ORIGIN } from "@/lib/oauth/ssrf";

vi.mock("server-only", () => ({}));

/**
 * Wave L security review, findings 2, 3 and 4: the clients this server knows by name, the vendor
 * names a client may not use, return addresses on this product's own hosts, and how a registered app
 * is introduced on the consent screen.
 */

describe("the known clients", () => {
  it("are the three real client-metadata documents, by exact address", () => {
    expect([...KNOWN_CLIENT_IDS]).toEqual([
      "https://claude.ai/oauth/mcp-oauth-client-metadata",
      "https://claude.ai/oauth/claude-code-client-metadata",
      "https://chatgpt.com/oauth/client.json",
    ]);
    for (const id of KNOWN_CLIENT_IDS) expect(isKnownClientId(id)).toBe(true);
  });

  it.each([
    "https://claude.ai/oauth/mcp-oauth-client-metadata/",
    "https://claude.ai/oauth/mcp-oauth-client-metadata?x=1",
    "https://CLAUDE.AI/oauth/mcp-oauth-client-metadata",
    "http://claude.ai/oauth/mcp-oauth-client-metadata",
    "https://claude.ai.evil.example/oauth/mcp-oauth-client-metadata",
    "https://evil.example/oauth/client.json",
    "hlc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "",
  ])("%j is not one of them", (id) => {
    expect(isKnownClientId(id)).toBe(false);
  });

  it("the end-to-end stub counts only when asked to", () => {
    const stub = `${TEST_STUB_ORIGIN}/client.json`;
    expect(isKnownClientId(stub)).toBe(false);
    expect(isKnownClientId(stub, { allowTestStub: false })).toBe(false);
    expect(isKnownClientId(stub, { allowTestStub: true })).toBe(true);
    expect(isKnownClientId(`${TEST_STUB_ORIGIN}x/client.json`, { allowTestStub: true })).toBe(
      false,
    );
    expect(isKnownClientId(`${TEST_STUB_ORIGIN}/a b`, { allowTestStub: true })).toBe(false);
  });
});

describe("a vendor's name is for a client that returns to that vendor", () => {
  const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";
  const GPT_CB = "https://chatgpt.com/connector_platform_oauth_redirect";

  it.each([
    ["Claude", [CLAUDE_CB]],
    ["Claude", ["https://claude.com/api/mcp/auth_callback"]],
    ["Claude Code", ["http://localhost/callback", "http://127.0.0.1/callback"]],
    ["Claude Code (my server)", ["http://localhost:4000/cb"]],
    ["ChatGPT", [GPT_CB]],
    ["OpenAI Platform", ["https://platform.openai.com/apps-manage/oauth"]],
    ["Anthropic Console", ["https://claude.ai/cb", "http://127.0.0.1/cb"]],
    ["Pelican Notes", ["https://a.example/cb"]],
    ["", ["https://a.example/cb"]],
  ])("%j returning to %j is allowed", (name, uris) => {
    expect(namesVendorWithoutRight(name, uris)).toBe(false);
  });

  it.each([
    ["Claude", ["https://evil.example/cb"]],
    ["Claude", ["https://claude-ai.app/cb"]],
    ["Claude", ["https://claude.ai.evil.example/cb"]],
    ["Claude", ["https://evil.claude.ai/cb"]],
    ["Claude", ["https://claude.ai/cb", "https://evil.example/cb"]],
    ["Claude", []],
    ["Claude", ["not a uri"]],
    ["ChatGPT", [CLAUDE_CB]],
    ["Claude", [GPT_CB]],
    ["Claude for ChatGPT", [CLAUDE_CB]],
    ["C l a u d e", ["https://evil.example/cb"]],
    ["C-L-A-U-D-E", ["https://evil.example/cb"]],
    ["ＣＬＡＵＤＥ", ["https://evil.example/cb"]],
    ["Claude​Code", ["https://evil.example/cb"]],
    ["Anthropic", ["https://evil.example/cb"]],
    ["OpenAI", ["https://evil.example/cb"]],
    ["chatgpt-helper", ["https://evil.example/cb"]],
  ])("%j returning to %j is refused", (name, uris) => {
    expect(namesVendorWithoutRight(name, uris)).toBe(true);
  });

  it("the refusal says what to do in plain words", () => {
    expect(VENDOR_NAME_REFUSAL).toBe(
      "The name can’t include Claude, Anthropic, ChatGPT or OpenAI unless the app returns to that company’s own site.",
    );
  });
});

describe("a metadata document is held to the same rule", () => {
  const URL_ = "https://app.example.com/oauth/client.json";
  const doc = (over: Record<string, unknown> = {}) => ({
    client_id: URL_,
    client_name: "Example",
    redirect_uris: ["https://app.example.com/cb"],
    ...over,
  });

  it("refuses a vendor name on someone else's host, with a reason the log can carry", () => {
    expect(
      validateClientDocument(doc({ client_name: "Claude" }), URL_, "app.example.com"),
    ).toMatchObject({ ok: false, reason: "name_impersonates" });
    expect(
      validateClientDocument(doc({ client_name: "ChatGPT Plus" }), URL_, "app.example.com"),
    ).toMatchObject({ ok: false, reason: "name_impersonates" });
  });

  it("accepts the vendor's own name when the client returns home", () => {
    const claude = validateClientDocument(
      {
        client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      },
      "https://claude.ai/oauth/mcp-oauth-client-metadata",
      "claude.ai",
    );
    expect(claude.ok).toBe(true);
    expect(
      validateClientDocument(
        doc({ client_name: "Claude Code", redirect_uris: ["http://localhost/cb"] }),
        URL_,
        "app.example.com",
      ).ok,
    ).toBe(true);
  });

  it("refuses a return address on this product's own hosts", () => {
    for (const uri of ["https://mara.hydlnk.com/cb", "https://hydlnk.com/cb"]) {
      expect(
        validateClientDocument(doc({ redirect_uris: [uri] }), URL_, "app.example.com", {
          rootDomain: "hydlnk.com",
        }),
      ).toMatchObject({ ok: false, reason: "bad_redirect_uris" });
    }
    expect(
      validateClientDocument(
        doc({ redirect_uris: ["https://a.example.com/cb"] }),
        URL_,
        "app.example.com",
        {
          rootDomain: "hydlnk.com",
        },
      ).ok,
    ).toBe(true);
  });
});

describe("a return address on this product's own hosts is not a return address", () => {
  const list = (uris: string[], rootDomain?: string) =>
    validateRedirectUriList(uris, rootDomain ? { rootDomain } : undefined);

  it.each([
    "https://hydlnk.com/cb",
    "https://app.hydlnk.com/oauth/consent",
    "https://mara.hydlnk.com/cb",
    "https://deep.sub.hydlnk.com/cb",
    "https://HYDLNK.com/cb",
  ])("%s is refused", (uri) => {
    expect(list([uri], "hydlnk.com")).toEqual({ ok: false, reason: "invalid_redirect_uri" });
  });

  it("matches the fetch policy: the root domain's port is ignored, and a name merely ending in it is fine", () => {
    expect(list(["https://x.hydlnk.com/cb"], "hydlnk.com:443").ok).toBe(false);
    for (const uri of [
      "https://nothydlnk.com/cb",
      "https://hydlnk.com.evil.example/cb",
      "https://hydlnk.co/cb",
      "https://a.example/cb",
    ]) {
      expect(list([uri], "hydlnk.com").ok, uri).toBe(true);
    }
  });

  it("loopback is never an own host, and the dev root domain refuses its own names", () => {
    expect(list(["http://localhost:3000/cb", "http://127.0.0.1/cb"], "hydlnk.com").ok).toBe(true);
    expect(list(["http://localhost:3000/cb"], "localhost:3000").ok).toBe(true);
    expect(list(["https://app.localhost/cb"], "localhost:3000").ok).toBe(false);
  });

  it("without a root domain nothing changes", () => {
    expect(list(["https://hydlnk.com/cb"]).ok).toBe(true);
  });
});

describe("how an app introduces itself on the consent screen", () => {
  it("a registered app leads with that it is unverified and where you go back to", () => {
    expect(unverifiedConsentHeading("Claude", "claude-ai.app", false)).toBe(
      "“Claude” (unverified) at claude-ai.app wants to connect to your HYDLNK",
    );
    expect(unverifiedConsentHeading("My app", "this computer (localhost)", true)).toBe(
      "“My app” (unverified) on this computer wants to connect to your HYDLNK",
    );
  });

  it("a metadata app keeps the plain heading", () => {
    expect(consentHeading("Claude")).toBe("Claude wants to connect to your HYDLNK");
  });

  it("the name goes in as text: quotes and markup are not interpreted here", () => {
    expect(unverifiedConsentHeading('He said "hi" <b>', "a.example", false)).toBe(
      '“He said "hi" <b>” (unverified) at a.example wants to connect to your HYDLNK',
    );
  });
});
