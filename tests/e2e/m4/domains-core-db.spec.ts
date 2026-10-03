import { domainToASCII } from "node:url";
import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers, desktopOnly, makeUser, rand } from "../fixtures/data";
import { hostnameFor, publishedPage } from "./domains-core-helpers";

/**
 * M4-12 against the real Postgres (the pgTAP file proves the same rules inside one transaction;
 * concurrency needs real connections): the plan limit binds every writer, two simultaneous adds at
 * 0 of 1 produce exactly one row (advisory lock), and the unique hostname holds under a race.
 */

test.afterAll(cleanupUsers);
test.describe.configure({ timeout: 120_000 });

async function owner(label: string, plan: "free" | "pro" | "studio", pages = 1) {
  const user = await makeUser(label, { plan });
  const ids: string[] = [];
  for (let i = 0; i < pages; i++) ids.push(await publishedPage(user.id, `zq-${label}-${rand(5)}`, `Zq ${label}`));
  return { user, ids };
}

const insert = (pageId: string, hostname: string) =>
  adminClient().from("domains").insert({ page_id: pageId, hostname }).select("id");

test.describe("M4-12 the database backstop, even for the secret key", () => {
  test("M4-12 Free 0: the first domain raises domain_limit_reached (HL003)", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    const { ids } = await owner("dbf", "free");
    const { error, data } = await insert(ids[0]!, hostnameFor("free"));
    expect(data ?? null).toBeNull();
    expect(error?.code).toBe("HL003");
    expect(error?.message).toBe("domain_limit_reached");
  });

  test("M4-12 Pro 1: one is allowed, the second raises, on any page of the account", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    const { ids } = await owner("dbp", "pro", 2);
    expect((await insert(ids[0]!, hostnameFor("p1"))).error).toBeNull();
    for (const page of ids) {
      const res = await insert(page, hostnameFor("p2"));
      expect(res.error?.code).toBe("HL003");
    }
  });

  test("M4-12 Studio 15: fifteen are allowed, the sixteenth raises, and a removal frees a slot at once", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    const { ids } = await owner("dbs", "studio");
    const hosts = Array.from({ length: 15 }, (_, i) => hostnameFor(`s${i}`));
    const batch = await adminClient().from("domains").insert(hosts.map((hostname) => ({ page_id: ids[0], hostname }))).select("id");
    expect(batch.error).toBeNull();
    expect(batch.data).toHaveLength(15);
    const sixteenth = await insert(ids[0]!, hostnameFor("s16"));
    expect(sixteenth.error?.code).toBe("HL003");
    await adminClient().from("domains").delete().eq("hostname", hosts[0]!);
    expect((await insert(ids[0]!, hostnameFor("s16b"))).error).toBeNull();
  });

  test("M4-12 two simultaneous adds at 0 of 1 produce exactly one row, every time", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    for (let round = 0; round < 4; round++) {
      const { ids } = await owner(`dbr${round}`, "pro", 2);
      const a = hostnameFor(`ra${round}`);
      const b = hostnameFor(`rb${round}`);
      const results = await Promise.all([insert(ids[0]!, a), insert(ids[1]!, b)]);
      const failures = results.filter((r) => r.error);
      expect(results.filter((r) => !r.error), `round ${round}`).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.error?.code).toBe("HL003");
      const rows = await adminClient().from("domains").select("hostname").in("hostname", [a, b]);
      expect(rows.data).toHaveLength(1);
    }
  });

  test("M4-11 two simultaneous adds of the same hostname create exactly one row (unique constraint)", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    const first = await owner("dbu1", "studio");
    const second = await owner("dbu2", "pro");
    const hostname = hostnameFor("same");
    const results = await Promise.all([insert(first.ids[0]!, hostname), insert(second.ids[0]!, hostname)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)!.error?.code).toBe("23505");
    const rows = await adminClient().from("domains").select("id").eq("hostname", hostname);
    expect(rows.data).toHaveLength(1);
  });

  test("M4-11 the table refuses what the validator refuses (the format check is the last wall)", async ({}, info) => {
    test.skip(!desktopOnly(info), "a database flow: one project is enough");
    const { ids } = await owner("dbv", "studio");
    for (const bad of ["Links.Example.Test", "localhost", "203.0.113.5", "a_b.example.test", "links.example.test/x", "links.example.test."]) {
      const res = await insert(ids[0]!, bad);
      expect(res.error?.code, bad).toBe("23514");
    }
    // The validator's punycode output is accepted.
    const puny = domainToASCII(`zq${rand(4)}-bücher.example`);
    expect(puny.startsWith("xn--")).toBe(true);
    expect((await insert(ids[0]!, puny)).error).toBeNull();
  });
});
