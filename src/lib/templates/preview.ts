import { emptyDraft, toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import type { TokenSet } from "@/lib/theme";
import type { Template } from "./catalog";
import { applyTemplate } from "./build";

/**
 * The page a template's card draws (M7-07): exactly what applying the template would give, with the
 * person's own profile (name, photo, every photo option, and the bio they wrote, or the template's
 * sample bio when theirs is empty), the template's blocks as `applyTemplate` builds them (fresh ids,
 * empty addresses, no images, so an embed or an image block shows the editor's dashed
 * placeholder), and the template's own theme tokens with no page-level overrides.
 *
 * It reads the profile only, never the page's blocks: a page with 50 blocks previews the template's
 * blocks, not its own. Pure: no network, no clock, no Supabase.
 */
export function templatePreviewDoc(
  profile: DraftDoc["profile"],
  template: Template,
  themeTokens: Partial<TokenSet> | null,
): PublishDoc {
  const draft: DraftDoc = { ...emptyDraft(""), profile };
  return toPublishForm(applyTemplate(draft, template, "template"), themeTokens);
}
