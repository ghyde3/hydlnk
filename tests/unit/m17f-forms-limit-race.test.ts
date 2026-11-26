import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_DB_CONTAINER, localPsql, seedFormRows } from "../../scripts/lib/local-db";
import { removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminClient, publishedOwner, record } from "./m17f-forms-db-support";

/**
 * M17-02 step 3, the concurrency case: two calls at the cap, in two database sessions that are
 * PROVEN to overlap, store exactly one. The row says "pgTAP"; one pgTAP transaction cannot hold two
 * sessions, so this is a Vitest database test (owner decision, recorded in PLAN.md and PROGRESS.md).
 *
 * How the overlap is forced: session A opens a transaction and calls record_form_submission (stored,
 * not committed). Session B then calls it too; the test waits until pg_stat_activity shows B WAITING
 * ON A LOCK (the account's usage row, taken FOR UPDATE by the HL016 trigger), and only then commits
 * A. B must then count A's row and refuse. A version without that lock would let B count 99 and
 * store a 101st. pgTAP 220 has every other case of the cap.
 *
 * The month's usage row exists, committed, before session A starts (forms attack pass, finding 8a):
 * otherwise B would wait on A's INSERT of a brand-new row (the unique key), not on the row lock,
 * and the test would pass with FOR UPDATE removed. Checked by that mutation: red without it.
 *
 * The seed rows stand on a second site of the account (made with no trigger running) and are dated
 * the 1st of the month, so the per-site daily cap of the site under test is never what refuses,
 * whatever the date.
 */
const { run } = await stackIsUp();

/** One long-lived psql session: send a statement, read the line it prints. */
class Session {
  private out = "";
  private readonly proc: ChildProcessWithoutNullStreams;
  constructor() {
    this.proc = spawn(
      "docker",
      ["exec", "-i", LOCAL_DB_CONTAINER, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.proc.stdout.on("data", (chunk: Buffer) => (this.out += chunk.toString("utf8")));
    this.proc.stderr.on("data", (chunk: Buffer) => (this.out += chunk.toString("utf8")));
  }
  send(sql: string): void {
    this.proc.stdin.write(`${sql}\n`);
  }
  /** Waits until the session printed a line matching `pattern`; returns that line. */
  async line(pattern: RegExp, timeoutMs = 15_000): Promise<string> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const found = this.out.split("\n").find((l) => pattern.test(l));
      if (found !== undefined) return found;
      if (Date.now() > end) throw new Error(`no line matching ${pattern}; got: ${this.out}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  output(): string {
    return this.out;
  }
  end(): void {
    this.proc.stdin.end();
  }
}

const call = (siteId: string, email: string, tag: string) =>
  `select '${tag}:' || status from public.record_form_submission('${siteId}', 'formRace001', null, 'signup', '${email}', '', '');`;

async function waitingOnLock(tag: string): Promise<boolean> {
  const rows = await localPsql(
    `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%''${tag}:''%';`,
  );
  return Number(rows.trim()) > 0;
}

describe.skipIf(!run)(
  "M17-02 the caps under concurrency, two overlapping sessions (local Supabase)",
  () => {
    let admin: SupabaseClient;
    const owners: TestOwner[] = [];

    beforeAll(() => {
      admin = adminClient();
    });
    afterAll(async () => {
      await removeOwners(admin, owners);
    });

    /** A Free owner whose account holds `count` from this month, on a second site. */
    async function ownerAt(label: string, count: number): Promise<TestOwner> {
      const owner = await publishedOwner(admin, label);
      owners.push(owner);
      const second = crypto.randomUUID();
      await localPsql(`begin;
set local session_replication_role = replica;
insert into public.pages (id, owner_id, handle, draft, published, published_at)
  values ('${second}', '${owner.userId}', '${owner.handle}-2',
    '{"version":1,"rev":1,"profile":{"name":"S","bio":"","photo":null},"theme":{"ref":null,"overrides":{}},"blocks":[]}',
    '{"version":1,"blocks":[]}', now());
commit;`);
      if (count > 0) await seedFormRows(second, count);
      // The month's lock row, committed before any session starts: only FOR UPDATE can serialise.
      await localPsql(
        `insert into public.form_submission_usage (owner_id, month) values ('${owner.userId}', public.form_usage_month());`,
      );
      return owner;
    }

    const storedOn = async (owner: TestOwner) => {
      const { count } = await admin
        .from("form_submissions")
        .select("id", { count: "exact", head: true })
        .eq("site_id", owner.pageId);
      return count;
    };

    it("at 99 on Free: B waits on A's lock, A commits, B is refused; exactly one stored", async () => {
      const owner = await ownerAt("frace-a", 99);
      const a = new Session();
      const b = new Session();
      try {
        a.send("begin;");
        a.send(call(owner.pageId, "first@example.test", "A"));
        expect(await a.line(/^A:/)).toBe("A:stored");

        b.send(call(owner.pageId, "second@example.test", "B"));
        await expect.poll(() => waitingOnLock("B"), { timeout: 15_000, interval: 100 }).toBe(true);
        // Still waiting: B has printed nothing while A holds the lock.
        expect(b.output()).not.toMatch(/^B:/m);

        a.send("commit;");
        expect(await b.line(/^B:/)).toBe("B:over_limit_first");
      } finally {
        a.end();
        b.end();
      }
      expect(await storedOn(owner)).toBe(1);
      const usage = await admin.rpc("form_usage", { p_uid: owner.userId });
      expect(usage.data).toEqual([expect.objectContaining({ stored: 100, refused: 1 })]);
    }, 60_000);

    it("at 19 today on one site (the daily cap): the same overlap stores exactly one", async () => {
      const owner = await ownerAt("frace-d", 0);
      await seedFormRows(owner.pageId, 19, {
        createdAt: new Date().toISOString(),
        prefix: "today",
      });
      const a = new Session();
      const b = new Session();
      try {
        a.send("begin;");
        a.send(call(owner.pageId, "first@example.test", "A"));
        expect(await a.line(/^A:/)).toBe("A:stored");
        b.send(call(owner.pageId, "second@example.test", "B"));
        await expect.poll(() => waitingOnLock("B"), { timeout: 15_000, interval: 100 }).toBe(true);
        a.send("commit;");
        expect(await b.line(/^B:/)).toBe("B:over_daily_limit");
      } finally {
        a.end();
        b.end();
      }
      expect(await storedOn(owner)).toBe(20);
    }, 60_000);

    it("ten concurrent calls at 95 over the API store exactly five, and the refusals are counted", async () => {
      const owner = await ownerAt("frace-b", 95);
      const statuses = await Promise.all(
        Array.from({ length: 10 }, (_, i) => record(admin, owner, `burst${i}@example.test`)),
      );
      expect(statuses.filter((s) => s === "stored")).toHaveLength(5);
      expect(statuses.filter((s) => s === "over_limit_first")).toHaveLength(1);
      expect(statuses.filter((s) => s === "over_limit")).toHaveLength(4);
      expect(await storedOn(owner)).toBe(5);
      const usage = await admin.rpc("form_usage", { p_uid: owner.userId });
      expect(usage.data).toEqual([expect.objectContaining({ stored: 100, refused: 5 })]);
    }, 60_000);
  },
);
