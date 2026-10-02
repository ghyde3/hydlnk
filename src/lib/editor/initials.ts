/**
 * Initials of a display name: the first letter of the first and of the last word, upper case
 * ("Mara Okafor" -> "MO", "jean claude van damme" -> "JD", "Prince" -> "P", empty -> "?").
 * Counts code points, so an emoji is one letter. Same rule as the preview avatar.
 */
export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "?";
  const letter = (word: string) => Array.from(word)[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]! : "";
  return (letter(first) + letter(last)).toUpperCase();
}
