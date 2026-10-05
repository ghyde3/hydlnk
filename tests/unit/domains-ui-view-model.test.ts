import { describe, expect, it } from "vitest";
import type { DomainView } from "@/lib/domains/types";
import {
  boughtDomain,
  canAddDomain,
  chipFor,
  isStalePending,
  mergeDomainView,
  nextPollDelay,
  POLL_SCHEDULE,
  recordsTitle,
  showsStudioUpsell,
  STALE_PENDING_MS,
  statusLineFor,
  stepsFor,
  studioUpsellText,
  usageLine,
} from "@/components/domains/view-model";

/**
 * What the Domains screen says for each state (M4-10, M4-14, M5-18, M5-23), as data: the chip, the
 * three steps, the usage line, the Studio strip and the 48-hour rule. The exact sentences matter
 * (the acceptance steps quote them), so they are asserted verbatim, curly apostrophes included.
 */

describe("M4-14 status chip derives from domains.status only", () => {
  it("pending is Waiting for DNS, verified is Live · SSL issued, error needs attention", () => {
    expect(chipFor("pending")).toEqual({ text: "Waiting for DNS", tone: "wait" });
    expect(chipFor("verified")).toEqual({ text: "Live · SSL issued", tone: "live" });
    expect(chipFor("error")).toEqual({ text: "Needs attention", tone: "error" });
  });
});

describe("M4-14 steps of a pending domain", () => {
  const steps = stepsFor({ status: "pending", hostname: "links.example.test", stale: false });

  it("step 1 done, step 2 current, step 3 to do, each circle with a text alternative", () => {
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "todo"]);
    expect(steps.map((s) => s.label)).toEqual([
      "Step 1 of 3, done",
      "Step 2 of 3, current",
      "Step 3 of 3, to do",
    ]);
  });

  it("carries the documented titles and texts", () => {
    expect(steps[0]).toMatchObject({
      title: "Domain added",
      text: "Registered with our host. Nothing else to do here.",
    });
    expect(steps[1]).toMatchObject({
      title: "Add this record at your DNS provider",
      text: "Wherever you bought example.test — GoDaddy, Namecheap, Cloudflare and so on.",
    });
    expect(steps[2]).toMatchObject({ title: "We verify and issue SSL" });
  });

  it("M5-23 step 3 is the M4 sentence with the email sentence appended", () => {
    expect(steps[2]!.text).toBe(
      "Automatic once the record resolves — usually minutes, occasionally up to 48 hours. We’ll email you when it’s live.",
    );
  });
});

describe("M5-18 a domain pending for 48 hours", () => {
  it("replaces step 3's text entirely", () => {
    const steps = stepsFor({ status: "pending", hostname: "links.example.test", stale: true });
    expect(steps[2]!.text).toBe(
      "Still not resolving after 48 hours. Check the record at your DNS provider, or remove the domain and add it again.",
    );
    expect(steps[2]!.text).not.toContain("email");
    expect(steps[1]!.state).toBe("current");
  });

  it("isStalePending is true from exactly 48 hours on, false before, and false for no date", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(isStalePending(ago(STALE_PENDING_MS), now)).toBe(true);
    expect(isStalePending(ago(STALE_PENDING_MS + 1), now)).toBe(true);
    expect(isStalePending(ago(STALE_PENDING_MS - 1), now)).toBe(false);
    expect(isStalePending(ago(60_000), now)).toBe(false);
    expect(isStalePending(null, now)).toBe(false);
    expect(isStalePending("not a date", now)).toBe(false);
  });
});

describe("M4-14 steps of a verified domain", () => {
  const steps = stepsFor({ status: "verified", hostname: "links.example.test", stale: false });

  it("all three done, and step 3 says the domain is serving over HTTPS", () => {
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(steps.map((s) => s.label)).toEqual([
      "Step 1 of 3, done",
      "Step 2 of 3, done",
      "Step 3 of 3, done",
    ]);
    expect(steps[2]!.text).toBe("Verified. links.example.test is serving your site over HTTPS.");
  });

  it("is never stale", () => {
    const stale = stepsFor({ status: "verified", hostname: "links.example.test", stale: true });
    expect(stale[2]!.text).toBe("Verified. links.example.test is serving your site over HTTPS.");
  });
});

describe("M4-13 step 2 wording", () => {
  it("one record reads 'this record', two read 'these records'", () => {
    expect(recordsTitle(1)).toBe("Add this record at your DNS provider");
    expect(recordsTitle(2)).toBe("Add these records at your DNS provider");
  });

  it("step 2's title follows the number of records shown", () => {
    const title = (recordCount?: number) =>
      stepsFor({ status: "pending", hostname: "links.example.test", stale: false, recordCount })[1]!
        .title;
    expect(title()).toBe("Add this record at your DNS provider");
    expect(title(0)).toBe("Add this record at your DNS provider");
    expect(title(1)).toBe("Add this record at your DNS provider");
    expect(title(2)).toBe("Add these records at your DNS provider");
  });

  it("names the bought domain from Vercel's apex name, else the last two labels", () => {
    expect(boughtDomain("links.example.test", "example.test")).toBe("example.test");
    expect(boughtDomain("links.example.test")).toBe("example.test");
    expect(boughtDomain("a.b.example.test")).toBe("example.test");
    expect(boughtDomain("example.test")).toBe("example.test");
    expect(boughtDomain("links.example.co.uk")).toBe("example.co.uk");
    expect(boughtDomain("links.example.co.uk", "example.co.uk")).toBe("example.co.uk");
  });
});

