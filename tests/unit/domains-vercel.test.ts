import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildRecords, relativeName } from "@/lib/domains/records";
import {
  VercelApiError,
  classifyFailure,
  createVercelClient,
  type VercelClientConfig,
} from "@/lib/domains/vercel-client";

/**
 * M4-11 / M4-13 / M4-15: the Vercel client and the DNS records built from its answers. The client
 * runs against a fake fetch that records each request, so the exact endpoints, the team id, the
 * bearer token, the timeout and the error mapping are asserted without a network.
 */

const CONFIG: VercelClientConfig = {
  token: "tok_unit_test_value",
  projectId: "prj_unit",
  teamId: "team_unit",
  baseUrl: "https://api.vercel.example/",
};

interface Seen {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
  redirect: RequestRedirect | undefined;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry: Seen = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      signal: init?.signal ?? undefined,
      redirect: init?.redirect,
    };
    seen.push(entry);
    return respond(entry);
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("M4-11 the requests the client makes", () => {
  it("add: POST /v10/projects/{project}/domains with the name, the team and the bearer token", async () => {
    const { impl, seen } = fakeFetch(() =>
      json(200, {
        name: "links.example.test",
        apexName: "example.test",
        projectId: "prj_unit",
        verified: false,
        verification: [{ type: "TXT", domain: "_vercel.example.test", value: "vc-domain-verify=x", reason: "pending" }],
      }),
    );
    const client = createVercelClient(CONFIG, impl);
    const added = await client.addProjectDomain("links.example.test");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url.origin + seen[0]!.url.pathname).toBe(
      "https://api.vercel.example/v10/projects/prj_unit/domains",
    );
    expect(seen[0]!.url.searchParams.get("teamId")).toBe("team_unit");
    expect(seen[0]!.headers.Authorization).toBe("Bearer tok_unit_test_value");
    expect(seen[0]!.body).toEqual({ name: "links.example.test" });
    expect(seen[0]!.redirect).toBe("error");
    expect(added).toMatchObject({ apexName: "example.test", verified: false });
    expect(added.verification).toEqual([
      { type: "TXT", domain: "_vercel.example.test", value: "vc-domain-verify=x", reason: "pending" },
    ]);
  });

  it("get, verify, config and remove use their endpoints, URL-encode the hostname and never fetch it", async () => {
    const { impl, seen } = fakeFetch((s) => {
      if (s.url.pathname.endsWith("/config"))
        return json(200, { misconfigured: false, configuredBy: "CNAME", recommendedCNAME: [], recommendedIPv4: [] });
      return json(200, { name: "x", apexName: "example.test", projectId: "p", verified: true });
    });
    const client = createVercelClient(CONFIG, impl);
    await client.getProjectDomain("links.example.test");
    await client.verifyProjectDomain("links.example.test");
    await client.getDomainConfig("links.example.test");
    await client.removeProjectDomain("links.example.test");
    expect(seen.map((s) => `${s.method} ${s.url.pathname}`)).toEqual([
      "GET /v9/projects/prj_unit/domains/links.example.test",
      "POST /v9/projects/prj_unit/domains/links.example.test/verify",
      "GET /v6/domains/links.example.test/config",
      "DELETE /v9/projects/prj_unit/domains/links.example.test",
    ]);
    expect(seen[2]!.url.searchParams.get("projectIdOrName")).toBe("prj_unit");
    for (const s of seen) {
      expect(s.url.host).toBe("api.vercel.example");
      expect(s.url.searchParams.get("teamId")).toBe("team_unit");
      expect(s.headers.Authorization).toBe("Bearer tok_unit_test_value");
    }
  });

  it("a hostname is only ever a path segment: nothing in it can change the request's host or path", async () => {
    const { impl, seen } = fakeFetch(() => json(200, {}));
    const client = createVercelClient(CONFIG, impl);
    for (const evil of ["evil.com/..%2f", "a.example.test@evil.com", "a.example.test#@evil.com", "a/b", "a?x=1"]) {
      await client.getProjectDomain(evil).catch(() => undefined);
    }
    for (const s of seen) {
      expect(s.url.host).toBe("api.vercel.example");
      expect(s.url.pathname.startsWith("/v9/projects/prj_unit/domains/")).toBe(true);
      expect(s.url.pathname.slice("/v9/projects/prj_unit/domains/".length)).not.toContain("/");
    }
  });

  it("no teamId when no team owns the project", async () => {
    const { impl, seen } = fakeFetch(() => json(200, {}));
    await createVercelClient({ ...CONFIG, teamId: undefined }, impl).removeProjectDomain("a.example.test");
    expect(seen[0]!.url.searchParams.has("teamId")).toBe(false);
  });

  it("every request has a timeout signal (the add gives up after eight seconds by default)", async () => {
    const { impl, seen } = fakeFetch(() => json(200, {}));
    await createVercelClient(CONFIG, impl).removeProjectDomain("a.example.test");
    expect(seen[0]!.signal).toBeDefined();

    const slow = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
      );
      return json(200, {});
    }) as unknown as typeof fetch;
    const client = createVercelClient({ ...CONFIG, timeoutMs: 30 }, slow);
    await expect(client.addProjectDomain("a.example.test")).rejects.toMatchObject({
      name: "VercelApiError",
      kind: "unavailable",
    });
  });
});

