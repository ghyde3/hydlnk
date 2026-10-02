"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { prepareGoogleSignIn, signInWithGoogle } from "@/lib/auth/google-actions";
import {
  GOOGLE_FAILED_MESSAGE,
  GOOGLE_GSI_SCRIPT_URL,
  GOOGLE_UNAVAILABLE_MESSAGE,
  type GoogleSignInResult,
} from "@/lib/auth/google-shared";
import { clientEnv } from "@/lib/env/client";

/*
 * The part of Google Identity Services this file uses (https://accounts.google.com/gsi/client).
 * Kept local on purpose: it is a handful of calls, and no type package is installed for it.
 */
interface GsiCredentialResponse {
  credential?: string;
}
interface GsiId {
  initialize(config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    nonce: string;
    ux_mode: "popup";
    auto_select: false;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      logo_alignment: "center";
      width: number;
    },
  ): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

/** Google's limits for the button width (pixels). */
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
/** Wait this long after the last resize before drawing the button at its new width. */
const RESIZE_DEBOUNCE_MS = 150;

/** Draws Google's button into `box`, as wide as the box (within Google's limits). */
function drawButton(box: HTMLElement): void {
  window.google?.accounts?.id?.renderButton(box, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    logo_alignment: "center",
    width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, box.clientWidth))),
  });
}

interface GoogleButtonProps {
  className?: string;
  /** Not usable yet (the form has not hydrated). */
  disabled?: boolean;
  /**
   * /signup only: the handle being claimed. It is sent along with the token and judged again on the
   * server before anyone is signed in. Leave it out on /login.
   */
  handle?: string;
  /**
   * /signup only: the handle can't be used yet. Google's button is an iframe the page can't
   * intercept, so while this is set a transparent button covers it, the iframe is inert, and a press
   * calls `onBlockedPress` (the form moves focus to the handle field) instead of opening Google.
   */
  blocked?: boolean;
  onBlockedPress?: () => void;
  /** /signup only: the server refused the handle after Google answered; show its verdict. */
  onHandleRefused?: (refusal: Extract<GoogleSignInResult, { kind: "handle" }>) => void;
}

/**
 * "Sign in with Google" (M1-29, M1-30): Google's own button, drawn by Google Identity Services,
 * which returns an ID token that a Server Action turns into a Supabase session. Google's popup
 * names hydlnk.com, because the page - not Supabase - starts the sign-in.
 *
 * Hidden entirely when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set; email sign-in works alone then.
 *
 * Sequence: the page loads Google's script, asks the server for a nonce (`prepareGoogleSignIn`:
 * the browser only ever gets sha256 of it), initialises Google with that and draws the button.
 * A credential from Google goes to `signInWithGoogle`. Every attempt spends the nonce, so after a
 * failure the page asks for a new one and initialises Google again; until that is done the button
 * is inert. Two tabs on /login share one nonce cookie, so the older tab's first press can fail with
 * "expired"; it recovers by itself.
 *
 * The button is 40px tall: it is Google's, drawn inside Google's iframe, and Google's branding
 * rules don't allow resizing it. The box around it keeps the 48px row.
 */
export function GoogleButton(props: GoogleButtonProps) {
  const clientId = clientEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  return <GoogleSignIn clientId={clientId} {...props} />;
}

type Phase =
  | "loading" // script or first nonce not here yet: a disabled placeholder holds the space
  | "ready" // Google's button is drawn and live
  | "refreshing" // an attempt spent the nonce; a new one is on its way, the button is inert
  | "unavailable"; // script blocked or offline, or the server won't issue nonces

