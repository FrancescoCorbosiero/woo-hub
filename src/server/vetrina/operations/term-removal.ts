import "server-only";
import type { OperationInput } from "@/lib/vetrina/catalog-ops";
import { readIndexFacts } from "@/server/collections/repo";
import { storeClient, storeReady } from "@/server/collections/store";
import { VetrinaError } from "@/server/vetrina/source";
import type { Assessment } from "./preview";
import { childrenIn, descendantsIn, readTerms, removalRefusal, REST, termIn, tiesOf } from "./term-facts";
import { words } from "./words";

/**
 * A merge's or a deletion's preview (the run is the runner's: writes.ts,
 * runTermRemoval): the products it moves or lets go of, counted live from
 * the store; the sub-terms that go under the term merged into or up a
 * level; the products a deleted category leaves with no category at all;
 * the menus whose item would lead nowhere. Refused — said first — for a
 * term an automatic rule fills, one with a margin of its own, one the
 * homepage shows, a merge into itself or into a term below it, or into an
 * automatic category: thrown, in the owner's words.
 */
export async function assessTermRemoval(input: Extract<OperationInput, { kind: "termMerge" | "termDelete" }>): Promise<Assessment> {
  if (!storeReady()) throw new VetrinaError("not_configured", words().term.notConfigured);
  const w = words();
  const tx = input.taxonomy;
  const client = await storeClient();
  const list = await readTerms(client, tx);
  const term = termIn(list, input.termId, tx);
  const into = input.kind === "termMerge" ? termIn(list, input.into, tx) : null;

  let refusal: string | null = null;
  if (into && into.id === term.id) refusal = w.term.mergeSelf(tx);
  else if (into && descendantsIn(list, term.id).has(into.id)) refusal = w.term.mergeIntoBelow(into.name);
  const [ties, products, facts] = await Promise.all([
    tiesOf(tx, term.id),
    client.productIdsInTerm(REST[tx], term.id),
    // Which of them a deleted category leaves with no category: the index's copy is enough to say so.
    input.kind === "termDelete" && tx === "category" ? readIndexFacts().catch(() => []) : Promise.resolve([]),
  ]);
  refusal ??= removalRefusal(term.name, ties);
  if (!refusal && into && (await tiesOf(tx, into.id)).automatic) refusal = w.error.automatic(into.name);
  // Said as a refusal, not a preview: nothing would run, and the sheet's button and an API's dry run stop here.
  if (refusal) throw new VetrinaError("invalid", refusal, 400);

  const children = childrenIn(list, term.id).length;
  const count = products.length;
  const lines = into
    ? [
        w.term.merge(tx, term.name, into.name, count),
        ...(children > 0 ? [w.term.mergeChildren(tx, into.name, children)] : []),
        ...(tx !== "tag" ? [w.term.mergeAlias(term.name, into.name)] : []),
      ]
    : [w.term.delete(tx, term.name, count), ...(children > 0 ? [w.term.deleteChildren(tx, children)] : [])];

  const warnings: string[] = [];
  if (input.kind === "termDelete" && tx === "category") {
    const held = new Set(products);
    const orphans = facts.filter((f) => held.has(f.id) && f.categories.length === 1 && f.categories[0] === term.id).length;
    if (orphans > 0) warnings.push(w.term.orphans(orphans));
  }
  if (ties.menus && ties.menus.length > 0) warnings.push(w.term.inMenus(term.name, ties.menus));

  return {
    preview: { kind: input.kind, changes: count, untouched: [], sample: [], warnings, page: { lines } },
    label: { kind: input.kind, count, taxonomy: tx, term: term.name, into: into?.name ?? null },
    termKey: tx === "tag" ? null : `${tx}:${term.id}`,
    // The products, and the term itself.
    total: count + 1,
    refusal: null,
  };
}
