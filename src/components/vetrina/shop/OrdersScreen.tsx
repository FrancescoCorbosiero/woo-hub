"use client";

import * as React from "react";
import { Block, Button, Link as KLink, List, ListItem, Page, Preloader, Segmented, SegmentedButton } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { pullOrders, setOrderNote, setOrderStatus, setOrderTracking, type OrdersState } from "@/server/actions/orders";
import { CARRIERS, NEXT_STATUS, needsWooMirror, type OrderStatus } from "@/server/orders/model";
import type { OrderView } from "@/server/orders/repo";
import type { VetrinaResult } from "@/server/vetrina/service";
import { ActSheetFrame, FILL, SheetBody, SheetFooter, SheetHead, useLastShown } from "../catalog/act/parts";
import { TabbarSpacer } from "../catalog/TabbarSpacer";
import { ErrorState } from "../ErrorState";
import { Refresh } from "../icons";
import { SEGMENTED_COLORS } from "../segmented";
import { TextField } from "../menus/parts";
import { SearchField } from "../catalog/term/browse";
import { ShopConfirm, ShopSubNavbar, ShopThumb, useEuro, type ConfirmAsk } from "./parts";

type Filter = "open" | "shipped" | "all";

/** An order matches a search by its number, its customer, its city, its tracking, or what it holds. */
function matches(order: OrderView, needle: string): boolean {
  if (!needle) return true;
  return [
    order.number,
    order.customerName,
    order.customerEmail,
    order.shipping.city,
    order.trackingCode,
    ...order.items.map((item) => item.sku),
    ...order.items.map((item) => item.name),
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

const IN: Record<Filter, (o: OrderView) => boolean> = {
  open: (o) => o.status === "new" || o.status === "processing",
  shipped: (o) => o.status === "shipped",
  all: () => true,
};

/** The status's colour, as a small pill. */
const PILL: Record<OrderStatus, string> = {
  new: "bg-[#ff9500]/15 text-[#c76f00] dark:text-[#ff9f0a]",
  processing: "bg-primary/12 text-primary",
  shipped: "bg-[#34c759]/15 text-[#248a3d] dark:text-[#30d158]",
  completed: "bg-black/[0.06] text-black/60 dark:bg-white/10 dark:text-white/60",
  cancelled: "bg-red-600/10 text-red-600 dark:text-red-400",
};

/**
 * "Ordini": the store's orders, on the phone — the Hub's own workflow
 * (taken on, shipped with its tracking, done, cancelled; an internal note),
 * in its words (t.orders). Changes stay in the Hub: when an order is shipped
 * or cancelled here, a reminder says to bring WooCommerce in line too, as
 * the Hub's Orders tab does.
 */
export function OrdersScreen({ result }: { result: VetrinaResult<OrdersState> }) {
  const { t, locale } = useI18n();
  const w = t.vetrinaCatalog.shop.orders;
  const o = t.orders;
  const eur = useEuro();
  const [state, setState] = React.useState<OrdersState | null>(result.ok ? result.data : null);
  const [filter, setFilter] = React.useState<Filter>("open");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [pulling, setPulling] = React.useState(false);
  const day = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "it-IT", { day: "numeric", month: "short" });

  async function pull() {
    setPulling(true);
    const res = await pullOrders().catch((e: unknown) => ({ ok: false as const, error: String(e), state: undefined, report: undefined }));
    setPulling(false);
    if (res.ok && res.state) {
      setState(res.state);
      toast.success(w.pulled(res.report?.saved ?? res.state.orders.length));
    } else {
      toast.error(`${o.pullFailed}: ${res.error ?? ""}`);
    }
  }

  /** The order changed here: the list shows it at once, as the server saved it. */
  function changed(next: OrderView) {
    setState((current) => (current ? { ...current, orders: current.orders.map((x) => (x.id === next.id ? next : x)) } : current));
  }

  const orders = state?.orders ?? [];
  const needle = query.trim().toLowerCase();
  const shown = orders.filter((order) => IN[filter](order) && matches(order, needle));
  const open = orders.find((x) => x.id === openId) ?? null;

  return (
    <Page>
      <ShopSubNavbar
        title={w.title}
        right={
          state?.wooConfigured ? (
            <KLink iconOnly onClick={() => void pull()} aria-label={w.pull}>
              {pulling ? <Preloader className="!h-5 !w-5" /> : <Refresh className="h-5 w-5" />}
            </KLink>
          ) : undefined
        }
      />
      {!result.ok || !state ? (
        result.ok ? null : (
          <div className="pt-3">
            <ErrorState code={result.code} error={result.error} />
          </div>
        )
      ) : (
        <>
          <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">
            {state.wooConfigured ? (state.lastPulledAt ? w.intro : w.neverPulled) : o.notConfigured}
          </p>
          {orders.length > 0 && <SearchField value={query} onChange={setQuery} placeholder={o.searchPlaceholder} />}
          <div className="px-4 pt-2">
            <Segmented strong rounded colors={SEGMENTED_COLORS}>
              {(["open", "shipped", "all"] as const).map((f) => (
                <SegmentedButton key={f} className="!h-11" active={filter === f} onClick={() => setFilter(f)}>
                  {w.filters[f]}
                  {f === "open" && ` (${orders.filter(IN.open).length})`}
                </SegmentedButton>
              ))}
            </Segmented>
          </div>
          {shown.length === 0 ? (
            <Block strong inset className="text-center text-[15px] leading-snug">
              {needle ? o.empty : w.empty[filter]}
            </Block>
          ) : (
            <List strong inset dividers aria-label={w.title}>
              {shown.map((order) => (
                <ListItem
                  key={order.id}
                  link
                  linkComponent="button"
                  linkProps={{ type: "button", onClick: () => setOpenId(order.id) }}
                  contentClassName="w-full text-start"
                  title={`#${order.number} · ${order.customerName || order.shipping.name}`}
                  subtitle={`${o.items(order.items.reduce((sum, item) => sum + item.quantity, 0))}${order.total != null ? ` · ${eur(order.total)}` : ""}`}
                  text={needsWooMirror(order.status, order.wooStatus) ? o.mirrorBadge : undefined}
                  after={
                    <span className="flex flex-col items-end gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${PILL[order.status]}`}>{o.status[order.status]}</span>
                      <span className="text-[12px] opacity-50">{day.format(new Date(order.createdAt))}</span>
                    </span>
                  }
                />
              ))}
            </List>
          )}
        </>
      )}
      <TabbarSpacer />
      <OrderSheet order={open} onClose={() => setOpenId(null)} onChanged={changed} />
    </Page>
  );
}

function OrderSheet({ order, onClose, onChanged }: { order: OrderView | null; onClose: () => void; onChanged: (next: OrderView) => void }) {
  const shown = useLastShown(order);
  return (
    <ActSheetFrame open={order != null} onClose={onClose}>
      {shown && <OrderContent key={shown.id} order={order ?? shown} onClose={onClose} onChanged={onChanged} />}
    </ActSheetFrame>
  );
}

function OrderContent({ order, onClose, onChanged }: { order: OrderView; onClose: () => void; onChanged: (next: OrderView) => void }) {
  const { t, locale } = useI18n();
  const w = t.vetrinaCatalog.shop.orders;
  const o = t.orders;
  const eur = useEuro();
  const [busy, setBusy] = React.useState(false);
  const [shipping, setShipping] = React.useState(false);
  const [carrier, setCarrier] = React.useState(order.carrier);
  const [code, setCode] = React.useState(order.trackingCode);
  const [url, setUrl] = React.useState(order.trackingUrl);
  const [note, setNote] = React.useState(order.note);
  const [ask, setAsk] = React.useState<ConfirmAsk | null>(null);
  const next = NEXT_STATUS[order.status];
  const created = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "it-IT", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(order.createdAt),
  );

  async function status(to: OrderStatus) {
    setBusy(true);
    const res = await setOrderStatus({ orderId: order.id, status: to }).catch((e: unknown) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!res.ok) {
      toast.error(`${o.saveFailed}: ${res.error ?? ""}`);
      return false;
    }
    onChanged({ ...order, status: to, statusChangedAt: new Date().toISOString() });
    toast.success(o.status[to]);
    return true;
  }

  async function ship(withTracking: boolean) {
    setBusy(true);
    if (withTracking) {
      const saved = await setOrderTracking({ orderId: order.id, carrier, trackingCode: code, trackingUrl: url }).catch((e: unknown) => ({
        ok: false,
        error: String(e),
      }));
      if (!saved.ok) {
        setBusy(false);
        toast.error(`${o.saveFailed}: ${saved.error ?? ""}`);
        return;
      }
    }
    setBusy(false);
    if (await status("shipped")) {
      if (withTracking) onChanged({ ...order, status: "shipped", carrier, trackingCode: code, trackingUrl: url });
      setShipping(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    const res = await setOrderNote({ orderId: order.id, note }).catch((e: unknown) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (!res.ok) {
      toast.error(`${o.saveFailed}: ${res.error ?? ""}`);
      return;
    }
    onChanged({ ...order, note: note.trim() });
    toast.success(w.saved);
  }

  const address = [order.shipping.name, order.shipping.street, [order.shipping.zip, order.shipping.city, order.shipping.state].filter(Boolean).join(" "), order.shipping.country]
    .filter((line) => line.trim() !== "")
    .join("\n");

  return (
    <>
      <SheetHead title={w.number(order.number)} subtitle={`${order.customerName} · ${created}`} onClose={onClose} />
      <SheetBody>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${PILL[order.status]}`}>{o.status[order.status]}</span>
          {order.wooStatus && <span className="text-[13px] opacity-50">{o.wooChip(order.wooStatus)}</span>}
        </div>
        {needsWooMirror(order.status, order.wooStatus) && (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-[14px] leading-snug text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            {o.mirrorHint}
          </p>
        )}

        {shipping ? (
          <div className="space-y-3 rounded-2xl bg-white p-4 dark:bg-[#2c2c2e]">
            <p className="text-[15px] font-semibold">{w.shipTitle}</p>
            <p className="text-[14px] leading-snug opacity-60">{w.shipIntro}</p>
            <div className="flex flex-wrap gap-1.5">
              {CARRIERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCarrier(carrier === c ? "" : c)}
                  className={`h-9 rounded-full px-3 text-[14px] ${carrier === c ? "bg-primary font-semibold text-white dark:text-black" : "bg-black/[0.05] dark:bg-white/10"}`}
                >
                  {c}
                </button>
              ))}
            </div>
            <TextField label={o.trackingCarrier} value={carrier} onChange={setCarrier} />
            <TextField label={o.trackingCode} value={code} onChange={setCode} />
            <TextField label={o.trackingUrl} value={url} onChange={setUrl} url />
            <Button large rounded colors={FILL} disabled={busy || code.trim() === ""} onClick={() => void ship(true)} className="w-full">
              {o.trackingSaveAndShip}
            </Button>
            <Button rounded tonal disabled={busy} onClick={() => void ship(false)} className="!h-11 w-full">
              {o.trackingSkip}
            </Button>
          </div>
        ) : (
          order.trackingCode && (
            <div className="rounded-2xl bg-white p-4 text-[15px] dark:bg-[#2c2c2e]">
              <p className="text-[13px] font-semibold uppercase tracking-wide opacity-60">{o.tracking}</p>
              <p className="mt-1">
                {order.carrier && `${order.carrier} · `}
                {order.trackingUrl ? (
                  <a href={order.trackingUrl} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                    {order.trackingCode}
                  </a>
                ) : (
                  order.trackingCode
                )}
              </p>
            </div>
          )
        )}

        <List strong inset dividers className="!mx-0 !my-0">
          {order.items.map((item, i) => (
            <ListItem
              key={`${item.sku}-${i}`}
              media={<ShopThumb src={item.image || null} />}
              title={item.name}
              subtitle={[item.size ? o.size(item.size) : null, o.qty(item.quantity)].filter(Boolean).join(" · ")}
              after={item.total != null ? eur(item.total) : undefined}
            />
          ))}
          {order.total != null && <ListItem title={<span className="font-semibold">{o.total}</span>} after={<span className="font-semibold">{eur(order.total)}</span>} />}
        </List>
        {order.paymentMethod && <p className="px-1 text-[13px] opacity-60">{o.paidWith(order.paymentMethod)}</p>}

        <div className="space-y-2 rounded-2xl bg-white p-4 text-[15px] leading-snug dark:bg-[#2c2c2e]">
          <p className="text-[13px] font-semibold uppercase tracking-wide opacity-60">{o.address}</p>
          <p className="whitespace-pre-line">{address}</p>
          <div className="flex gap-2 pt-1">
            <Button
              rounded
              tonal
              className="!h-10 flex-1"
              onClick={() =>
                void navigator.clipboard
                  .writeText(address)
                  .then(() => toast.success(o.copied))
                  .catch(() => undefined)
              }
            >
              {o.copyAddress}
            </Button>
            {(order.customerPhone || order.shipping.phone) && (
              <Button rounded tonal component="a" href={`tel:${order.customerPhone || order.shipping.phone}`} className="!h-10 flex-1">
                {w.call}
              </Button>
            )}
            {order.customerEmail && (
              <Button rounded tonal component="a" href={`mailto:${order.customerEmail}`} className="!h-10 flex-1">
                {w.write}
              </Button>
            )}
          </div>
        </div>

        {order.customerNote && (
          <div className="rounded-2xl bg-white p-4 text-[15px] leading-snug dark:bg-[#2c2c2e]">
            <p className="text-[13px] font-semibold uppercase tracking-wide opacity-60">{o.customerNote}</p>
            <p className="mt-1 whitespace-pre-line">{order.customerNote}</p>
          </div>
        )}

        <div className="space-y-2">
          <TextField label={o.note} value={note} onChange={setNote} />
          {note.trim() !== order.note && (
            <Button rounded tonal disabled={busy} onClick={() => void saveNote()} className="!h-10 w-full">
              {o.noteSave}
            </Button>
          )}
        </div>

        {order.status === "cancelled" || order.status === "completed" ? (
          <Button rounded tonal disabled={busy} onClick={() => void status("new")} className="!h-11 w-full">
            {w.reopen}
          </Button>
        ) : (
          <Button
            rounded
            tonal
            disabled={busy}
            className="!h-11 w-full !text-red-600 dark:!text-red-400"
            onClick={() =>
              setAsk({ title: o.cancelOrder, body: w.cancelConfirm, confirm: o.cancelOrder, danger: true, run: async () => void (await status("cancelled")) })
            }
          >
            {o.cancelOrder}
          </Button>
        )}
      </SheetBody>
      {next && !shipping && (
        <SheetFooter>
          <Button
            large
            rounded
            colors={FILL}
            disabled={busy}
            className="w-full"
            onClick={() => (next === "shipped" ? setShipping(true) : void status(next))}
          >
            {o.advance[order.status as keyof typeof o.advance]}
          </Button>
        </SheetFooter>
      )}
      <ShopConfirm ask={ask} onClose={() => setAsk(null)} />
    </>
  );
}
