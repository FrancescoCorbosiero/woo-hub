"use client";

import { Actions, ActionsButton, ActionsGroup, ActionsLabel } from "konsta/react";
import { useI18n } from "@/i18n/provider";

/** An entry of the section's "⋯": none when the section, the config or the site do not offer it. */
type Item = (() => void) | null;

/**
 * The section's "⋯" in the navbar: products from the catalog, what it
 * shows, its texts and look, its rule, its category in the catalog, the
 * history, everything back in automatic, the page and the category on the
 * site. Each closes the sheet first.
 */
export function SectionActions({
  open,
  title,
  onClose,
  onAddProducts,
  onChangeSource,
  onLooks,
  onRule,
  onCatalog,
  onHistory,
  onReset,
  pageLink,
  termLink,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onAddProducts: Item;
  onChangeSource: Item;
  onLooks: Item;
  onRule: Item;
  onCatalog: Item;
  onHistory: () => void;
  onReset: Item;
  /** The homepage on the site. */
  pageLink: string;
  /** The section's category page on the site. */
  termLink: string | null;
}) {
  const { t } = useI18n();
  const v = t.vetrina.editor;
  const sx = t.vetrinaCatalog.sections;
  const item = (label: string, action: Item) =>
    action && (
      <ActionsButton
        onClick={() => {
          onClose();
          action();
        }}
      >
        {label}
      </ActionsButton>
    );
  const link = (label: string, href: string | null) =>
    href && (
      <ActionsButton
        onClick={() => {
          window.open(href, "_blank", "noreferrer");
          onClose();
        }}
      >
        {label}
      </ActionsButton>
    );

  return (
    <Actions opened={open} onBackdropClick={onClose}>
      <ActionsGroup>
        <ActionsLabel>{title}</ActionsLabel>
        {item(sx.menu.addProducts, onAddProducts)}
        {item(sx.menu.change, onChangeSource)}
        {item(t.vetrina.section.open, onLooks)}
        {item(t.vetrina.auto.menu, onRule)}
        {item(t.vetrinaCatalog.sheet.openInCatalog, onCatalog)}
        {item(v.menu.history, onHistory)}
        {item(v.menu.reset, onReset)}
        {link(v.menu.viewSite, pageLink || null)}
        {link(v.menu.category, termLink)}
      </ActionsGroup>
      <ActionsGroup>
        <ActionsButton bold onClick={onClose}>
          {v.actions.cancel}
        </ActionsButton>
      </ActionsGroup>
    </Actions>
  );
}
