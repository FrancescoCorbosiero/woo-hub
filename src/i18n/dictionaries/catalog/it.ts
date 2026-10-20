import { actIt } from "./act.it";
import { homeIt } from "./home.it";
import { marginsIt } from "./margins.it";
import { pickerIt } from "./picker.it";
import { opsIt } from "./ops.it";
import { rulesIt } from "./rules.it";
import { sectionsIt } from "./sections.it";
import { sheetIt } from "./sheet.it";
import { sourcesIt } from "./sources.it";
import { termIt } from "./term.it";

/**
 * The Vetrina catalog's strings, one file per part of the app so each can grow
 * on its own: the catalog's home (lists, search), a category's or a brand's
 * screen, the product sheet's additions, acting on products (selection,
 * the action sheets, progress and "Annulla"), the new automatic category,
 * and what the server says of an action (ops: its label, a preview's
 * reasons and warnings, a refusal — picked in the request's language).
 */
export const catalogIt = {
  home: homeIt,
  term: termIt,
  sheet: sheetIt,
  act: actIt,
  rules: rulesIt,
  ops: opsIt,
  margins: marginsIt,
  sources: sourcesIt,
  sections: sectionsIt,
  picker: pickerIt,
};
