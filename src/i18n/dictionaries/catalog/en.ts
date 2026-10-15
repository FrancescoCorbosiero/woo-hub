import type { catalogIt } from "./it";
import { actEn } from "./act.en";
import { homeEn } from "./home.en";
import { marginsEn } from "./margins.en";
import { opsEn } from "./ops.en";
import { rulesEn } from "./rules.en";
import { sheetEn } from "./sheet.en";
import { termEn } from "./term.en";

export const catalogEn: typeof catalogIt = {
  home: homeEn,
  term: termEn,
  sheet: sheetEn,
  act: actEn,
  rules: rulesEn,
  ops: opsEn,
  margins: marginsEn,
};
