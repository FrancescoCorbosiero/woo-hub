/**
 * Acting on the catalog's products, as the screens use it. The pieces:
 *
 * - useProductSelection() → a ProductSelection, handed to ProductList
 *   (`selection` prop): "Seleziona" / long press, checkboxes, the action bar.
 * - SelectButton: "Seleziona" for a screen's own navbar.
 * - ActSheets (one state for all) or each sheet alone: SaleSheet,
 *   VisibilitySheet, TagSheet, CategorySheet, PinSheet — each previews, then
 *   starts the action through the tracker.
 * - useOperations(): start, undo ("Annulla", a term's "Mostra"), openActivity,
 *   the actions running now; useOperationSettled(): hear when one ends.
 * - ActivityLink: the navbar's way into "Attività".
 * - queryTarget(query): a list's query as a target ("Seleziona tutti", a
 *   whole term).
 *
 * OperationsProvider is mounted once, in the Vetrina's app shell.
 */
export { ActSheets, type ActRequest, type ActSheetKind } from "./ActSheets";
export { ActivityLink } from "./ActivityLink";
export { ActivitySheet } from "./ActivitySheet";
export { CategorySheet, type CategoryMode, type CategorySheetProps } from "./CategorySheet";
export { queryTarget, type PickedProduct } from "./model";
export { OperationsProvider } from "./operations";
export { useOperations, useOperationSettled, type Operations, type SettledListener } from "./operations-context";
export type { ActSheetProps } from "./parts";
export { PinSheet, type PinSheetProps } from "./PinSheet";
export { SaleSheet, type SaleMode, type SaleSheetProps } from "./SaleSheet";
export { SelectButton } from "./SelectButton";
export { SelectionBar } from "./SelectionBar";
export { useProductSelection, type ProductSelection } from "./selection";
export { TagSheet, type TagMode, type TagSheetProps } from "./TagSheet";
export { VisibilitySheet, type VisibilityMode, type VisibilitySheetProps } from "./VisibilitySheet";