describe("M4-10 usage line, form and the Studio strip", () => {
  it("reads '0 of 1 used on Pro' and '0 of 15 used on Studio', from the limits table", () => {
    expect(usageLine("pro", 0)).toBe("0 of 1 used on Pro");
    expect(usageLine("pro", 1)).toBe("1 of 1 used on Pro");
    expect(usageLine("studio", 0)).toBe("0 of 15 used on Studio");
    expect(usageLine("studio", 7)).toBe("7 of 15 used on Studio");
  });

  it("Free has no usage line unless domains were kept past a downgrade", () => {
    expect(usageLine("free", 0)).toBeNull();
    expect(usageLine("free", 1)).toBe("1 of 0 used on Free");
  });

  it("the add form is offered only while a slot is free (M4-12 at the limit it is gone)", () => {
    expect(canAddDomain("free", 0)).toBe(false);
    expect(canAddDomain("pro", 0)).toBe(true);
    expect(canAddDomain("pro", 1)).toBe(false);
    expect(canAddDomain("studio", 14)).toBe(true);
    expect(canAddDomain("studio", 15)).toBe(false);
  });

  it("the Studio strip is for Pro only and says 15 from the table", () => {
    expect(showsStudioUpsell("pro")).toBe(true);
    expect(showsStudioUpsell("free")).toBe(false);
    expect(showsStudioUpsell("studio")).toBe(false);
    expect(studioUpsellText()).toBe(
      "Running sites for clients? Studio includes 15 custom domains.",
    );
  });
});

describe("M4-15 polling delays", () => {
  it("every 10 seconds, every 30 after 5 minutes, nothing after 30 minutes", () => {
    expect(nextPollDelay(0)).toBe(10_000);
    expect(nextPollDelay(4 * 60_000 + 59_000)).toBe(10_000);
    expect(nextPollDelay(5 * 60_000)).toBe(30_000);
    expect(nextPollDelay(29 * 60_000)).toBe(30_000);
    expect(nextPollDelay(30 * 60_000)).toBeNull();
    expect(nextPollDelay(31 * 60_000)).toBeNull();
    expect(POLL_SCHEDULE).toEqual({
      fastMs: 10_000,
      slowMs: 30_000,
      slowAfterMs: 300_000,
      stopAfterMs: 1_800_000,
    });
  });
});

const view = (patch: Partial<DomainView> = {}): DomainView => ({
  id: "d1",
  hostname: "links.example.test",
  pageId: "p1",
  status: "pending",
  verifiedAt: null,
  lastCheckedAt: null,
  createdAt: "2026-10-04T11:00:00.000Z",
  records: [{ type: "CNAME", name: "links", value: "target.example-dns.test" }],
  misconfigured: false,
  message: null,
  recordsUnavailable: false,
  apex: { name: "example.test", ipv4: "198.51.100.7" },
  ...patch,
});

describe("M4-15, M5-18 the line under the buttons", () => {
  it("shows the server's sentence for 'not there yet' and for the cooldown", () => {
    expect(
      statusLineFor(
        view({
          message:
            "Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.",
        }),
      ),
    ).toBe("Checked just now. DNS isn’t pointing here yet. Records can take a while to spread.");
    expect(statusLineFor(view({ message: "Checked a few seconds ago." }))).toBe(
      "Checked a few seconds ago.",
    );
  });

  it("says M5-18's sentence when the host could not be reached", () => {
    expect(
      statusLineFor(view({ message: "We couldn’t check right now. Try again in a minute." })),
    ).toBe("We couldn’t check right now. Try again in a minute.");
  });

  it("has no line without a message, and none for a verified domain", () => {
    expect(statusLineFor(view())).toBeNull();
    expect(statusLineFor(view({ message: "" }))).toBeNull();
    expect(
      statusLineFor(view({ status: "verified", message: "Checked a few seconds ago." })),
    ).toBeNull();
  });
});

describe("M4-13 a later read that could not load the records keeps the earlier ones", () => {
  it("keeps records and the apex note, never invents any", () => {
    const failed = view({ records: [], apex: null, recordsUnavailable: true });
    const merged = mergeDomainView(view(), failed);
    expect(merged.records).toHaveLength(1);
    expect(merged.apex).toEqual({ name: "example.test", ipv4: "198.51.100.7" });
    expect(merged.recordsUnavailable).toBe(false);
    // Nothing earlier to keep: it still says it could not load them.
    const first = mergeDomainView(
      view({ records: [], apex: null, recordsUnavailable: true }),
      failed,
    );
    expect(first.records).toEqual([]);
    expect(first.recordsUnavailable).toBe(true);
  });

  it("takes a newer read as is when it has records, and always takes a verified one", () => {
    const next = view({ records: [{ type: "A", name: "@", value: "198.51.100.9" }] });
    expect(mergeDomainView(view(), next)).toEqual(next);
    const live = view({ status: "verified", records: [], recordsUnavailable: true });
    expect(mergeDomainView(view(), live)).toEqual(live);
  });
});
