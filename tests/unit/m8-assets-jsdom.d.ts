/**
 * The few parts of jsdom's own API the M8 asset tests use. jsdom ships no types and there is no
 * @types/jsdom in the project; the tests that need a page of their own (a hostname, a referrer, a
 * `readyState`, a script run the way a deferred tag runs it) build a JSDOM directly.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(
      html?: string,
      options?: {
        url?: string;
        referrer?: string;
        runScripts?: "dangerously" | "outside-only";
        pretendToBeVisual?: boolean;
      },
    );
    window: Window & typeof globalThis;
  }
}

/** The copy of path-to-regexp Next.js compiles its `headers()` sources with (no types ship with it). */
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(source: string): RegExp;
}
