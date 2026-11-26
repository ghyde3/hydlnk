import type { ReactElement } from "react";
import type { PostView, TermView } from "@/lib/blog/types";

/**
 * A post as an article: title, date, featured image, terms and the body (Wave B, M16-04). The live
 * post page and the share preview draw the same component. Contract stub: Builder B writes it.
 */
export function PostArticle(props: {
  post: PostView;
  archivePath: string;
  terms: TermView[];
  ownerId: string;
  embeds: "facade" | "inert";
}): ReactElement {
  void props;
  throw new Error("not built: B");
}
