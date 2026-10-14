import { describe, expect, it } from "vitest";
import { actEn } from "./act.en";
import { actIt } from "./act.it";
import { opsIt } from "./ops.it";
import { termEn } from "./term.en";
import { termIt } from "./term.it";

describe("the catalog's words agree with what they count, and name what they can", () => {
  it("a term with one product reads in the singular", () => {
    expect(termIt.panel.hiddenSince("14:05", 1)).toBe("Nascosto da te · 14:05. Riaccendilo e torna com'era.");
    expect(termIt.panel.hiddenSince("14:05", 3)).toBe("Nascosti da te · 14:05. Riaccendilo e tornano com'erano.");
    expect(termIt.panel.showing(1)).toBe("Lo rimetto com'era…");
    expect(termIt.panel.hiding(0, 1)).toBe("Lo nascondo… 0/1");
    expect(termEn.panel.showingAll(1, 1)).toBe("Showing it again… 1/1");
  });

  it("a product added to a section's category: «si vede» for one, «si vedono» for more", () => {
    expect(opsIt.warning.categoryAdded(1, "Saldi")).toBe("1 prodotto non è in «Saldi»: lo aggiungo, così si vede nella sezione.");
    expect(opsIt.warning.categoryAdded(2, "Saldi")).toBe("2 prodotti non sono in «Saldi»: li aggiungo, così si vedono nella sezione.");
  });

  it("«Mostra» names the hidden category or brand that keeps some products hidden", () => {
    expect(actIt.toast.held(2, ["Nike"])).toBe("2 restano nascosti: sono anche in «Nike», che hai nascosto");
    expect(actIt.toast.held(1, [])).toBe("1 resta nascosto: è anche in una categoria o un brand che hai nascosto");
    expect(actEn.toast.held(3, ["Nike", "Adidas", "Puma"])).toBe(
      "3 stay hidden: they are also in “Nike”, “Adidas” and 1 more, which you hid",
    );
  });

  it("the panel's and the list's short lines stay short enough for one line on a phone", () => {
    // The newcomers row's title: one line at 390px (about 30 characters of the row's 17px).
    for (const panel of [termIt.panel, termEn.panel]) {
      expect(panel.hideAdded(1).length).toBeLessThanOrEqual(30);
      expect(panel.hideAdded(999).length).toBeLessThanOrEqual(30);
    }
    expect(termIt.panel.hideAdded(3)).toBe("Nascondi i 3 nuovi arrivati");
    // The sort button beside the count and "Seleziona": its short words, never longer than the whole ones.
    for (const sort of [termIt.sort, termEn.sort]) {
      for (const key of Object.keys(sort.options) as (keyof typeof sort.options)[]) {
        expect(sort.button(sort.short[key]).length).toBeLessThanOrEqual(19);
      }
    }
  });
});
