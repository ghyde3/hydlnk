import { expect, test } from "@playwright/test";
import { POST_TEST_IDS } from "@/lib/blog/test-ids";
import { cleanupUsers } from "../fixtures/data";
import { expectNoHorizontalScroll } from "../helpers";
import { openPost } from "../m16/posts-helpers";
import { addPost, enableBlog } from "../m16/public-helpers";
import { memberOf, signInMember, studioOwner } from "./team-helpers";

/**
 * R5, M19-10 step 4 at 390 and 1440: the post editor on a shared site. An editor reads "Ask the owner
 * or a publisher to publish." where Publish and Unpublish would be, gets no Schedule and no Move to
 * trash on a live post, and still edits the post; a publisher gets Publish, Unpublish, Schedule and
 * Move to trash.
 */
test.afterAll(cleanupUsers);

const SENTENCE = "Ask the owner or a publisher to publish.";

test("R5 an editor's post editor names who may publish; a publisher's has the controls", async ({ browser, context }) => {
  test.setTimeout(150_000);
  const owner = await studioOwner(context, "m19pr");
  const typeId = await enableBlog(owner.pageId);
  const live = await addPost(owner, typeId, { title: "Live post", slug: `live-${Date.now()}` });
  const editor = await memberOf(owner, "editor", "m19pr-ed");
  const publisher = await memberOf(owner, "publisher", "m19pr-pub");

  const editorContext = await browser.newContext();
  await signInMember(editorContext, editor);
  const page = await editorContext.newPage();
  await openPost(page, live.id);
  await expect(page.getByTestId("post-publish-forbidden")).toHaveText(SENTENCE);
  await expect(page.getByTestId(POST_TEST_IDS.publish)).toHaveCount(0);
  await expect(page.getByTestId(POST_TEST_IDS.unpublish)).toHaveCount(0);
  await expect(page.getByTestId("post-schedule")).toHaveCount(0);
  await expect(page.getByTestId(POST_TEST_IDS.trash)).toHaveCount(0);
  await expect(page.getByTestId("post-trash-forbidden")).toHaveText(SENTENCE);
  // Editing still works.
  await page.getByTestId("post-title").fill("Live post, edited");
  await expect(page.getByTestId(POST_TEST_IDS.saveState)).toHaveAttribute("data-save-state", "saved", { timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  await editorContext.close();

  const publisherContext = await browser.newContext();
  await signInMember(publisherContext, publisher);
  const pubPage = await publisherContext.newPage();
  await openPost(pubPage, live.id);
  await expect(pubPage.getByTestId("post-publish-forbidden")).toHaveCount(0);
  await expect(pubPage.getByTestId(POST_TEST_IDS.publish)).toBeVisible();
  await expect(pubPage.getByTestId(POST_TEST_IDS.unpublish)).toBeVisible();
  await expect(pubPage.getByTestId("post-schedule")).toBeVisible();
  await expect(pubPage.getByTestId(POST_TEST_IDS.trash)).toBeVisible();
  await publisherContext.close();
});
