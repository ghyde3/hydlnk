import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminDraftBar } from "@/components/admin/draft-bar";

const ID = "11111111-2222-4333-8444-555555555555";

describe("M13-11 the admin draft bar", () => {
  it("links each page by its encoded path under the draft route, and Home without one", () => {
    const html = renderToStaticMarkup(
      <AdminDraftBar
        handle="mara"
        accountId={ID}
        pageId={ID}
        current=""
        pages={[
          { path: "items", title: "Items" },
          { path: 'x"><script>', title: "Hostile" },
        ]}
      />,
    );
    expect(html).toContain(`href="/admin-draft/${ID}"`);
    expect(html).toContain(`href="/admin-draft/${ID}/items"`);
    // A tenant-controlled path can never add markup or another path segment.
    expect(html).toContain(`href="/admin-draft/${ID}/x%22%3E%3Cscript%3E"`);
    expect(html).not.toContain("<script>");
  });

  it("a path with a slash stays one segment", () => {
    const html = renderToStaticMarkup(
      <AdminDraftBar
        handle="m"
        accountId={ID}
        pageId={ID}
        current=""
        pages={[{ path: "a/../b", title: "T" }]}
      />,
    );
    expect(html).toContain(`/admin-draft/${ID}/a%2F..%2Fb"`);
  });
});
