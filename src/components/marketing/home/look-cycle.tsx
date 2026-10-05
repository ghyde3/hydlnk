"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The CSS animation that fills the active tab's bar (home.css); its end advances the look. */
const FILL_ANIMATION = "sp-look-fill";

/** Fired on the hero after the cycle checks the next look (setting `checked` fires no change). */
const ADVANCED = "sp-look-advanced";

type Mode = "off" | "playing" | "paused";

/**
 * The hero's auto-advance and its pause control (WCAG 2.2.2). The looks advance on their own: the
 * checked tab's bar fills left to right over about six seconds (a CSS animation), and when it ends
 * the next look is checked. Because the bar is the clock, every pause simply freezes it.
 *
 * It pauses while the pointer is over the hero, while anything in it has focus (typing in the claim
 * field included), while the hero is mostly off screen and while the tab is hidden. The visitor's
 * own pick (click, tap or arrow keys fire a real change event; the advance sets `checked`, which
 * fires none) stops it for good; the control then offers Play. Under reduced motion it never
 * starts and the control stays hidden, and without JavaScript the control is never shown, so the
 * tabs are plain radio buttons and nothing moves.
 */
export function LookCycle() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<Mode>("off");
  const toggleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const button = buttonRef.current;
    const hero = button?.closest<HTMLElement>(".sp-hero");
    if (!button || !hero) return;
    const inputs = [...hero.querySelectorAll<HTMLInputElement>('input[name="sp-look"]')];
    if (inputs.length < 2) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let stopped = false;
    let userPaused = false;
    let hovered = false;
    let focused = false;
    let offscreen = false;

    const apply = () => {
      if (reduced || stopped) {
        // Off for good (reduced motion) or until Play: the checked tab's bar shows full and still.
        delete hero.dataset.cycle;
        delete hero.dataset.held;
        setMode(reduced ? "off" : "paused");
        return;
      }
      // Paused by the control, the bar freezes where it is and Play continues from there.
      const held = userPaused || hovered || focused || offscreen || document.hidden;
      hero.dataset.cycle = "on";
      if (held) hero.dataset.held = "";
      else delete hero.dataset.held;
      setMode(userPaused ? "paused" : "playing");
    };

    toggleRef.current = () => {
      if (stopped || userPaused) {
        stopped = false;
        userPaused = false;
      } else {
        userPaused = true;
      }
      apply();
    };

    const onEnd = (event: AnimationEvent) => {
      if (event.animationName !== FILL_ANIMATION || !hero.dataset.cycle) return;
      const at = inputs.findIndex((input) => input.checked);
      const next = inputs[(at + 1) % inputs.length];
      if (!next) return;
      next.checked = true;
      hero.dispatchEvent(new Event(ADVANCED));
    };
    const onChange = (event: Event) => {
      const target = event.target;
      if (!event.isTrusted || !(target instanceof HTMLInputElement)) return;
      if (target.name !== "sp-look") return;
      stopped = true;
      apply();
    };
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      hovered = true;
      apply();
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      hovered = false;
      apply();
    };
    const onFocus = () => {
      focused = hero.contains(document.activeElement);
      apply();
    };
    const onBlur = (event: FocusEvent) => {
      const next = event.relatedTarget;
      focused = next instanceof Node && hero.contains(next);
      apply();
    };
    const onMotion = () => {
      reduced = motion.matches;
      apply();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        offscreen = entry.intersectionRatio < 0.35;
        apply();
      },
      { threshold: [0, 0.35, 0.7] },
    );
    observer.observe(hero);

    hero.addEventListener("animationend", onEnd);
    hero.addEventListener("change", onChange);
    hero.addEventListener("pointerenter", onEnter);
    hero.addEventListener("pointerleave", onLeave);
    hero.addEventListener("focusin", onFocus);
    hero.addEventListener("focusout", onBlur);
    document.addEventListener("visibilitychange", apply);
    motion.addEventListener("change", onMotion);
    apply();

    return () => {
      observer.disconnect();
      hero.removeEventListener("animationend", onEnd);
      hero.removeEventListener("change", onChange);
      hero.removeEventListener("pointerenter", onEnter);
      hero.removeEventListener("pointerleave", onLeave);
      hero.removeEventListener("focusin", onFocus);
      hero.removeEventListener("focusout", onBlur);
      document.removeEventListener("visibilitychange", apply);
      motion.removeEventListener("change", onMotion);
      delete hero.dataset.cycle;
      delete hero.dataset.held;
    };
  }, []);

  // "playing" means the cycle is on, even while a hover or focus holds it: the control says what
  // pressing it does.
  const willPause = mode === "playing";

  return (
    <button
      ref={buttonRef}
      type="button"
      className="sp-cycle"
      hidden={mode === "off"}
      onClick={() => toggleRef.current()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="sp-cycle-icon">
        {willPause ? <path d="M5 3.5v9M11 3.5v9" /> : <path d="M5 3.2v9.6L12.5 8z" />}
      </svg>
      <span>
        {willPause ? "Pause" : "Play"}
        <span className="sr-only"> the looks</span>
      </span>
    </button>
  );
}

/**
 * The hero phone as one image with a name that says it is a demo, for example "Demo page:
 * Fennmoor Ceramics in Ivory". The phone itself is hidden from assistive tech; this name follows
 * the checked look, whether the visitor picked it or the cycle advanced to it. Nothing visible.
 */
export function DemoPhoneName({
  labels,
  initial,
  className,
  children,
}: {
  labels: Readonly<Record<string, string>>;
  initial: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState(labels[initial] ?? "Demo page");

  useEffect(() => {
    const hero = ref.current?.closest<HTMLElement>(".sp-hero");
    if (!hero) return;
    const sync = () => {
      const checked = hero.querySelector<HTMLInputElement>('input[name="sp-look"]:checked');
      const next = checked ? labels[checked.value] : undefined;
      if (next) setLabel(next);
    };
    sync();
    hero.addEventListener("change", sync);
    hero.addEventListener(ADVANCED, sync);
    return () => {
      hero.removeEventListener("change", sync);
      hero.removeEventListener(ADVANCED, sync);
    };
  }, [labels]);

  return (
    <div ref={ref} role="img" aria-label={label} className={className}>
      {children}
    </div>
  );
}
