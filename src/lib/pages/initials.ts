/** First two letters of the email's local part, upper case ("e2e-sh-1@example.com" -> "E2"). */
export function initialsOf(email: string): string {
  const local = email.split("@")[0] ?? "";
  const letters = Array.from(local.replace(/\s/g, "")).slice(0, 2).join("");
  return letters ? letters.toUpperCase() : "?";
}
