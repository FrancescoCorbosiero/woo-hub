"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogButton, Navbar, NavbarBackLink } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import { useLastShown } from "../catalog/act/parts";
import { useSheetMount } from "../sheet-mount";
import { useBack } from "../use-back";

/** The "Negozio" tab's screens: their navbar, back to the tab, a title clear of the buttons. */
export function ShopSubNavbar({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const { t } = useI18n();
  const back = useBack("/vetrina/negozio");
  return (
    <Navbar
      title={title}
      subtitle={subtitle}
      titleClassName="truncate max-w-[calc(100%-176px)]"
      subtitleClassName="truncate"
      left={<NavbarBackLink onClick={back} text={t.vetrinaCatalog.shop.back} />}
      right={right}
    />
  );
}

/** A question worth a second thought before something is written to the store. */
export interface ConfirmAsk {
  title: string;
  body: string;
  /** The button's word: "Pubblica", "Conferma". */
  confirm: string;
  /** Red, like iOS's: something is taken back or away. */
  danger?: boolean;
  /** Runs it; the alert closes when it ends. */
  run: () => Promise<void>;
}

// DialogButton takes no colours of its own; greyed out, it keeps Konsta's.
const STRONG = "!bg-primary !text-white dark:!text-black";
const DANGER = "!bg-red-600 !text-white active:!bg-red-700";

/** An iOS alert in the app shell: what happens, "Annulla", and the button that does it. */
export function ShopConfirm({ ask, onClose }: { ask: ConfirmAsk | null; onClose: () => void }) {
  const { t } = useI18n();
  const mount = useSheetMount();
  const shown = useLastShown(ask);
  const [busy, setBusy] = React.useState(false);
  const going = React.useRef(false);

  async function confirm() {
    if (!ask || going.current) return;
    going.current = true;
    setBusy(true);
    try {
      await ask.run();
    } finally {
      going.current = false;
      setBusy(false);
      onClose();
    }
  }

  const dialog = (
    <div className="relative z-[10000]">
      <Dialog
        opened={ask != null}
        onBackdropClick={busy ? undefined : onClose}
        title={shown?.title}
        content={<p className="text-center text-[14px] leading-snug">{shown?.body}</p>}
        buttons={
          <>
            <DialogButton onClick={onClose} disabled={busy}>
              {t.vetrinaCatalog.act.bar.cancel}
            </DialogButton>
            <DialogButton strong className={busy ? "" : shown?.danger ? DANGER : STRONG} disabled={busy} onClick={() => void confirm()}>
              {busy ? t.vetrinaCatalog.act.sheet.starting : shown?.confirm}
            </DialogButton>
          </>
        }
      />
    </div>
  );
  return mount ? createPortal(dialog, mount) : dialog;
}

/** A product's photo in a fixed 56px box: the row never moves when it arrives. */
export function ShopThumb({ src }: { src: string | null }) {
  const [shown, setShown] = React.useState(false);
  return (
    <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-black/[0.04] dark:bg-white/10">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- the source's own thumbnail, never resized here
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setShown(true)}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

/** Euros as the shop shows them. */
export function useEuro(): (amount: number) => string {
  const { locale } = useI18n();
  return React.useMemo(() => {
    const format = new Intl.NumberFormat(locale === "en" ? "en-GB" : "it-IT", { style: "currency", currency: "EUR" });
    return (amount: number) => format.format(amount);
  }, [locale]);
}
