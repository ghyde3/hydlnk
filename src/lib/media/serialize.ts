/**
 * Runs `task` after every earlier task with the same key has finished (M4-31). The upload route uses
 * the account id as the key, so one account's uploads on this server instance check the quota, store
 * and re-check one at a time: two simultaneous uploads that together would exceed the cap are never
 * both stored. A failed task does not block the ones behind it. Another server instance is covered
 * by the re-read after storing (see `storeWithinQuota` in ./upload).
 */
const chains = new Map<string, Promise<unknown>>();

export async function serializeUploads<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  try {
    return await run;
  } finally {
    if (chains.get(key) === tail) chains.delete(key);
  }
}
