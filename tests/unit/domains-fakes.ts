import type { DomainDeps } from "@/lib/domains/deps";
import {
  VercelApiError,
  type DomainConfig,
  type ProjectDomain,
  type VercelClient,
} from "@/lib/domains/vercel-client";

/**
 * Fakes for the domain logic tests (tests/unit/domains-*.test.ts): an in-memory stand-in for the
 * secret-key Supabase client (just the query shapes core.ts, verify.ts and view.ts use, with the
 * unique hostname and the plan limit enforced like the database does, and the three atomic
 * functions) and a Vercel client that records every call. Every call yields one microtask turn, so
 * simultaneous requests interleave the way concurrent requests do.
 */

type Row = Record<string, unknown>;

export const PLAN_DOMAIN_LIMIT: Record<string, number> = { free: 0, pro: 1, studio: 15 };

export interface FakeState {
  accounts: Row[];
  pages: Row[];
  domains: Row[];
  users: Map<string, string>;
  /** The fake database clock, in milliseconds. */
  clock: number;
  /** Make the next insert into `domains` fail with this error. */
  failNextInsert: { code: string; message: string } | null;
  /** Calls to rpc(), in order. */
  rpcLog: { name: string; args: Record<string, unknown> }[];
}

const get = (row: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => (value as Row | null | undefined)?.[key], row);

class Query {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row = {};
  private cols = "*";
  private options: { count?: string; head?: boolean } | undefined;
  private filters: ((row: Row) => boolean)[] = [];
  private orderSpec: { col: string; ascending: boolean; nullsFirst: boolean } | null = null;
  private max: number | null = null;
  private one: "single" | "maybe" | null = null;

  constructor(
    private readonly state: FakeState,
    private readonly table: "accounts" | "pages" | "domains",
  ) {}

