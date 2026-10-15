/** A count as the owner reads it: "1.234" in Italian, "1,234" in English. The same on every catalog screen. */
export function formatCount(n: number, locale: string): string {
  return n.toLocaleString(locale === "en" ? "en-GB" : "it-IT");
}
