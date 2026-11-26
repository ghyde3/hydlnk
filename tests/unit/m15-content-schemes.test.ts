// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { unsafeBodySchemes } from "@/lib/content/blocklist";
import { CONTENT_MESSAGES, CONTENT_STATUS, mapDbError } from "@/lib/content/errors";

vi.mock("server-only", () => ({}));

const refused = (body: string) => unsafeBodySchemes({ body });

describe("unsafe link schemes in a post body", () => {
  it("allows http, https, mailto, tel and relative links", () => {
    const body =
      "[a](http://a.example) [b](https://b.example/p) [c](mailto:x@y.example) [d](tel:+15550100) [e](/about) ![i](https://i.example/i.png)";
    expect(refused(body)).toBeNull();
    expect(unsafeBodySchemes({})).toBeNull();
    expect(unsafeBodySchemes(null)).toBeNull();
  });

  it.each([
    ["a link", "[x](javascript:alert(1))", "javascript:alert(1)"],
    ["an image", "![x](data:text/html;base64,AAAA)", "data:text/html;base64,AAAA"],
    ["vbscript", "[x](vbscript:msgbox(1))", "vbscript:msgbox(1)"],
    ["upper case", "[x](JaVaScRiPt:alert(1))", "javascript:alert(1)"],
    ["a table cell", "| h |\n| - |\n| [x](javascript:alert(2)) |", "javascript:alert(2)"],
    ["raw html", '<a href="javascript:alert(3)">x</a>', "javascript:alert(3)"],
    ["raw html image", "<img src='data:image/svg+xml,x'>", "data:image/svg+xml,x"],
    [
      "a character reference",
      '<a href="java&#115;cript&colon;alert(4)">x</a>',
      "javascript:alert(4)",
    ],
    ["a tab inside the scheme", '<a href="jav&#x09;ascript:alert(5)">x</a>', "javascript:alert(5)"],
  ])("refuses %s", (_name, body, offending) => {
    const out = refused(body);
    expect(out).toMatchObject({ ok: false, error: "invalid", status: 422 });
    const issues = out?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe("body");
    expect(issues[0]?.message).toContain(offending);
  });

  it.each([
    ["&Tab; in the scheme", "[x](java&Tab;script:alert(1))"],
    ["&NewLine; in the scheme", "[x](java&NewLine;script:alert(1))"],
    ["a reference definition", "[x][a]\n\n[a]: java&Tab;script:alert(1)"],
    ["a raw anchor", '<a href="java&Tab;script:alert(1)">x</a>'],
    ["an unknown reference in the scheme", "[x](java&bogus;script:alert(1))"],
    ["leading control characters", '<a href="\u0001 javascript:alert(1)">x</a>'],
    ["a colon before any slash in a relative-looking address", "[x](foo:bar)"],
  ])("fails closed on %s", (_name, body) => {
    expect(refused(body)).toMatchObject({ ok: false, error: "invalid", status: 422 });
  });

  it("still allows relative references and a colon after the first slash, query or fragment", () => {
    const body =
      "[a](/a:b) [b](a/b:c) [c](?q=a:b) [d](#x:y) [e](page.html) [f](https://x.example/?a=1&b=2) [g](mailto:a@b.example)";
    expect(refused(body)).toBeNull();
  });

  it("reports each distinct offender, at most ten, and cuts a long one", () => {
    const many = Array.from({ length: 15 }, (_, i) => `[x](javascript:a${i})`).join(" ");
    expect(refused(many)?.issues).toHaveLength(10);
    const long = refused(`[x](javascript:${"a".repeat(500)})`);
    expect(long?.issues?.[0]?.message.length).toBeLessThan(300);
  });
});

describe("a reserved slug", () => {
  it("has its own code, status and message", () => {
    expect(CONTENT_STATUS.slug_reserved).toBe(409);
    expect(CONTENT_MESSAGES.slug_reserved).toBe("That address is reserved. Try another.");
    expect(CONTENT_MESSAGES.slug_taken).not.toBe(CONTENT_MESSAGES.slug_reserved);
  });
  it("maps the HL012 slug messages", () => {
    const code = "HL012";
    expect(mapDbError({ code, message: 'slug "admin" is reserved' }).error).toBe("slug_reserved");
    expect(mapDbError({ code, message: 'slug "hello" is already used' }).error).toBe("slug_taken");
    expect(mapDbError({ code, message: 'path "/x" is reserved' }).error).toBe("path_taken");
    expect(mapDbError({ code, message: 'path "/x" is already used on this site' }).error).toBe(
      "path_taken",
    );
    expect(mapDbError({ code, message: "x" }).error).toBe("path_taken");
  });
});
