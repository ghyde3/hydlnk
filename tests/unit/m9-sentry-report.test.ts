import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorReporter } from "@/lib/sentry/report";
import { ROOT } from "./support/module-graph";

/**
 * M9-10 `reportError(error)`: what global-error.tsx and the app's error boundaries call. It does
 * nothing unless the browser SDK was started, and it never reports an error that began on the
 * server (the server's onRequestError already did).
 */

afterEach(() => setErrorReporter(null));

describe("M9-10 reportError", () => {
  it("does nothing when Sentry was not initialised: no reporter, no throw", () => {
    expect(() => reportError(new Error("x"))).not.toThrow();
    expect(() => reportError(undefined)).not.toThrow();
    expect(() => reportError("a string")).not.toThrow();
  });

  it("passes an error that began in the browser to the reporter, once per call", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new Error("render failed");
    reportError(error);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith(error);
  });

  it("skips an error that carries Next.js's digest: it began on the server and was reported there", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    reportError(Object.assign(new Error("An error occurred in the Server Components render."), { digest: "218092220" }));
    expect(reporter).not.toHaveBeenCalled();
    // A digest that is not a string is not Next's: reported.
    reportError(Object.assign(new Error("x"), { digest: 42 }));
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("a reporter that throws never breaks the error page it was called from", () => {
    setErrorReporter(() => {
      throw new Error("the SDK failed");
    });
    expect(() => reportError(new Error("x"))).not.toThrow();
  });

  it("setErrorReporter(null) turns it off again", () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    setErrorReporter(null);
    reportError(new Error("x"));
    expect(reporter).not.toHaveBeenCalled();
  });
});

describe("M9-10 who calls it", () => {
  const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

  it("global-error.tsx and the two error boundaries of the app host call it from an effect, and draw what they drew", () => {
    for (const file of ["src/app/global-error.tsx", "src/app/(editor)/error.tsx", "src/app/(editor)/app/(screens)/error.tsx"]) {
      const source = read(file);
      expect(source, file).toMatch(/import \{ reportError \} from "@\/lib\/sentry\/report"/);
      expect(source, file).toMatch(/useEffect\(\(\) => reportError\(error\), \[error\]\)/);
    }
  });

  it("the shared panels and the marketing and share boundaries do not call it", () => {
    for (const file of ["src/components/error-panel.tsx", "src/components/error-page.tsx", "src/app/(marketing)/error.tsx", "src/app/(share)/error.tsx"]) {
      expect(read(file), file).not.toMatch(/reportError|lib\/sentry/);
    }
  });

  it("report.ts imports nothing: no Sentry package, no other module", () => {
    expect(read("src/lib/sentry/report.ts")).not.toMatch(/^import /m);
  });
});
