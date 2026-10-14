import { isListed } from "@/lib/vetrina/catalog";
import type { RailSummary } from "@/lib/vetrina/types";

/**
 * Of what a section shows, the products a customer cannot buy, would not
 * find in the shop, or sees without a photo: "2 esauriti · 1 nascosto dal
 * negozio · 1 senza foto". Empty when none. Only what the section shows
 * counts: its first `limit` products, the ones still in the shop. Pure, so
 * the homepage card's line is tested (rail-health.test.ts): demo mode
 * cannot show it.
 */
export function railHealth(
  rail: Pick<RailSummary, "products" | "limit">,
  words: { soldOut: (n: number) => string; hidden: (n: number) => string; noPhoto: (n: number) => string },
): string {
  const shown = rail.products.slice(0, rail.limit).filter((p) => !p.missing);
  const soldOut = shown.filter((p) => p.stockStatus === "outofstock").length;
  const unlisted = shown.filter((p) => !isListed(p.visibility)).length;
  const noPhoto = shown.filter((p) => !p.image).length;
  return [
    soldOut > 0 ? words.soldOut(soldOut) : "",
    unlisted > 0 ? words.hidden(unlisted) : "",
    noPhoto > 0 ? words.noPhoto(noPhoto) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
