// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audience",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/forms/audience-actions", () => ({
  deleteSubmission: vi.fn(),
  deleteFormSubmissions: vi.fn(),
}));

const { AudienceScreen } = await import("@/components/audience/audience-screen");
const { UsageCard } = await import("@/components/audience/usage-card");

/**
 * M17-08 step 3, the load-failure state, and the meter's notices (M17-02 step 5, review A1): the
 * screen with no data draws the failure card and nothing of the list; the usage card names what is
 * counted and the daily cap, and shows each cap's notice once something was refused.
 */
describe("M17-08 the Audience screen's states", () => {
  it("a load failure draws the failure card, as an alert, and no list, meter or export", () => {
    const html = renderToStaticMarkup(
      <AudienceScreen siteName="Mara" plan="free" form="all" data={null} />,
    );
    const page = new DOMParser().parseFromString(html, "text/html");
    const alert = page.querySelector('[data-testid="audience-load-error"]')!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe(
      "We couldn’t load your submissions. Reload the page to try again.",
    );
    for (const id of ["audience-list", "audience-meter", "audience-export", "audience-row"]) {
      expect(page.querySelector(`[data-testid="${id}"]`)).toBeNull();
    }
    expect(html).not.toContain("--t-");
  });

  it("the meter's line names what is counted and the daily cap; each cap's notice once something was refused", () => {
    const quiet = renderToStaticMarkup(
      <UsageCard
        plan="free"
        usage={{ stored: 3, refused: 0, refusedDaily: 0, notifySkippedToday: 0, limit: 100 }}
      />,
    );
    expect(quiet).toContain("3 / 100 this month");
    expect(quiet).toContain(
      "Counts what your forms hold from the 1st of the month (UTC). Deleting a submission frees its place. Each site takes up to 20 a day.",
    );
    expect(quiet).not.toContain('data-testid="audience-over-limit"');

    const daily = renderToStaticMarkup(
      <UsageCard
        plan="free"
        usage={{ stored: 20, refused: 0, refusedDaily: 3, notifySkippedToday: 0, limit: 100 }}
      />,
    );
    const notice = new DOMParser()
      .parseFromString(daily, "text/html")
      .querySelector('[data-testid="audience-over-limit"]')!;
    expect(notice.textContent).toBe(
      "A site reached its limit of 20 form submissions a day on Free. 3 were not saved this month. Delete what you don’t need to make room, or wait until tomorrow (UTC).",
    );

    const both = renderToStaticMarkup(
      <UsageCard
        plan="pro"
        usage={{ stored: 5000, refused: 2, refusedDaily: 1, notifySkippedToday: 0, limit: 5000 }}
      />,
    );
    const lines = [
      ...new DOMParser()
        .parseFromString(both, "text/html")
        .querySelectorAll('[data-testid="audience-over-limit"] p'),
    ].map((p) => p.textContent);
    expect(lines).toEqual([
      "You’ve reached this month’s limit of 5,000 form submissions on Pro. 2 were not saved. Upgrade to keep more, or wait until the 1st.",
      "A site reached its limit of 500 form submissions a day on Pro. 1 was not saved this month. Delete what you don’t need to make room, or wait until tomorrow (UTC).",
    ]);
  });

  it("a plain line once owner emails were skipped today by their hourly cap (finding 6); none otherwise", () => {
    const usage = { stored: 40, refused: 0, refusedDaily: 0, limit: 100 };
    const quiet = renderToStaticMarkup(
      <UsageCard plan="free" usage={{ ...usage, notifySkippedToday: 0 }} />,
    );
    expect(quiet).not.toContain('data-testid="audience-notify-skipped"');
    for (const [count, text] of [
      [
        1,
        "Today 1 message email was not sent: at most 30 go out an hour. Every message is saved here.",
      ],
      [
        12,
        "Today 12 message emails were not sent: at most 30 go out an hour. Every message is saved here.",
      ],
    ] as const) {
      const html = renderToStaticMarkup(
        <UsageCard plan="free" usage={{ ...usage, notifySkippedToday: count }} />,
      );
      const line = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector('[data-testid="audience-notify-skipped"]')!;
      expect(line.textContent).toBe(text);
      expect(line.getAttribute("role")).toBe("status");
      expect(html).not.toContain('data-testid="audience-over-limit"');
    }
  });
});
