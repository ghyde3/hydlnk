import { getAppContext } from "@/lib/pages/context";
import { DeleteAccountDialogView } from "./delete-account-dialog-view";

/**
 * "Delete account" on Settings. A server wrapper around the modal: it reads the account's plan (the
 * per-request `getAppContext`, the same read the rest of the screen uses) so the modal can say
 * "Your Pro subscription will be canceled." for a paying account (M4-34). The plan comes from the
 * database for the verified session, never from the URL or a prop the page could get wrong.
 */
export async function DeleteAccountDialog({
  handle,
  addresses,
}: {
  handle: string;
  /** Every address the deletion removes, as shown to the user ("mara.hydlnk.com"). */
  addresses: string[];
}) {
  const { plan } = await getAppContext();
  return (
    <DeleteAccountDialogView
      handle={handle}
      addresses={addresses}
      subscription={plan === "pro" || plan === "studio" ? plan : null}
    />
  );
}
