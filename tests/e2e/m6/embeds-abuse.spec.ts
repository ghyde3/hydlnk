import { expect, test } from "@playwright/test";
import { adminClient } from "../fixtures/auth";
import { cleanupUsers } from "../fixtures/data";
import { abuseHomeBlocks } from "../fixtures/home-abuse";
import { url } from "../helpers";
import {
  CASES,
  accessToken,
  alertFor,
  draftWith,
  embedBlock,
  openEditor,
  pageRow,
  publishButton,
  rowOf,
  userWithBlocks,
} from "./embeds-helpers";

test.afterAll(cleanupUsers);

/**
 * M6-26 abuse case: ANY embed URL can end up in a draft. A browser write of Home's blocks is refused
 * (HL013, M15-14); a direct database write to the Home entry takes it. The draft takes it; Publish refuses it with the new sentence naming
 * the block, it never reaches `pages.published`, and the live page never renders an iframe for it.
 */

const SENTENCE =
  "Paste a link from YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music or Twitch.";
const EVIL = [
  "https://vimeo.com.evil.example/123456",
  "https://evil.example/x",
  'https://www.tiktok.com/@mara/video/1"onload="alert(1)',
  "javascript:alert(1)",
];

test.describe("M6-26 a hostile embed URL written straight to the draft", () => {
  for (const [index, evil] of EVIL.entries()) {
    test(`M6-26 ${evil.slice(0, 40)}: accepted as a draft, refused at Publish, never published, never rendered`, async ({
      page,
      context,
    }) => {
      const safe = embedBlock(CASES.find((c) => c.provider === "vimeo")!);
      const user = await userWithBlocks(context, `ema${index}`, [safe]);
      // The page is live with the safe block first, so "unchanged" has something to compare with.
      const { toPublishForm } = await import("@/lib/document");
      const draft = draftWith(user.handle, [safe]);
      const { error: seedError } = await adminClient()
        .from("pages")
        .update({ published: toPublishForm(draft, null), published_at: new Date().toISOString() })
        .eq("id", user.pageId);
      expect(seedError).toBeNull();
      const before = await pageRow(user.pageId);

      // The block is written as a draft: the owner's JWT is refused, the attacker's database write is taken.
      const token = await accessToken(context);
      const hostile = { ...embedBlock({ id: "emb-hostile-001", url: evil, caption: "Hostile" }) };
      // M15-14: the browser write is refused (HL013); the hostile block goes into Home's entry.
      await abuseHomeBlocks(token, user.pageId, [safe, hostile]);
      expect((await pageRow(user.pageId)).draft.blocks).toHaveLength(2);

      // Publish names the block and gives the sentence.
      await openEditor(page);
      await publishButton(page).click();
      const alert = alertFor(page, "Fix 1 block before publishing.");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("Hostile");
      await expect(alert).toContainText(SENTENCE);
      await expect(
        rowOf(page, "emb-hostile-001").getByText(SENTENCE, { exact: true }),
      ).toBeVisible();

      // Nothing reached `published`, and the live page shows the old page with no hostile iframe.
      const after = await pageRow(user.pageId);
      expect(after.published).toEqual(before.published);
      expect(after.published_at).toBe(before.published_at);
      const live = await page.request.get(url(user.handle));
      const html = await live.text();
      expect(html).not.toContain("evil.example");
      expect(html).not.toContain("onload=");
      expect(html).not.toContain("javascript:alert");
      expect(html).not.toContain("Hostile");
    });
  }
});
