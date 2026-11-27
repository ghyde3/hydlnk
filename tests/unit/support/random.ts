/**
 * The one seeded generator of the Markdown fuzzers (xorshift32): uniform in [0, 1), the same
 * sequence for the same seed, and a period of 2^32 - 1, so a run of any length here draws distinct
 * samples. (The linear congruence `(seed * 1103515245 + 12345) & 0x7fffffff` the fuzzers used
 * before overflows 2^53 in a double, loses its low bits and cycles after 10,466 steps: 20,000
 * samples were 1,282 distinct bodies.) A seed of 0 is moved to 1 (xorshift stays at 0).
 */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** One element of `list`, drawn with `random`. */
export const pick = <T>(random: () => number, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)]!;
