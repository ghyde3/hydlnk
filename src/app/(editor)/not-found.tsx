import { AppShellFrame } from "@/components/app/app-shell-frame";
import { AppNotFoundInShell, AppNotFoundPlain } from "@/components/app-not-found";
import { getAppContextIfSignedIn } from "@/lib/pages/maybe-context";

/**
 * The app host's 404 (M5-20): "That page doesn’t exist." with a link to the Editor, inside the app
 * shell when the visitor is signed in, a plain HYDLNK page when they are not. It is also what a
 * signed-in non-admin gets for every admin path (M5-04), so those paths look like any unknown one.
 */
export default async function EditorNotFound() {
  const context = await getAppContextIfSignedIn();
  if (!context) return <AppNotFoundPlain />;
  return (
    <AppShellFrame context={context}>
      <AppNotFoundInShell />
    </AppShellFrame>
  );
}
