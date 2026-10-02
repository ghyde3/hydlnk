/**
 * The avatar fallback: the first letter of the first and of the last word, uppercased.
 * "Mara Okafor" gives "MO", "Prince" gives "P", "jean claude van damme" gives "JD", and an empty
 * (or blank) name gives "?". Works on code points, so an emoji or a letter outside the BMP is
 * never cut in half.
 */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  const first = words[0];
  if (first === undefined) return "?";
  const last = words.length > 1 ? words[words.length - 1]! : "";
  const letter = (word: string) => Array.from(word)[0] ?? "";
  return (letter(first) + letter(last)).toUpperCase();
}
