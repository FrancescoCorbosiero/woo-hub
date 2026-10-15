import type { CategoryOption } from "@/lib/collections/types";

/**
 * The store category a new one would collide with: same name, same parent.
 * Saving would not create a second one but turn that one automatic, and its
 * rule would then decide the products it already holds — so the sheet asks
 * for another name instead (an existing category is made automatic from its
 * own screen, where its products are in view).
 */
export function takenBy(categories: readonly CategoryOption[], name: string, parent: number): CategoryOption | undefined {
  const wanted = name.trim().toLocaleLowerCase("it");
  if (!wanted) return undefined;
  // Paths are the names from the top, joined by " › " (as the server builds them).
  const parentPath = parent ? categories.find((c) => c.id === parent)?.path : "";
  if (parentPath == null) return undefined;
  const path = (parentPath ? `${parentPath} › ${wanted}` : wanted).toLocaleLowerCase("it");
  return categories.find((c) => c.path.trim().toLocaleLowerCase("it") === path);
}
