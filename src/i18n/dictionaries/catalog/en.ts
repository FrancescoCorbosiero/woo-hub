import type { catalogIt } from "./it";
import { actEn } from "./act.en";
import { homeEn } from "./home.en";
import { marginsEn } from "./margins.en";
import { pickerEn } from "./picker.en";
import { opsEn } from "./ops.en";
import { originEn } from "./origin.en";
import { rulesEn } from "./rules.en";
import { sectionsEn } from "./sections.en";
import { sheetEn } from "./sheet.en";
import { sourcesEn } from "./sources.en";
import { termEn } from "./term.en";

export const catalogEn: typeof catalogIt = {
  home: homeEn,
  term: termEn,
  sheet: sheetEn,
  act: actEn,
  rules: rulesEn,
  ops: opsEn,
  origin: originEn,
  margins: marginsEn,
  sources: sourcesEn,
  sections: sectionsEn,
  picker: pickerEn,
};
