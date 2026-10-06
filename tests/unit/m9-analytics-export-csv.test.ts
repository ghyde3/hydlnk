import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  EXPORT_KINDS,
  EXPORT_RATE_LIMIT,
  EXPORT_RATE_WINDOW_SECONDS,
  csvCell,
  dailyCsv,
  exportFilename,
  exportHref,
  linksCsv,
  parseKind,
} from "@/lib/analytics/export";

/**
 * M9-26: how a CSV cell is written, the two files, the file name and the query string. All pure.
 * The spreadsheet rules are the point: a link label comes from the page owner's own text, and a
 * spreadsheet opens a cell that starts with `=` as a formula.
 */

/** A small RFC 4180 reader: what Excel, Sheets and every CSV library would make of the bytes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

describe("M9-26 csvCell: spreadsheet safety", () => {
  const formulas: [string, string][] = [
    ['=HYPERLINK("http://evil.example","x")', `"'=HYPERLINK(""http://evil.example"",""x"")"`],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["+1-1", "'+1-1"],
    ["-2+3", "'-2+3"],
    ["=1+1", "'=1+1"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", `"'\rcmd"`],
  ];
  it.each(formulas)("M9-26 %j is written with a leading apostrophe", (input, written) => {
    expect(csvCell(input)).toBe(written);
    // Read back by a parser, the apostrophe is the only difference: the cell is text.
    expect(parseCsv(`${csvCell(input)}\r\n`)[0]![0]).toBe(`'${input}`);
  });

  it("M9-26 only the first character decides: a formula character inside the text is left alone", () => {
    for (const label of ["Prints = $20", "a+b", "mail@home", "x-y", "Shop (new)", "50% off"]) {
      expect(csvCell(label)).toBe(label);
    }
  });

  it("M9-26 an ordinary label, an empty label and the digits are written as they are", () => {
    expect(csvCell("Portrait sessions")).toBe("Portrait sessions");
    expect(csvCell("")).toBe("");
    expect(csvCell("Café — Zürich 日本語")).toBe("Café — Zürich 日本語");
  });

  it("M9-26 numbers are written bare, never with an apostrophe", () => {
    expect(csvCell(0)).toBe("0");
    expect(csvCell(1284)).toBe("1284");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(Number.NaN)).toBe("0");
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("M9-26 csvCell: characters that never belong in a label", () => {
  it("M9-26 removes C0 and C1 controls and the delete character", () => {
    expect(csvCell("a\u0000b\u0001c\u001fd\u007fe\u0085f\u009fg")).toBe("abcdefg");
  });

  it("M9-26 removes bidirectional marks, embeddings, overrides and isolates", () => {
    const bidi = ["\u061C", "\u200E", "\u200F", "\u202A", "\u202B", "\u202C", "\u202D", "\u202E"]
      .concat(["\u2066", "\u2067", "\u2068", "\u2069"])
      .join("");
    expect(csvCell(`Sale${bidi}`)).toBe("Sale");
    expect(csvCell(`a\u202Eb\u202Cc`)).toBe("abc");
  });

  it("M9-26 decides on the first character AFTER the removal, so a hidden prefix cannot hide a formula", () => {
    expect(csvCell("\u0000=cmd()")).toBe("'=cmd()");
    expect(csvCell("\u202E=cmd()")).toBe("'=cmd()");
    expect(csvCell("\u200F@x")).toBe("'@x");
  });

  it("M9-26 keeps tab, line feed and carriage return: they are the file's own characters", () => {
    expect(csvCell("a\tb")).toBe("a\tb");
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("M9-26 csvCell: RFC 4180 quoting", () => {
  it("M9-26 wraps a cell with a comma, a quote, CR or LF in quotes and doubles its quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
    expect(csvCell("one\rtwo")).toBe('"one\rtwo"');
  });

  it("M9-26 a label with a comma, a quote and a line break round-trips through a CSV parser", () => {
    const label = 'Spring sale, "20% off"\nends Friday';
    const file = linksCsv([{ id: "linkaaaa1", label, page: "Home", clicks: 7 }]);
    expect(parseCsv(file.replace(CSV_BOM, ""))).toEqual([
      ["link_id", "link", "page", "clicks"],
      ["linkaaaa1", label, "Home", "7"],
    ]);
  });

  it("M9-26 every kind of hostile label comes back as one cell of one row", () => {
    const hostile = [
      '=HYPERLINK("http://evil.example","x")',
      "@SUM(1+1)",
      "+1-1",
      "-2+3",
      'a","b',
      "x\r\ny",
    ];
    const file = linksCsv(
      hostile.map((label, i) => ({ id: `link${i}aaaaa`, label, page: "Home", clicks: i })),
    );
    const rows = parseCsv(file.replace(CSV_BOM, ""));
    expect(rows).toHaveLength(hostile.length + 1);
    for (const row of rows) expect(row).toHaveLength(4);
    rows.slice(1).forEach((row, i) => {
      const expected = /^[=+\-@\t\r]/.test(hostile[i]!) ? `'${hostile[i]}` : hostile[i];
      expect(row[1]).toBe(expected);
    });
  });
});

describe("M9-26 the files", () => {
  const days = [
    { day: "2026-09-28", views: 12, clicks: 3, uniques: 9 },
    { day: "2026-09-29", views: 0, clicks: 0, uniques: 0 },
    { day: "2026-09-30", views: 1284, clicks: 392, uniques: 900 },
  ];

  it("M9-26 the daily file starts with a UTF-8 byte order mark, uses CRLF and has the header row", () => {
    const file = dailyCsv(days, "All pages");
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(Buffer.from(file, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(file).toBe(
      `${CSV_BOM}date,page,views,clicks,uniques\r\n` +
        "2026-09-28,All pages,12,3,9\r\n" +
        "2026-09-29,All pages,0,0,0\r\n" +
        "2026-09-30,All pages,1284,392,900\r\n",
    );
    expect(file.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // no bare line endings
  });

  it("M9-26 the links file has link_id, link, page and clicks, in the order given", () => {
    expect(
      linksCsv([
        { id: "linkaaaa1", label: "Prints", page: "Home", clicks: 5 },
        { id: "GoneBlock01", label: "Removed link", page: "", clicks: 2 },
      ]),
    ).toBe(
      `${CSV_BOM}link_id,link,page,clicks\r\nlinkaaaa1,Prints,Home,5\r\nGoneBlock01,Removed link,,2\r\n`,
    );
  });

  it("M9-26 a file with no rows is the header alone", () => {
    expect(linksCsv([])).toBe(`${CSV_BOM}link_id,link,page,clicks\r\n`);
    expect(dailyCsv([], "All pages")).toBe(`${CSV_BOM}date,page,views,clicks,uniques\r\n`);
  });

  it("M9-26 a link id that starts with a dash is text too, not a formula", () => {
    expect(linksCsv([{ id: "-abcdefgh", label: "x", page: "Home", clicks: 1 }])).toContain(
      "\r\n'-abcdefgh,x,Home,1",
    );
  });
});

describe("M9-26 file name, kinds, hrefs and the rate", () => {
  it("M9-26 the name is {handle}-{kind}-{start}-to-{end}.csv", () => {
    expect(exportFilename("mara", "daily", "2026-09-05", "2026-10-04")).toBe(
      "mara-daily-2026-09-05-to-2026-10-04.csv",
    );
    expect(exportFilename("mara-okafor-2", "links", "2026-01-01", "2026-12-31")).toBe(
      "mara-okafor-2-links-2026-01-01-to-2026-12-31.csv",
    );
  });

  it("M9-26 nothing but a-z, 0-9 and a dash survives from a handle", () => {
    expect(exportFilename('a"b\r\nc/../d e', "daily", "2026-01-01", "2026-01-02")).toBe(
      "abcde-daily-2026-01-01-to-2026-01-02.csv",
    );
    expect(exportFilename("", "daily", "2026-01-01", "2026-01-02")).toBe(
      "page-daily-2026-01-01-to-2026-01-02.csv",
    );
    expect(exportFilename("MARA", "daily", "2026-01-01", "2026-01-02")).toMatch(/^mara-/);
  });

  it("M9-26 kind is exactly daily or links, else null", () => {
    expect(EXPORT_KINDS).toEqual(["daily", "links"]);
    expect(parseKind("daily")).toBe("daily");
    expect(parseKind("links")).toBe("links");
    expect(parseKind(["links", "daily"])).toBe("links");
    for (const bad of ["", "DAILY", "daily ", "all", "../links", "daily,links", null, undefined]) {
      expect(parseKind(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it("M9-26 the hrefs follow the range", () => {
    expect(exportHref("daily", 30)).toBe("/analytics/export?kind=daily&range=30");
    expect(exportHref("links", 7)).toBe("/analytics/export?kind=links&range=7");
    expect(exportHref("daily", 365)).toBe("/analytics/export?kind=daily&range=365");
    expect(exportHref("links", 30, "home")).toBe("/analytics/export?kind=links&range=30&filter=home");
  });

  it("M9-26 twenty exports a minute", () => {
    expect([EXPORT_RATE_LIMIT, EXPORT_RATE_WINDOW_SECONDS]).toEqual([20, 60]);
  });
});
