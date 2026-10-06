"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The sentence a disabled control carries (a tooltip or helper text) while the account is suspended. */
export const SUSPENDED_REASON = "Your account is suspended.";

/** Said where an autosave cannot store a change because the database refuses a suspended owner. */
export const SUSPENDED_SAVE_MESSAGE = "Your account is suspended, so changes aren’t saved.";

const SuspensionContext = createContext(false);

/**
 * Whether the signed-in account is suspended (M5-09), provided once by the app shell so any client
 * component can disable what a suspended owner may not do (Publish, Upload photo, New page, Add
 * domain). It only shapes the UI: the database and the server routes refuse the writes regardless.
 */
export function SuspensionProvider({
  suspended,
  children,
}: {
  suspended: boolean;
  children: ReactNode;
}) {
  return <SuspensionContext.Provider value={suspended}>{children}</SuspensionContext.Provider>;
}

export function useAccountSuspended(): boolean {
  return useContext(SuspensionContext);
}
