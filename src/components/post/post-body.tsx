import type { ReactElement } from "react";

/**
 * A post's Markdown body as React elements (Wave B, M16-04). No "use client" and no hooks: used in
 * the tenant route handlers and in the share page. Contract stub: Builder B writes it (plan 4.2).
 */
export function PostBody(props: {
  markdown: string;
  ownerId: string;
  embeds: "facade" | "inert";
}): ReactElement {
  void props;
  throw new Error("not built: B");
}