function GoogleSignIn({
  clientId,
  className = "",
  disabled = false,
  handle,
  blocked = false,
  onBlockedPress,
  onHandleRefused,
}: GoogleButtonProps & { clientId: string }) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && !!window.google?.accounts?.id,
  );
  const [phase, setPhase] = useState<Phase>("loading");
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google keeps the callback it was initialised with; an Effect Event always reads the current
  // handle and handlers instead of the ones from the render that initialised it.
  const onCredential = useEffectEvent(async (credential: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy(true);

    let result: GoogleSignInResult;
    try {
      result = await signInWithGoogle({ credential, handle });
    } catch {
      result = { kind: "error", message: GOOGLE_FAILED_MESSAGE };
    }

    if (result.kind === "ok") {
      // Signed in: the session cookies came with that response. Loading "/" lets the auth gate
      // route on (/claim or /editor); the placeholder stays up until this page is gone.
      router.replace("/");
      return;
    }
    inFlight.current = false;
    setBusy(false);
    if (result.kind === "handle") onHandleRefused?.(result);
    else setError(result.message);
    // The attempt spent the nonce: get a new one and initialise Google again.
    setPhase("refreshing");
    setEpoch((n) => n + 1);
  });

  // Get a nonce, initialise Google with its hash and draw the button. Runs when the script is
  // there, and again after every attempt (epoch).
  useEffect(() => {
    if (!scriptReady) return;
    let cancelled = false;
    void (async () => {
      let nonce: string | null = null;
      try {
        const issued = await prepareGoogleSignIn();
        if (issued.ok) nonce = issued.nonce;
      } catch {
        // Offline or the server failed: the unavailable note below says so.
      }
      if (cancelled) return;
      const gsi = window.google?.accounts?.id;
      const box = boxRef.current;
      if (!nonce || !gsi || !box) {
        setPhase("unavailable");
        return;
      }
      gsi.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) void onCredential(response.credential);
        },
        nonce,
        ux_mode: "popup",
        auto_select: false,
      });
      drawButton(box);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [scriptReady, epoch, clientId]);

  // The box changes width with the viewport (phone rotation, a resized window); Google's button
  // has a fixed pixel width, so it is drawn again at the new width.
  useEffect(() => {
    const box = boxRef.current;
    if (phase !== "ready" || !box) return;
    let drawnAt = box.clientWidth;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (Math.abs(box.clientWidth - drawnAt) < 1) return;
        drawnAt = box.clientWidth;
        drawButton(box);
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(box);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [phase, epoch]);

  const covered = disabled || blocked;
  const inert = covered || busy || phase !== "ready";

  return (
    <div className={className}>
      <Script
        src={GOOGLE_GSI_SCRIPT_URL}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setPhase("unavailable")}
      />
      {phase === "unavailable" ? (
        <p role="status" className="text-[13px] leading-normal text-text-2">
          {GOOGLE_UNAVAILABLE_MESSAGE}
        </p>
      ) : (
        <div className="relative min-h-12">
          {phase === "loading" ? (
            <button
              type="button"
              disabled
              className="flex min-h-12 w-full items-center justify-center rounded-md border border-line-3 bg-surface px-4 text-[15px] font-semibold text-ink opacity-70"
            >
              Continue with Google
            </button>
          ) : null}
          {/* Google draws into this box; React never puts children in it. */}
          <div
            ref={boxRef}
            inert={inert}
            className={`flex w-full items-center justify-center ${
              phase === "loading" ? "h-0 overflow-hidden" : "min-h-12"
            } ${covered ? "opacity-60" : ""}`}
          />
          {covered && phase !== "loading" ? (
            <button
              type="button"
              aria-disabled="true"
              aria-label="Continue with Google"
              onClick={() => {
                if (!disabled) onBlockedPress?.();
              }}
              className="absolute inset-0 z-10 cursor-pointer rounded-md bg-transparent"
            />
          ) : null}
          {busy ? (
            <div
              role="status"
              className="absolute inset-0 z-20 flex items-center justify-center rounded-md bg-surface/90 text-[15px] font-semibold text-text-2"
            >
              Signing in…
            </div>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-normal text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The 'or' rule between the email button and the Google button. It only exists to separate the
 * two, so it disappears with the Google button (no client id).
 */
export function OrDivider() {
  if (!clientEnv.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;
  return (
    <div className="flex items-center gap-3 text-[13px] text-text-3" role="separator">
      <span className="block h-px flex-auto bg-line" />
      or
      <span className="block h-px flex-auto bg-line" />
    </div>
  );
}
