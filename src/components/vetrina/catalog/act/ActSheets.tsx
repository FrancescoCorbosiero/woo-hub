"use client";

import * as React from "react";
import type { OperationTarget, OperationView, SaleRounding, TermKey } from "@/lib/vetrina/catalog-ops";
import { CategorySheet } from "./CategorySheet";
import { DeleteSheet } from "./DeleteSheet";
import { OrderSheet, type OrderTerm } from "./OrderSheet";
import { useLastShown } from "./parts";
import { PinSheet } from "./PinSheet";
import { SaleSheet } from "./SaleSheet";
import { TagSheet } from "./TagSheet";
import { VisibilitySheet } from "./VisibilitySheet";

/**
 * Every action sheet behind one state: a screen (or the selection bar) says
 * which one to open on what, and closes it. The sheets themselves can also
 * be used one by one (SaleSheet, VisibilitySheet, TagSheet, CategorySheet,
 * PinSheet, OrderSheet, DeleteSheet).
 */

export type ActSheetKind =
  | "sale"
  | "unsale"
  | "hide"
  | "show"
  | "tag"
  | "untag"
  | "category"
  | "uncategorize"
  | "pin"
  | "order"
  | "delete";

export interface ActRequest {
  /** Which sheet, in which mode: "sale"/"unsale" open the Saldo sheet, "tag"/"untag" the Tag sheet, and so on. */
  kind: ActSheetKind;
  target: OperationTarget;
  /** What it acts on, in words, under the sheet's title. */
  label: string;
  /** A whole category's or brand's hide or sale (its screen's panel), filed under it. */
  termKey?: TermKey;
  /** Visibility only: offer the other of Nascondi / Mostra too. Default true. */
  switchable?: boolean;
  /** Mostra only: leave hidden what another whole category's or brand's hide holds (a term panel's "Mostra i N nascosti"). */
  keepHeld?: boolean;
  /** Saldo only: the percent it opens on. */
  percent?: number;
  /** Saldo only: the last day it opens on (a term's running sale, changed). */
  endsOn?: string | null;
  /** Saldo only: the rounding it opens on (a term's running sale, changed). */
  rounding?: SaleRounding;
  /** Saldo only: it changes the term's running sale, opened on its percent, last day and rounding. */
  change?: boolean;
  /** Categoria only: the categories the product is in already (one product, from its sheet). */
  has?: readonly number[];
  /** Ordina only: the category or brand whose order it is. */
  term?: OrderTerm;
}

export function ActSheets({
  request,
  onClose,
  onStarted,
  onSwitch,
}: {
  /** The sheet to show; null = none. */
  request: ActRequest | null;
  onClose: () => void;
  /** An action started from one of them (the sheet has closed). */
  onStarted?: (view: OperationView) => void;
  /** A sheet leads to another on the same products (Nascondi's "Elimina"): the request to show instead. Without it, none does. */
  onSwitch?: (request: ActRequest) => void;
}) {
  // While a sheet slides away its words stay: only its target lets go.
  const shown = useLastShown(request);
  const kind = request?.kind;
  const at = (...kinds: ActSheetKind[]) => (request && kind && kinds.includes(kind) ? request.target : null);
  const label = shown?.label ?? "";
  const common = { label, onClose, onStarted };

  return (
    <>
      <SaleSheet
        {...common}
        target={at("sale", "unsale")}
        mode={shown?.kind === "unsale" ? "unsale" : "sale"}
        termKey={shown?.termKey}
        percent={shown?.percent}
        endsOn={shown?.endsOn}
        rounding={shown?.rounding}
        change={shown?.change}
      />
      <VisibilitySheet
        {...common}
        target={at("hide", "show")}
        mode={shown?.kind === "show" ? "show" : "hide"}
        termKey={shown?.kind === "hide" ? shown.termKey : undefined}
        switchable={shown?.switchable ?? true}
        keepHeld={shown?.kind === "show" && shown.keepHeld === true}
        onDelete={
          onSwitch && request && !request.termKey
            ? () => onSwitch({ kind: "delete", target: request.target, label: request.label })
            : undefined
        }
      />
      <TagSheet {...common} target={at("tag", "untag")} mode={shown?.kind === "untag" ? "remove" : "add"} />
      <CategorySheet
        {...common}
        target={at("category", "uncategorize")}
        mode={shown?.kind === "uncategorize" ? "remove" : "add"}
        has={shown?.has}
      />
      <PinSheet {...common} target={at("pin")} />
      <OrderSheet {...common} target={at("order")} term={shown?.term ?? null} />
      <DeleteSheet {...common} target={at("delete")} />
    </>
  );
}
