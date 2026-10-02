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
