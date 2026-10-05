import Link from "next/link";
import { guideHref } from "../site-map";
import { Container, H2 } from "../primitives";
import { ShowreelAlpha } from "../showreel-alpha";
import "./how-it-works.css";

const STEPS = [
  {
    time: "Takes seconds",
    title: "Claim your name",
    body: "Pick a handle and your page lives at you.hydlnk.com. Sign in with an email link or Google: there’s no password to remember.",
    href: guideHref("choosing-a-handle"),
    link: "Choosing a handle",
  },
  {
    time: "A few minutes",
    title: "Build it with blocks",
    body: "Add links, cards, images, video and music, social icons and grids, then drag them into order. Every change autosaves as a draft, next to a live phone preview.",
    href: guideHref("getting-started"),
    link: "Getting started",
  },
  {
    time: "A minute or two",
    title: "Style it, then publish",
    body: "Start from a theme, then change any color, font or shape. Nothing goes live until you press Publish, and on Pro you can use a domain you already own.",
    href: guideHref("designing-your-page"),
    link: "Designing your page",
  },
] as const;

/**
 * How it works: a full-bleed charcoal band painted like the showreel's own background, the
 * transparent reel centered on it with no box or edge, then the three steps underneath. On
 * phones the reel (4:5) runs edge to edge.
 */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="hiw border-b border-ink-line py-[clamp(56px,11vw,96px)] text-on-ink"
    >
      <div aria-hidden="true" className="hiw-grid" />
      <div aria-hidden="true" className="hiw-glow" />
      <div aria-hidden="true" className="hiw-vignette" />
      <Container className="relative">
        <div className="mx-auto max-w-[720px] text-center">
          <p className="font-mono text-xs tracking-[0.08em] text-on-ink-muted uppercase">
            How it works
          </p>
          <h2 id="how-title" className={`mt-3.5 ${H2}`}>
            From a name to a live page in minutes.
          </h2>
          <p className="mx-auto mt-4 max-w-[520px] text-[clamp(16px,4.2vw,18px)] leading-[1.6] text-on-ink-muted">
            No code and no templates to fight. Pick your blocks, pick a look, and publish when you
            like it.
          </p>
        </div>
        <ShowreelAlpha
          className="-mx-6 mt-[clamp(24px,4vw,40px)] hl:mx-auto hl:max-w-[1120px]"
          label="Video preview, no sound: a HYDLNK page gets claimed, built one block at a time, restyled with a few different themes, then shown on a custom domain with its analytics."
        />
        <ol className="mt-[clamp(32px,5vw,56px)] grid gap-8 min-[900px]:grid-cols-3 min-[900px]:gap-10">
          {STEPS.map((step) => (
            <li key={step.title} className="flex flex-col gap-3 border-t border-ink-line pt-5">
              <p className="font-mono text-xs tracking-[0.08em] text-on-ink-muted uppercase">
                {step.time}
              </p>
              <h3 className="text-lg font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="text-[15px] leading-[1.6] text-on-ink-muted">{step.body}</p>
              <Link
                href={step.href}
                className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-accent-on-ink underline decoration-ink-line underline-offset-4 hover:decoration-accent-on-ink"
              >
                {step.link}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
