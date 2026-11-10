/**
 * When something happened, or happens next, as the owner says it: "oggi alle
 * 10:20", "ieri alle 04:30", "domani alle 04:30", "8 nov alle 04:30" — in the
 * shop's time zone, counted from `now` (the server's, when the screen was
 * read: the server's render and the phone's then say the same).
 */

export interface WhenWords {
  today: (time: string) => string;
  yesterday: (time: string) => string;
  tomorrow: (time: string) => string;
  onDay: (day: string, time: string) => string;
}

const DAY = 24 * 60 * 60 * 1000;

export function whenText(at: number, now: number, timeZone: string, locale: string, words: WhenWords): string {
  const tag = locale === "en" ? "en-GB" : "it-IT";
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat(tag, { timeZone, hour: "2-digit", minute: "2-digit" }).format(at);
  const day = dayOf.format(at);
  if (day === dayOf.format(now)) return words.today(time);
  if (day === dayOf.format(now - DAY)) return words.yesterday(time);
  if (day === dayOf.format(now + DAY)) return words.tomorrow(time);
  return words.onDay(new Intl.DateTimeFormat(tag, { timeZone, day: "numeric", month: "short" }).format(at), time);
}
