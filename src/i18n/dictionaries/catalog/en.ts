import type { catalogIt } from "./it";
import { homeEn } from "./home.en";
import { sheetEn } from "./sheet.en";
import { termEn } from "./term.en";

export const catalogEn: typeof catalogIt = {
  home: homeEn,
  term: termEn,
  sheet: sheetEn,
};
