/** Block, social-icon and grid-cell ids: 8-24 characters of A-Za-z0-9_- (nanoid's alphabet). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{8,24}$/;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ID_LENGTH = 12;

/**
 * A fresh id for a block, a social icon or a grid cell. 12 characters of a 64-character alphabet
 * (72 bits) from the Web Crypto API; 64 divides 256, so masking a byte has no modulo bias.
 * Ids are unique across the whole document and never change once assigned.
 */
export function newBlockId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte & 63];
  return id;
}

type IdHolder = Record<string, unknown> & { id: string };

/** The lists of a block whose entries each carry their own id (icons, cells, items, store links). */
const NESTED_ID_LISTS = ["icons", "cells", "items", "links"] as const;

/**
 * Every id a block uses: its own, each entry of a nested list, each text link mark and a map's two
 * button ids. Generic on purpose, so a new block type with nested ids is covered without a change.
 */
export function blockIdsOf(blocks: readonly { id: string }[]): string[] {
  const ids: string[] = [];
  for (const block of blocks as unknown as IdHolder[]) {
    ids.push(block.id);
    for (const key of NESTED_ID_LISTS) {
      const list = block[key];
      if (Array.isArray(list)) for (const entry of list as { id: string }[]) ids.push(entry.id);
    }
    if (Array.isArray(block.marks)) {
      for (const mark of block.marks as { type: string; id?: string }[]) {
        if (mark.type === "link" && mark.id) ids.push(mark.id);
      }
    }
    if (typeof block.googleId === "string") ids.push(block.googleId);
    if (typeof block.appleId === "string") ids.push(block.appleId);
  }
  return ids;
}

/** Gives a block (a deep copy the caller owns) a new id everywhere `blockIdsOf` finds one. */
export function freshenBlockIds<T extends { id: string }>(block: T, fresh: () => string): T {
  const copy = block as unknown as IdHolder;
  copy.id = fresh();
  for (const key of NESTED_ID_LISTS) {
    const list = copy[key];
    if (Array.isArray(list)) for (const entry of list as { id: string }[]) entry.id = fresh();
  }
  if (Array.isArray(copy.marks)) {
    for (const mark of copy.marks as { type: string; id?: string }[]) {
      if (mark.type === "link") mark.id = fresh();
    }
  }
  if (typeof copy.googleId === "string") copy.googleId = fresh();
  if (typeof copy.appleId === "string") copy.appleId = fresh();
  return block;
}
