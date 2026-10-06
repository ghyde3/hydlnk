import type { ReactNode } from "react";

/** A guide's body: its sections ([id, title], in order) and the prose itself. */
export interface GuideBody {
  toc: readonly (readonly [string, string])[];
  content: ReactNode;
}
