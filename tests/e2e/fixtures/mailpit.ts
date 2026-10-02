/** Local Supabase inbox (Mailpit, address from `supabase status`). */
export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export interface InboxMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

export interface FullMessage extends InboxMessage {
  HTML: string;
  Text: string;
}

export async function messagesTo(address: string): Promise<InboxMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages?: InboxMessage[] };
  // The search is a substring match; keep exact recipients only.
  return (body.messages ?? []).filter((m) =>
    m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()),
  );
}

export async function getMessage(id: string): Promise<FullMessage> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message ${id} failed: ${res.status}`);
  return (await res.json()) as FullMessage;
}

/** Polls until at least `count` messages to `address` exist (default 1), up to `timeoutMs`. */
export async function waitForMessages(
  address: string,
  count = 1,
  timeoutMs = 10_000,
): Promise<InboxMessage[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await messagesTo(address);
    if (found.length >= count || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The sign-in link (callback URL) in the newest message to `address`. Waits for it to arrive. */
export async function signInLinkFor(address: string, timeoutMs = 10_000): Promise<string> {
  const [newest] = (await waitForMessages(address, 1, timeoutMs)).sort((a, b) =>
    b.Created.localeCompare(a.Created),
  );
  if (!newest) throw new Error(`no email arrived for ${address}`);
  const { Text, HTML } = await getMessage(newest.ID);
  const found =
    /http:\/\/app\.localhost:3000\/auth\/callback\?[^\s)"<]+/.exec(Text)?.[0] ??
    /http:\/\/app\.localhost:3000\/auth\/callback\?[^"<]+/.exec(HTML)?.[0];
  if (!found) throw new Error(`no sign-in link in the email to ${address}`);
  return found.replaceAll("&amp;", "&");
}

/** The sign-in link inside an emailed message's HTML. */
export function signInLinkFrom(html: string): string {
  const match = /href="([^"]*\/auth\/callback\?[^"]*)"/.exec(html);
  if (!match) throw new Error("no sign-in link in the message");
  return match[1]!.replaceAll("&amp;", "&");
}
