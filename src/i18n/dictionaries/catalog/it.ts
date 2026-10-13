import { homeIt } from "./home.it";
import { sheetIt } from "./sheet.it";
import { termIt } from "./term.it";

/**
 * The Vetrina catalog's strings, one file per part of the app so each can grow
 * on its own: the catalog's home (lists, search), a category's or a brand's
 * screen, the product sheet's additions.
 */
export const catalogIt = {
  home: homeIt,
  term: termIt,
  sheet: sheetIt,
};
