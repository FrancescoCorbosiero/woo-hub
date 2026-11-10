import { redirect } from "next/navigation";

/**
 * The orders are the owner's daily work, and live in the Vetrina now
 * (Negozio › Ordini, on the phone): the same workflow, the same words. This
 * address — the dock's "Ordini" station, old bookmarks — leads there.
 */
export default function OrdersPage() {
  redirect("/vetrina/negozio/ordini");
}