describe("M4-11 errors map to kinds", () => {
  const add = async (status: number, code: string | null) => {
    const { impl } = fakeFetch(() => json(status, code ? { error: { code, message: "m" } } : {}));
    return createVercelClient(CONFIG, impl)
      .addProjectDomain("a.example.test")
      .then(() => null, (error: VercelApiError) => error);
  };

  it.each([
    [409, "domain_already_in_use", "conflict"],
    [409, "domain_taken", "conflict"],
    [400, "existing_project_domain", "conflict"],
    [403, "forbidden", "conflict"],
    [402, "payment_required", "capacity"],
    [400, "too_many_domains", "capacity"],
    [403, "domain_limit_exceeded", "capacity"],
    [400, "invalid_domain", "invalid"],
    [401, "forbidden", "unauthorized"],
    [404, "not_found", "not_found"],
    [500, null, "unavailable"],
    [502, "bad_gateway", "unavailable"],
    [429, "rate_limited", "unavailable"],
    [400, "bad_request", "unavailable"],
  ])("HTTP %i %s is %s", async (status, code, kind) => {
    const error = await add(status, code);
    expect(error).toBeInstanceOf(VercelApiError);
    expect(error!.kind).toBe(kind);
    expect(classifyFailure(status, code)).toBe(status >= 500 ? "unavailable" : kind);
  });

  it("an error never carries the token, the hostname or the URL", async () => {
    const error = await add(500, null);
    expect(error!.message).not.toMatch(/tok_unit|example\.test|api\.vercel/);
  });

  it("a network error is unavailable", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(createVercelClient(CONFIG, impl).getDomainConfig("a.example.test")).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("verify: a 400 is an answer (not verified yet), a 5xx is a failure, a 404 is not_found", async () => {
    const verify = (status: number) =>
      createVercelClient(CONFIG, fakeFetch(() => json(status, { error: { code: "x" } })).impl).verifyProjectDomain("a.example.test");
    await expect(verify(400)).resolves.toEqual({ verified: false });
    await expect(verify(500)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(verify(404)).rejects.toMatchObject({ kind: "not_found" });
    const ok = fakeFetch(() => json(200, { verified: true }));
    await expect(createVercelClient(CONFIG, ok.impl).verifyProjectDomain("a.example.test")).resolves.toEqual({ verified: true });
  });

  it("remove: 200 and 404 are removed, anything else throws", async () => {
    const remove = (status: number) =>
      createVercelClient(CONFIG, fakeFetch(() => json(status, {})).impl).removeProjectDomain("a.example.test");
    await expect(remove(200)).resolves.toBeUndefined();
    await expect(remove(404)).resolves.toBeUndefined();
    await expect(remove(500)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(remove(403)).rejects.toMatchObject({ kind: "conflict" });
  });

  it("config: a missing misconfigured flag reads as misconfigured (never verified by default)", async () => {
    const { impl } = fakeFetch(() => json(200, { recommendedCNAME: [], recommendedIPv4: [] }));
    await expect(createVercelClient(CONFIG, impl).getDomainConfig("a.example.test")).resolves.toMatchObject({
      misconfigured: true,
    });
  });
});

describe("M4-13 the records are the ones Vercel returned", () => {
  const config = {
    recommendedCNAME: [
      { rank: 2, value: "second.vercel-dns-017.com." },
      { rank: 1, value: "abc123.vercel-dns-017.com." },
    ],
    recommendedIPv4: [
      { rank: 2, value: ["203.0.113.99"] },
      { rank: 1, value: ["203.0.113.10", "203.0.113.11"] },
    ],
  };

  it("a subdomain: CNAME, the name relative to the apex, rank 1, trailing dot dropped", () => {
    const built = buildRecords("links.example.test", { apexName: "example.test", verification: [] }, config);
    expect(built.records).toEqual([{ type: "CNAME", name: "links", value: "abc123.vercel-dns-017.com" }]);
    expect(built.apex).toEqual({ name: "example.test", ipv4: "203.0.113.10" });
    expect(built.unavailable).toBe(false);
  });

  it("a deeper subdomain keeps its dots in the name", () => {
    const built = buildRecords("a.b.example.test", { apexName: "example.test", verification: [] }, config);
    expect(built.records[0]).toMatchObject({ type: "CNAME", name: "a.b" });
  });

  it("the apex: an A record at @ with the first IPv4 by rank and no root-domain note", () => {
    const built = buildRecords("example.test", { apexName: "example.test", verification: [] }, config);
    expect(built.records).toEqual([{ type: "A", name: "@", value: "203.0.113.10" }]);
    expect(built.apex).toBeNull();
  });

  it("an ownership challenge adds a TXT row, relative to the apex, exactly as returned", () => {
    const built = buildRecords(
      "links.example.test",
      {
        apexName: "example.test",
        verification: [
          { type: "TXT", domain: "_vercel.example.test", value: "vc-domain-verify=links.example.test,abc", reason: "" },
        ],
      },
      config,
    );
    expect(built.records).toEqual([
      { type: "CNAME", name: "links", value: "abc123.vercel-dns-017.com" },
      { type: "TXT", name: "_vercel", value: "vc-domain-verify=links.example.test,abc" },
    ]);
  });

  it("an empty verification list shows only the CNAME or A row", () => {
    expect(buildRecords("links.example.test", { apexName: "example.test", verification: [] }, config).records).toHaveLength(1);
  });

  it("non-TXT challenges are not shown as TXT rows", () => {
    const built = buildRecords(
      "links.example.test",
      { apexName: "example.test", verification: [{ type: "A", domain: "x", value: "y", reason: "" }] },
      config,
    );
    expect(built.records.map((r) => r.type)).toEqual(["CNAME"]);
  });

  it("values change when Vercel's change: nothing is remembered", () => {
    const changed = { ...config, recommendedCNAME: [{ rank: 1, value: "zzz999.vercel-dns-099.com." }] };
    expect(
      buildRecords("links.example.test", { apexName: "example.test", verification: [] }, changed).records[0]!.value,
    ).toBe("zzz999.vercel-dns-099.com");
  });

  it("no fallback: a missing CNAME, IPv4 or apex name makes the records unavailable", () => {
    const none = { recommendedCNAME: [], recommendedIPv4: [] };
    expect(buildRecords("links.example.test", { apexName: "example.test", verification: [] }, none)).toEqual({
      records: [],
      apex: null,
      unavailable: true,
    });
    expect(buildRecords("example.test", { apexName: "example.test", verification: [] }, none).unavailable).toBe(true);
    expect(buildRecords("links.example.test", { apexName: "", verification: [] }, config).unavailable).toBe(true);
  });

  it("a subdomain whose config has no IPv4 still shows its CNAME, without the root-domain note", () => {
    const built = buildRecords(
      "links.example.test",
      { apexName: "example.test", verification: [] },
      { recommendedCNAME: config.recommendedCNAME, recommendedIPv4: [] },
    );
    expect(built.unavailable).toBe(false);
    expect(built.apex).toBeNull();
  });

  it("relativeName", () => {
    expect(relativeName("links.example.test", "example.test")).toBe("links");
    expect(relativeName("example.test", "example.test")).toBe("@");
    expect(relativeName("_vercel.example.test", "example.test")).toBe("_vercel");
    expect(relativeName("other.org", "example.test")).toBe("other.org");
  });
});

describe("M4-13 CI check: no Vercel address is hard-coded", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(path);
    }
    return out;
  }
  const root = join(process.cwd(), "src");
  const files = walk(root);
  const isTestSupport = (path: string) => /(^|\/)(__tests__|testing)\//.test(relative(root, path));

  it("no non-test file under src/ contains 76.76.21.21 or cname.vercel-dns.com", () => {
    const hits: string[] = [];
    for (const file of files.filter((f) => !isTestSupport(f))) {
      const text = readFileSync(file, "utf8");
      for (const needle of ["76.76.21.21", "cname.vercel-dns.com"]) {
        if (text.includes(needle)) hits.push(`${relative(root, file)} contains ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the domains code contains no IPv4 literal (only comments naming documentation addresses are allowed)", () => {
    const hits: string[] = [];
    for (const file of files.filter((f) => relative(root, f).startsWith("lib/domains/"))) {
      const code = readFileSync(file, "utf8")
        .split("\n")
        // drop comment-only lines: the examples in doc comments use 203.0.113.x (RFC 5737)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      for (const match of code.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
        hits.push(`${relative(root, file)}: ${match[0]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the Domains screen and its components do not either", () => {
    const hits: string[] = [];
    const screens = files.filter(
      (f) =>
        /app\/\(editor\)\/app\/\(screens\)\/domains\//.test(f) ||
        /components\/(app\/)?domains\//.test(f),
    );
    for (const file of screens) {
      const text = readFileSync(file, "utf8");
      for (const needle of ["76.76.21.21", "cname.vercel-dns.com"]) {
        if (text.includes(needle)) hits.push(`${relative(root, file)} contains ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
