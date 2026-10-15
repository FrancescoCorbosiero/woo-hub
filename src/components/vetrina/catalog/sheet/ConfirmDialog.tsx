"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Dialog, DialogButton, Preloader } from "konsta/react";
import { useI18n } from "@/i18n/provider";
import type { OperationInput, OperationPreview } from "@/lib/vetrina/catalog-ops";
import { previewOperation } from "@/server/actions/vetrina-operations";
import type { VetrinaResult } from "@/server/vetrina/service";
import { useSheetMount } from "../../sheet-mount";
import { call } from "../act/call";
import { Warning } from "../act/icons";
import { useLastShown } from "../act/parts";

/**
 * A one-product action from its sheet that is worth a second thought —
 * hiding a product the homepage shows, taking it out of a category — asked
 * as an iOS alert: what happens, then the preview's warnings ("La homepage
 * perde prodotti in TENDENZA."), read from the server when it opens. The
 * button waits for that preview, and a refusal shows inside the alert.
 */

export interface ConfirmRequest {
  input: OperationInput;
  title: string;
  body: string;
  /** The button's word: "Nascondi", "Togli". */
  confirm: string;
}

// Red like iOS's destructive buttons: both actions take something away.
// DialogButton takes no colours of its own; greyed out, it keeps Konsta's.
const DANGER = "!bg-red-600 !text-white active:!bg-red-700";

export function ConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  /** The action to confirm; null = closed. */
  request: ConfirmRequest | null;
  onCancel: () => void;
  /** Starts it: null once it started (the caller closes the alert), else the refusal in the owner's words. */
  onConfirm: (request: ConfirmRequest) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const c = t.vetrinaCatalog.sheet.confirm;
  const network = t.vetrinaCatalog.act.sheet.network;
  const mount = useSheetMount();
  // While it fades out, it keeps what it said.
  const shown = useLastShown(request);
  // Answers are kept with the request they answer: a new opening never shows an older one.
  const [answer, setAnswer] = React.useState<{ to: ConfirmRequest; res: VetrinaResult<OperationPreview> } | null>(null);
  const [refusal, setRefusal] = React.useState<{ to: ConfirmRequest; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  // A second tap before the button greys out must not start it twice.
  const going = React.useRef(false);

  React.useEffect(() => {
    if (!request) return;
    let alive = true;
    void call(() => previewOperation(request.input), network).then((res) => {
      if (alive) setAnswer({ to: request, res });
    });
    return () => {
      alive = false;
    };
  }, [request, network]);

  const res = answer && answer.to === shown ? answer.res : null;
  const preview = res?.ok ? res.data : null;
  const ready = preview != null && preview.changes > 0;
  const refused = refusal && refusal.to === shown ? refusal.text : null;

  async function confirm() {
    if (!request || !ready || going.current) return;
    going.current = true;
    setBusy(true);
    const text = await onConfirm(request);
    going.current = false;
    setBusy(false);
    if (text) setRefusal({ to: request, text });
  }

  const why = preview && preview.warnings.length === 0 ? preview.untouched.map((u) => u.reason).join(", ") || null : null;

  const content = shown && (
    <div className="space-y-3 text-[14px] leading-snug">
      <p className="text-center">{shown.body}</p>
      {!res ? (
        <p aria-busy className="flex min-h-11 items-center justify-center gap-2 opacity-60">
          <Preloader className="!h-4 !w-4" />
          {c.loading}
        </p>
      ) : !res.ok ? (
        <p role="alert" className="text-center text-red-600 dark:text-red-400">
          {res.error}
        </p>
      ) : (
        <>
          {res.data.warnings.length > 0 && (
            <ul className="space-y-2 text-start">
              {res.data.warnings.map((w) => (
                <li
                  key={w}
                  className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                >
                  <Warning className="mt-px h-4 w-4 shrink-0" />
                  <span className="min-w-0">{w}</span>
                </li>
              ))}
            </ul>
          )}
          {res.data.changes === 0 && <p className="text-center opacity-70">{c.nothing(why)}</p>}
        </>
      )}
      {refused && (
        <p role="alert" className="text-center text-red-600 dark:text-red-400">
          {refused}
        </p>
      )}
    </div>
  );

  const dialog = (
    // Above the product sheet: sheets sit at z-index 9999 in the same mount point.
    <div className="relative z-[10000]">
      <Dialog
        opened={request != null}
        onBackdropClick={busy ? undefined : onCancel}
        title={shown?.title}
        content={content}
        buttons={
          <>
            <DialogButton onClick={onCancel} disabled={busy}>
              {c.cancel}
            </DialogButton>
            <DialogButton
              strong
              className={ready && !busy ? DANGER : ""}
              disabled={!ready || busy}
              onClick={() => void confirm()}
            >
              {busy ? c.starting : shown?.confirm}
            </DialogButton>
          </>
        }
      />
    </div>
  );
  // In the app shell, like the sheets: inside the product sheet it would be
  // laid out within the sheet's own (moving) box.
  return mount ? createPortal(dialog, mount) : dialog;
}
