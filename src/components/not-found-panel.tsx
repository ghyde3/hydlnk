import Link from "next/link";
/** Body of the 404 pages on the marketing site and the app host. */
export function NotFoundPanel() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start justify-center gap-4 px-4 py-16 hl:px-6">
      <p className="font-mono text-xs tracking-[0.08em] text-text-2 uppercase">404</p>
      <h1 className="text-[clamp(28px,6vw,40px)] leading-[1.12] font-bold tracking-[-0.025em]">
        That page doesn’t exist
      </h1>
      <p className="max-w-[520px] text-base leading-relaxed text-text-2">
        The link may be old or mistyped. Check the address, or head back to the start.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-11 items-center rounded-md bg-ink px-[18px] text-sm font-semibold text-surface"
      >
        Go to the start
      </Link>
    </main>
  );
}
