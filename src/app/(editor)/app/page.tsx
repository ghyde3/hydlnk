import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/gate";

/**
 * The app host's landing route. It renders nothing: signed out goes to /login, signed in without a
 * page to /claim, signed in with a page to /editor (see requireAppUser). No return-URL parameter.
 */
export default async function AppHome(): Promise<never> {
  await requireAppUser();
  redirect("/editor");
}
