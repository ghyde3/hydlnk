import { describe, expect, it } from "vitest";
import { profileInitials } from "@/lib/editor/initials";

/** M2-07: first letter of the first and of the last word, upper case; empty is "?". */
describe("profileInitials", () => {
  it.each([
    ["Mara Okafor", "MO"],
    ["Prince", "P"],
    ["", "?"],
    ["   ", "?"],
    ["jean claude van damme", "JD"],
    ["  mara   okafor  ", "MO"],
    ["😀 Smile", "😀S"],
    ["<b>x</b>", "<"],
  ])("%j -> %j", (name, initials) => {
    expect(profileInitials(name)).toBe(initials);
  });
});
