/**
 * A category's or a brand's own actions, from its screen's "⋯": its name, a
 * sub-term, its place in the tree, merging it into another, deleting it —
 * each with "Annulla" (src/components/vetrina/catalog/term/TermManage.tsx).
 */

type Tx = "category" | "brand";

const n = (count: number) => count.toLocaleString("it-IT");

export const termsIt = {
  menu: {
    rename: "Rinomina",
    newChild: { category: "Nuova sottocategoria", brand: "Nuova linea del brand" } as Record<Tx, string>,
    move: "Sposta sotto…",
    merge: "Unisci a…",
    delete: { category: "Elimina la categoria", brand: "Elimina il brand" } as Record<Tx, string>,
  },
  name: {
    rename: (name: string) => `Rinomina «${name}»`,
    create: { category: (parent: string) => `Nuova sottocategoria di «${parent}»`, brand: (parent: string) => `Nuova linea di «${parent}»` } as Record<
      Tx,
      (parent: string) => string
    >,
    label: "Nome",
    renameHint: "Il suo indirizzo sul sito resta lo stesso.",
    save: "Salva",
    make: "Crea",
    needName: "Scrivi un nome.",
  },
  pick: {
    move: (name: string) => `Sposta «${name}» sotto…`,
    merge: (name: string) => `Unisci «${name}» a…`,
    top: "Al primo livello",
    search: { category: "Cerca una categoria", brand: "Cerca un brand" } as Record<Tx, string>,
    empty: "Niente da mostrare.",
    loading: "Carico…",
    failed: "Non riesco a leggere l'elenco.",
  },
  confirm: {
    move: (name: string, into: string | null) => (into ? `Sposta «${name}» sotto «${into}»` : `Sposta «${name}» al primo livello`),
    merge: (name: string, into: string) => `Unisci «${name}» a «${into}»`,
    delete: (name: string) => `Elimina «${name}»`,
    moveButton: "Sposta",
    mergeButton: (count: number | null) => (count ? `Unisci · ${count === 1 ? "1 prodotto" : `${n(count)} prodotti`}` : "Unisci"),
    deleteButton: (count: number | null) => (count ? `Elimina · ${count === 1 ? "1 prodotto" : `${n(count)} prodotti`}` : "Elimina"),
    background: "I prodotti si spostano uno per uno, in background: il progresso è in basso, e da Attività puoi annullare.",
    other: "Scegli un'altra",
  },
  done: {
    renamed: (name: string) => `Ora si chiama «${name}»`,
    created: { category: (name: string) => `Categoria «${name}» creata`, brand: (name: string) => `Brand «${name}» creato` } as Record<Tx, (name: string) => string>,
    moved: { category: (name: string) => `Categoria «${name}» spostata`, brand: (name: string) => `Brand «${name}» spostato` } as Record<Tx, (name: string) => string>,
    undone: "Com'era prima",
  },
  undo: "Annulla",
};
