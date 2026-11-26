import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { PostEditor } from "@/components/posts/post-editor";
import { getAppContext } from "@/lib/pages/context";
import { loadPostEditor } from "../load";

export const metadata: Metadata = { title: "Edit post" };

/**
 * The post editor (M16-13): one post of the current site. The gate runs first. The post is read
 * through the content writer with the session user as the actor and must be a post of the site the
 * page switcher has selected: another account's post, a post of another of the user's sites, a page
 * entry and a malformed id are all the app's 404.
 */
export default async function PostPage({ params }: PageProps<"/app/posts/[entryId]">) {
  const { user, current } = await getAppContext();
  const { entryId } = await params;
  const data = await loadPostEditor(user.id, current.id, entryId);
  if (!data) notFound();
  return (
    <>
      <ScreenHeader breadcrumb={`${current.name} · Posts`} title="Edit post" />
      <ScreenBody maxWidth="max-w-[760px]">
        <PostEditor
          key={data.entry.id}
          siteId={current.id}
          // The site OWNER: body images are checked and drawn against their folder (D9, Wave F).
          ownerId={current.access.ownerId}
          archivePath={data.archivePath}
          entry={data.entry}
          terms={data.terms}
        />
      </ScreenBody>
    </>
  );
}
