"use client";

import { Lock } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/app/icon";

/** Lowercase letters, digits and hyphens only: what the pill shows for whatever was typed. */
export function cleanHandle(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

interface BrandHandleValue {
  handle: string;
  setHandle: (raw: string) => void;
}

const BrandHandleContext = createContext<BrandHandleValue | null>(null);

/**
 * Shares the handle being typed with the brand panel's pill ("yourname.hydlnk.com"). AuthLayout
 * mounts the provider around the panel and the form column, so a form inside it can call
 * useBrandHandle().setHandle(value) on every keystroke and the pill follows.
 */
export function BrandHandleProvider({
  initialHandle = "",
  children,
}: {
  initialHandle?: string;
  children: ReactNode;
}) {
  const [handle, setHandle] = useState(cleanHandle(initialHandle));

  // Any text field named "handle" inside the layout (signup, claim) drives the pill while typing,
  // so those forms need no wiring of their own.
  useEffect(() => {
    const onInput = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.name === "handle")
        setHandle(cleanHandle(target.value));
    };
    document.addEventListener("input", onInput);
    return () => document.removeEventListener("input", onInput);
  }, []);

  const value = useMemo(
    () => ({ handle, setHandle: (raw: string) => setHandle(cleanHandle(raw)) }),
    [handle],
  );
  return <BrandHandleContext value={value}>{children}</BrandHandleContext>;
}

/** Outside an AuthLayout the setter is a no-op, so forms stay usable in isolation. */
export function useBrandHandle(): BrandHandleValue {
  return useContext(BrandHandleContext) ?? { handle: "", setHandle: () => {} };
}

/** The bordered pill in the brand panel: lock icon, handle in brass, suffix muted. */
export function BrandHandlePill() {
  const { handle } = useBrandHandle();
  return (
    <div className="mt-6 inline-flex max-w-full items-center gap-2.5 rounded-md border border-ink-line bg-ink-raised px-3.5 py-3">
      <Icon icon={Lock} size={15} className="text-on-ink-muted" />
      <span className="font-mono text-lg [overflow-wrap:anywhere]">
        <span className="text-ink-link">{handle || "yourname"}</span>
        <span className="text-on-ink-muted">.hydlnk.com</span>
      </span>
    </div>
  );
}