  select(cols = "*", options?: { count?: string; head?: boolean }) {
    this.cols = cols;
    this.options = options;
    return this;
  }
  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((row) => get(row, col) === value);
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push((row) => String(get(row, col) ?? "") >= String(value));
    return this;
  }
  order(col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderSpec = { col, ascending: o?.ascending ?? true, nullsFirst: o?.nullsFirst ?? false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.one = "single";
    return this;
  }
  maybeSingle() {
    this.one = "maybe";
    return this;
  }
  then<T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) {
    return this.exec().then(resolve, reject);
  }

  private join(row: Row): Row | null {
    if (this.table !== "domains" || !this.cols.includes("pages!inner")) return row;
    const page = this.state.pages.find((p) => p.id === row.page_id);
    return page ? { ...row, pages: { owner_id: page.owner_id, published_at: page.published_at ?? null } } : null;
  }

  private async exec(): Promise<{ data: unknown; error: unknown; count?: number | null }> {
    await Promise.resolve();
    const rows = this.state[this.table];

    if (this.op === "insert") {
      if (this.table !== "domains") throw new Error("the fake only inserts domains");
      const row: Row = {
        id: crypto.randomUUID(),
        status: "pending",
        verified_at: null,
        last_checked_at: null,
        live_email_sent_at: null,
        created_at: new Date(this.state.clock).toISOString(),
        ...this.payload,
      };
      if (this.state.failNextInsert) {
        const error = this.state.failNextInsert;
        this.state.failNextInsert = null;
        return { data: null, error };
      }
      const page = this.state.pages.find((p) => p.id === row.page_id);
      if (!page) return { data: null, error: { code: "23503", message: "no such page" } };
      if (this.state.domains.some((d) => d.hostname === row.hostname)) {
        return { data: null, error: { code: "23505", message: "duplicate hostname" } };
      }
      const account = this.state.accounts.find((a) => a.id === page.owner_id);
      const limit = PLAN_DOMAIN_LIMIT[String(account?.plan ?? "free")] ?? 0;
      const used = this.state.domains.filter(
        (d) => this.state.pages.find((p) => p.id === d.page_id)?.owner_id === page.owner_id,
      ).length;
      if (used >= limit) return { data: null, error: { code: "HL003", message: "domain_limit_reached" } };
      this.state.domains.push(row);
      return this.shape([row]);
    }

    let matched = rows
      .map((row) => this.join(row))
      .filter((row): row is Row => row !== null)
      .filter((row) => this.filters.every((f) => f(row)));

    if (this.op === "update") {
      for (const row of matched) Object.assign(rows.find((r) => r.id === row.id)!, this.payload);
      return this.shape(matched.map((row) => rows.find((r) => r.id === row.id)!));
    }
    if (this.op === "delete") {
      for (const row of matched) rows.splice(rows.indexOf(rows.find((r) => r.id === row.id)!), 1);
      return { data: null, error: null };
    }

    if (this.orderSpec) {
      const { col, ascending, nullsFirst } = this.orderSpec;
      matched = [...matched].sort((a, b) => {
        const av = get(a, col);
        const bv = get(b, col);
        if (av == null || bv == null) {
          if (av == null && bv == null) return 0;
          return (av == null ? -1 : 1) * (nullsFirst ? 1 : -1);
        }
        return (String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    if (this.max !== null) matched = matched.slice(0, this.max);
    if (this.options?.head) return { data: null, error: null, count: matched.length };
    return this.shape(matched);
  }

  private shape(rows: Row[]) {
    if (this.one === "single") {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "expected one row" } };
    }
    if (this.one === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

export function createFakeAdmin(seed: Partial<Pick<FakeState, "accounts" | "pages" | "domains">> & { users?: Record<string, string> } = {}) {
  const state: FakeState = {
    accounts: seed.accounts ?? [],
    pages: seed.pages ?? [],
    domains: seed.domains ?? [],
    users: new Map(Object.entries(seed.users ?? {})),
    clock: Date.parse("2026-10-04T12:00:00Z"),
    failNextInsert: null,
    rpcLog: [],
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    await Promise.resolve();
    state.rpcLog.push({ name, args });
    const row = state.domains.find((d) => d.id === args.p_id);
    const now = state.clock;
    const stamp = new Date(now).toISOString();
    if (!row) return { data: false, error: null };
    if (name === "claim_domain_check") {
      const cooldown = Number(args.p_cooldown_seconds ?? 10) * 1000;
      const last = row.last_checked_at ? Date.parse(String(row.last_checked_at)) : null;
      if (row.status === "pending" && (last === null || last <= now - cooldown)) {
        row.last_checked_at = stamp;
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    if (name === "mark_domain_verified") {
      if (row.status === "verified") return { data: false, error: null };
      row.status = "verified";
      row.verified_at = stamp;
      return { data: true, error: null };
    }
    if (name === "claim_domain_live_email") {
      if (row.status === "verified" && !row.live_email_sent_at) {
        row.live_email_sent_at = stamp;
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    throw new Error(`the fake has no function ${name}`);
  };

  const client = {
    from: (table: "accounts" | "pages" | "domains") => new Query(state, table),
    rpc,
    auth: {
      admin: {
        getUserById: async (id: string) => {
          await Promise.resolve();
          const email = state.users.get(id);
          return { data: { user: email ? { id, email } : null }, error: null };
        },
      },
    },
  };

  return { client: client as unknown as DomainDeps["admin"], state, advance: (ms: number) => void (state.clock += ms) };
}

export interface FakeDomainConfig {
  verified: boolean;
  misconfigured: boolean;
  apexName?: string;
  verification?: ProjectDomain["verification"];
  cname?: { rank: number; value: string }[];
  ipv4?: { rank: number; value: string[] }[];
}

/** A Vercel client that records every call and answers from a per-hostname table. */
export class FakeVercel implements VercelClient {
  calls: { fn: string; host: string }[] = [];
  hosts = new Map<string, FakeDomainConfig & { added: boolean }>();
  addError: VercelApiError | null = null;
  removeError: VercelApiError | null = null;
  verifyError: VercelApiError | null = null;
  configError: VercelApiError | null = null;
  projectError: VercelApiError | null = null;
  /** Called before the add resolves (for racing two adds). */
  beforeAdd: (() => Promise<void>) | null = null;

  state(host: string) {
    let entry = this.hosts.get(host);
    if (!entry) {
      const labels = host.split(".");
      entry = { added: false, verified: false, misconfigured: true, apexName: labels.slice(-2).join(".") };
      this.hosts.set(host, entry);
    }
    return entry;
  }

  count(fn: string, host?: string): number {
    return this.calls.filter((c) => c.fn === fn && (host === undefined || c.host === host)).length;
  }

  private body(host: string): ProjectDomain {
    const s = this.state(host);
    return {
      name: host,
      apexName: s.apexName ?? "",
      verified: s.verified,
      verification: s.verified ? [] : (s.verification ?? []),
    };
  }

  async addProjectDomain(host: string) {
    this.calls.push({ fn: "add", host });
    await Promise.resolve();
    if (this.beforeAdd) await this.beforeAdd();
    if (this.addError) throw this.addError;
    const s = this.state(host);
    if (s.added) throw new VercelApiError("conflict", 400, "existing_project_domain", "already on the project");
    s.added = true;
    return this.body(host);
  }
  async getProjectDomain(host: string) {
    this.calls.push({ fn: "get", host });
    await Promise.resolve();
    if (this.projectError) throw this.projectError;
    return this.body(host);
  }
  async verifyProjectDomain(host: string) {
    this.calls.push({ fn: "verify", host });
    await Promise.resolve();
    if (this.verifyError) throw this.verifyError;
    return { verified: this.state(host).verified };
  }
  async getDomainConfig(host: string): Promise<DomainConfig> {
    this.calls.push({ fn: "config", host });
    await Promise.resolve();
    if (this.configError) throw this.configError;
    const s = this.state(host);
    return {
      misconfigured: s.misconfigured,
      configuredBy: s.misconfigured ? null : "CNAME",
      recommendedCNAME: s.cname ?? [{ rank: 1, value: "abc123.vercel-dns-017.com." }],
      recommendedIPv4: s.ipv4 ?? [{ rank: 1, value: ["203.0.113.10"] }],
    };
  }
  async removeProjectDomain(host: string) {
    this.calls.push({ fn: "remove", host });
    await Promise.resolve();
    if (this.removeError) throw this.removeError;
    this.hosts.delete(host);
  }
}

export interface Harness {
  deps: DomainDeps;
  admin: ReturnType<typeof createFakeAdmin>;
  vercel: FakeVercel;
  emails: { to: string; hostname: string }[];
  expired: string[];
  logs: string[];
}

export const IDS = {
  free: "00000000-0000-4000-8000-00000000f001",
  pro: "00000000-0000-4000-8000-00000000f002",
  studio: "00000000-0000-4000-8000-00000000f003",
  other: "00000000-0000-4000-8000-00000000f004",
  freePage: "00000000-0000-4000-8000-0000000000e1",
  proPage: "00000000-0000-4000-8000-0000000000e2",
  proPage2: "00000000-0000-4000-8000-0000000000e5",
  studioPage: "00000000-0000-4000-8000-0000000000e3",
  otherPage: "00000000-0000-4000-8000-0000000000e4",
} as const;

export function harness(
  options: {
    sendLiveEmail?: DomainDeps["sendLiveEmail"];
    domains?: Row[];
    suspended?: string[];
  } = {},
): Harness {
  const admin = createFakeAdmin({
    accounts: [
      { id: IDS.free, plan: "free", suspended_at: options.suspended?.includes(IDS.free) ? "2026-10-01" : null },
      { id: IDS.pro, plan: "pro", suspended_at: options.suspended?.includes(IDS.pro) ? "2026-10-01" : null },
      { id: IDS.studio, plan: "studio", suspended_at: null },
      { id: IDS.other, plan: "pro", suspended_at: null },
    ],
    pages: [
      { id: IDS.freePage, owner_id: IDS.free, published_at: "2026-10-01T00:00:00Z" },
      { id: IDS.proPage, owner_id: IDS.pro, published_at: "2026-10-01T00:00:00Z" },
      { id: IDS.proPage2, owner_id: IDS.pro, published_at: "2026-10-01T00:00:00Z" },
      { id: IDS.studioPage, owner_id: IDS.studio, published_at: "2026-10-01T00:00:00Z" },
      { id: IDS.otherPage, owner_id: IDS.other, published_at: "2026-10-01T00:00:00Z" },
    ],
    domains: options.domains ?? [],
    users: {
      [IDS.free]: "free@example.test",
      [IDS.pro]: "pro@example.test",
      [IDS.studio]: "studio@example.test",
      [IDS.other]: "other@example.test",
    },
  });
  const vercel = new FakeVercel();
  const emails: { to: string; hostname: string }[] = [];
  const expired: string[] = [];
  const logs: string[] = [];
  const deps: DomainDeps = {
    admin: admin.client,
    vercel,
    expirePage: (pageId) => void expired.push(pageId),
    sendLiveEmail:
      options.sendLiveEmail ??
      (async (input) => {
        emails.push(input);
      }),
    rootDomain: "hydlnk.com",
    log: (message) => void logs.push(message),
  };
  return { deps, admin, vercel, emails, expired, logs };
}

export function domainRow(overrides: Row & { hostname: string; page_id: string }): Row {
  return {
    id: crypto.randomUUID(),
    status: "pending",
    verified_at: null,
    last_checked_at: null,
    live_email_sent_at: null,
    created_at: "2026-10-04T11:00:00.000Z",
    ...overrides,
  };
}
