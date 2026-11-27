import { describe, expect, it } from "vitest";
import { calleeName, calls, enclosingFunction, functionCalls, functionName, parse, readSource, sourceFiles } from "./ts-scan";

/**
 * Team access attack pass, finding 2 (M19-09, M19-10): every function that records site activity
 * (`recordSiteActivity(`) asks the activity limit in the same function (`activityLimited(` or
 * `activityAllowed(`, 30 a minute per actor), or is listed here with the limit it has instead. A new
 * recorder without a limit fails this test. The mutation check below feeds the scan a throwaway file.
 */

const RECORDER = new Set(["recordSiteActivity"]);
const LIMITER = new Set(["activityLimited", "activityAllowed"]);

/** Recorders with another limit, and which. */
const OTHER_LIMIT: Readonly<Record<string, string>> = {
  "src/lib/publish/core.ts:publishPageCore": "site Publish: 60 an hour on the actor and the owner (publish/actions.ts, G18)",
  "src/lib/publish/core.ts:publishSitePageCore": "page Publish: the same 60 an hour; a schedule's fire is the worker's",
  "src/lib/publish/core.ts:publishDesignCore": "design Publish: the same 60 an hour",
};

function unlimited(list: readonly string[], text: (file: string) => string = readSource): string[] {
  const out = new Set<string>();
  for (const file of list) {
    const source = text(file);
    if (!source.includes("recordSiteActivity")) continue;
    const sf = parse(file, source);
    const all = calls(sf);
    for (const call of all) {
      if (!RECORDER.has(calleeName(call) ?? "")) continue;
      const fn = enclosingFunction(call);
      if (!functionCalls(fn, all, LIMITER)) out.add(`${file}:${functionName(fn, sf)}`);
    }
  }
  return [...out].sort();
}

describe("finding 2: every activity recorder is rate limited", () => {
  it("each function that calls recordSiteActivity calls the activity limit, or is listed with its own", () => {
    expect(unlimited(sourceFiles())).toEqual(Object.keys(OTHER_LIMIT).sort());
    for (const reason of Object.values(OTHER_LIMIT)) expect(reason).not.toBe("");
  });

  it("a recorder without the limit is caught, and a limit in another function does not excuse it", () => {
    const fake = "src/lib/fake/recorder.ts";
    const source = `
      export async function limitedOne(access) { if (!(await activityAllowed(access.actorId))) return; await recordSiteActivity(admin, access, "entry_trashed"); }
      export async function bare(access) { await recordSiteActivity(admin, access, "entry_restored"); }
      // activityLimited( in a comment is not a call
    `;
    expect(unlimited([fake], () => source)).toEqual([`${fake}:bare`]);
  });
});
