/**
 * The store buttons of the book and app blocks (M9-20, M9-21): which stores exist, what they are
 * called and the messages Publish gives. The stores are labels, not host rules: no store has a host
 * allowlist (the same decision as the social platforms), so a book can link to any shop that sells
 * it, and the link blocklist is the one check on the address. Plain data, no React, so the editor,
 * the renderer and the analytics labels read the same words.
 *
 * Every lookup is a `Map` read, never a property read on an object, so a store name that is not in
 * a table (`__proto__`, `constructor`, anything a document might hold) has no label and no mark.
 */

/** The book block's stores, in the order of the store select. */
export const BOOK_STORES = ["amazon", "apple", "bookshop"] as const;
export type BookStore = (typeof BOOK_STORES)[number];

const BOOK_STORE_LABEL_ENTRIES: readonly (readonly [BookStore, string])[] = [
  ["amazon", "Amazon"],
  ["apple", "Apple Books"],
  ["bookshop", "Bookshop.org"],
];
const BOOK_LABELS: ReadonlyMap<string, string> = new Map(BOOK_STORE_LABEL_ENTRIES);

/** The words on a book store button, and in the editor's store select. */
export const BOOK_STORE_LABELS: Readonly<Record<BookStore, string>> = Object.freeze(
  Object.fromEntries(BOOK_STORE_LABEL_ENTRIES) as Record<BookStore, string>,
);

/** The app block's stores, in the order of the store select. */
export const APP_STORES = ["appstore", "googleplay"] as const;
export type AppStore = (typeof APP_STORES)[number];

const APP_STORE_LABEL_ENTRIES: readonly (readonly [AppStore, string])[] = [
  ["appstore", "App Store"],
  ["googleplay", "Google Play"],
];
const APP_LABELS: ReadonlyMap<string, string> = new Map(APP_STORE_LABEL_ENTRIES);

/** The store's name: the editor's select and 'Clicks by link'. */
export const APP_STORE_LABELS: Readonly<Record<AppStore, string>> = Object.freeze(
  Object.fromEntries(APP_STORE_LABEL_ENTRIES) as Record<AppStore, string>,
);

/**
 * What a badge says, from a fixed table and never from the document: two lines of text (the small
 * line, then the store's name) and the accessible name of the anchor.
 */
const APP_BADGE_ENTRIES: readonly (readonly [AppStore, AppBadgeWords])[] = [
  ["appstore", { small: "Download on the", name: "App Store", label: "Download on the App Store" }],
  ["googleplay", { small: "GET IT ON", name: "Google Play", label: "Get it on Google Play" }],
];
export interface AppBadgeWords {
  small: string;
  name: string;
  label: string;
}
const APP_BADGES: ReadonlyMap<string, AppBadgeWords> = new Map(APP_BADGE_ENTRIES);

export const isBookStore = (value: unknown): value is BookStore =>
  typeof value === "string" && BOOK_LABELS.has(value);
export const isAppStore = (value: unknown): value is AppStore =>
  typeof value === "string" && APP_LABELS.has(value);

/** 'Amazon', 'Apple Books' or 'Bookshop.org'; null for a store this version does not know. */
export const bookStoreLabel = (value: unknown): string | null =>
  typeof value === "string" ? (BOOK_LABELS.get(value) ?? null) : null;

/** 'App Store' or 'Google Play'; null for a store this version does not know. */
export const appStoreLabel = (value: unknown): string | null =>
  typeof value === "string" ? (APP_LABELS.get(value) ?? null) : null;

/** The words of an app badge; null for a store this version does not know. */
export const appBadgeWords = (value: unknown): AppBadgeWords | null =>
  typeof value === "string" ? (APP_BADGES.get(value) ?? null) : null;

export const BOOK_STORE_MESSAGE = "Pick Amazon, Apple Books or Bookshop.org.";
export const APP_STORE_MESSAGE = "Pick App Store or Google Play.";
export const STORE_MISSING_MESSAGE = "Add at least one store link.";
export const STORE_DUPLICATE_MESSAGE = "Each store can be added once.";
export const bookStoresLimitMessage = (max: number) => `You can add up to ${max} stores.`;
export const appStoresLimitMessage = bookStoresLimitMessage;
