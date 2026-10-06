/** Shared class names of the Share tab's cards: HYDLNK UI tokens only, every control 44px tall. */
export const CARD = "flex flex-col gap-3.5 rounded-md border border-line bg-surface p-4";
export const CARD_TITLE = "text-sm font-semibold";

const BUTTON =
  "inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border px-4 text-sm font-semibold no-underline disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 hl:w-auto";
export const PRIMARY_BUTTON = `${BUTTON} border-ink bg-ink text-surface`;
export const SECONDARY_BUTTON = `${BUTTON} border-line-3 bg-surface text-ink`;
export const DANGER_BUTTON = `${BUTTON} border-bad-line bg-surface text-bad`;
