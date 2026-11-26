import "server-only";

/**
 * The owner emails of the forms wave (M17-10, M17-02). Stub with the final signatures: filled in with
 * the message and limit emails later in the wave. Both never throw.
 */

export interface MessageNotice {
  ownerId: string;
  handle: string;
  formTitle: string;
  name: string;
  email: string;
  message: string;
}

export async function notifyOwnerOfMessage(
  input: MessageNotice,
): Promise<"sent" | "skipped" | "limited"> {
  void input;
  return "skipped";
}

export async function notifyOwnerOfLimit(input: { ownerId: string }): Promise<"sent" | "skipped"> {
  void input;
  return "skipped";
}
