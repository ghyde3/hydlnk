import { describe, expect, it } from "vitest";
import {
  CLIENT_NAME_MAX_CODE_POINTS,
  HYDLNK_NAME_REFUSAL,
  UNNAMED_APP,
  clientInitials,
  namesHydlnk,
  namesHydlnkWithoutRight,
  sanitizeClientName,
} from "@/lib/oauth/client-name";

/**
 * M10-09: what an app calls itself, cleaned. The invisible characters are built with
 * String.fromCodePoint so no raw bidi or zero-width character sits in this file.
 */

const ch = (...points: number[]) => String.fromCodePoint(...points);
const RLO = ch(0x202e);
const LRO = ch(0x202d);
const ISOLATE = ch(0x2066);
const LRM = ch(0x200e);
const RLM = ch(0x200f);
const ZWSP = ch(0x200b);
const ZWJ = ch(0x200d);
const WORD_JOINER = ch(0x2060);
const BOM = ch(0xfeff);

describe("M10-09 sanitizeClientName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitizeClientName("Claude", "fallback")).toBe("Claude");
    expect(sanitizeClientName("Claude Code", "fallback")).toBe("Claude Code");
    expect(sanitizeClientName("ChatGPT", "fallback")).toBe("ChatGPT");
  });

  it("removes bidirectional controls, so the neighboring words are not reordered", () => {
    expect(sanitizeClientName(`Cla${RLO}ude`, "x")).toBe("Claude");
    expect(sanitizeClientName(`${LRO}Claude${ISOLATE} Code`, "x")).toBe("Claude Code");
    expect(sanitizeClientName(`a${LRM}b${RLM}c`, "x")).toBe("abc");
  });

  it("removes zero-width characters", () => {
    expect(sanitizeClientName(`Cl${ZWSP}au${ZWJ}de${WORD_JOINER}${BOM}`, "x")).toBe("Claude");
  });

  it("removes control characters and turns line breaks into spaces", () => {
    expect(sanitizeClientName("Cla\u0007ude", "x")).toBe("Claude");
    expect(sanitizeClientName("Claude\nCode", "x")).toBe("Claude Code");
    expect(sanitizeClientName("Claude\r\n\tCode", "x")).toBe("Claude Code");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(sanitizeClientName("   Claude     Code   ", "x")).toBe("Claude Code");
    expect(sanitizeClientName("Claude  Code", "x")).toBe("Claude Code");
  });

  it("normalizes to NFC", () => {
    expect(sanitizeClientName("Café", "x")).toBe("Café");
  });

  it("leaves markup as literal text: it is escaped at render, never stripped", () => {
    expect(sanitizeClientName("<script>alert(1)</script>", "x")).toBe("<script>alert(1)</script>");
    expect(sanitizeClientName("<img src=x onerror=alert(1)>", "x")).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("cuts a 500-character name at 100 code points, never inside a character", () => {
    const long = sanitizeClientName("a".repeat(500), "x");
    expect(Array.from(long).length).toBe(CLIENT_NAME_MAX_CODE_POINTS);
    const emoji = sanitizeClientName("\u{1f600}".repeat(150), "x");
    expect(Array.from(emoji).length).toBe(100);
    expect(emoji).toBe("\u{1f600}".repeat(100));
  });

  it("an empty result is the fallback: the host for a metadata client, 'Unnamed app' for a registered one", () => {
    expect(sanitizeClientName("", "claude.ai")).toBe("claude.ai");
    expect(sanitizeClientName(`  ${ZWSP}${RLO} `, "claude.ai")).toBe("claude.ai");
    expect(sanitizeClientName(undefined, UNNAMED_APP)).toBe("Unnamed app");
    expect(sanitizeClientName(42, UNNAMED_APP)).toBe("Unnamed app");
    expect(sanitizeClientName(null, UNNAMED_APP)).toBe("Unnamed app");
  });
});

describe("M10-09 impersonation of this product", () => {
  it.each([
    "HYDLNK Support",
    "hydlnk",
    "hyd lnk",
    "H-Y-D-L-N-K",
    "H Y D L N K",
    "hyd_lnk",
    "h.y.d.l.n.k",
    `HYD${ZWSP}LNK`,
    "ＨＹＤＬＮＫ Official",
    "My HydLnk helper",
  ])("%j is refused", (name) => {
    expect(namesHydlnk(name)).toBe(true);
  });

  it.each(["Claude", "ChatGPT", "Claude Code", "Cursor", "Hyde Link", "Hydrate lnk"])(
    "%j is not refused: real clients use such names",
    (name) => {
      expect(namesHydlnk(name)).toBe(false);
    },
  );

  // Wave L second review, finding 12: Claude Code's fallback registration name is "Claude Code (hydlnk)"
  // and it returns only to this computer. The name rule keeps the refusal for everyone else.
  describe("namesHydlnkWithoutRight", () => {
    const loopback = ["http://localhost:8080/cb", "http://127.0.0.1:9000/cb"];
    it("a name that does not say hydlnk is never refused", () => {
      expect(namesHydlnkWithoutRight("Claude Code", ["https://a.example/cb"])).toBe(false);
    });
    it("hydlnk in the name is allowed when every return address is on this computer", () => {
      expect(namesHydlnkWithoutRight("Claude Code (hydlnk)", loopback)).toBe(false);
      expect(namesHydlnkWithoutRight("H-Y-D-L-N-K", ["http://[::1]:4000/cb"])).toBe(false);
    });
    it("hydlnk in the name is refused when any return address is https, or there is none", () => {
      expect(namesHydlnkWithoutRight("Claude Code (hydlnk)", ["https://a.example/cb"])).toBe(true);
      expect(namesHydlnkWithoutRight("HYDLNK Support", [...loopback, "https://a.example/cb"])).toBe(true);
      expect(namesHydlnkWithoutRight("HYDLNK Support", [])).toBe(true);
      expect(namesHydlnkWithoutRight("HYDLNK Support", ["not a url"])).toBe(true);
    });
  });

  it("names the refusal in plain words", () => {
    expect(HYDLNK_NAME_REFUSAL).toBe("The name can’t include HYDLNK.");
  });
});

describe("M10-09 clientInitials", () => {
  it("the first letter of each of the first two words, upper case", () => {
    expect(clientInitials("Claude Code")).toBe("CC");
    expect(clientInitials("ChatGPT")).toBe("C");
    expect(clientInitials("my cool app")).toBe("MC");
    expect(clientInitials("  spaced   out  ")).toBe("SO");
  });

  it("an empty name is a question mark", () => {
    expect(clientInitials("")).toBe("?");
    expect(clientInitials("   ")).toBe("?");
  });

  it("takes a whole character, not half of a surrogate pair", () => {
    expect(clientInitials("\u{1f600} smile")).toBe("\u{1f600}S");
  });
});
