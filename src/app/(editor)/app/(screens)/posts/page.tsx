import type { Metadata } from "next";
import { ScreenBody, ScreenHeader } from "@/components/app/screen";
import { PostsScreen } from "@/components/posts/posts-screen";
import { getAppContext } from "@/lib/pages/context";
import { loadPostsScreen } from "./load";

export const metadata: Metadata = { title: "Posts" };

/**
 * Posts (M16-12): the blog of the current site. It has no item of its own in the navigation (the
 * phone tab bar stays at four): the Pages panel's "Blog" row opens it, and it belongs to Editor.
 *
 * The gate runs first (`getAppContext` sends a signed-out request to sign-in). The site is the one
 * the page switcher has selected, among the user's own pages, and the loader reads it through the
 * content writer with the session user as the actor.
 */
export default async function PostsPage() {
  // The site OWNER's plan: a member works under its limits (C16).
  const { user, current, sitePlan: plan } = await getAppContext();
  const data = await loadPostsScreen(user.id, current.id);
  return (
    <>
      <ScreenHeader breadcrumb={`${current.name} · Blog`} title="Posts" />
      <ScreenBody>
        {/* Keyed by site: switching pages starts from that site's posts. */}
        <PostsScreen key={current.id} siteId={current.id} plan={plan} {...data} />
      </ScreenBody>
    </>
  );
}
