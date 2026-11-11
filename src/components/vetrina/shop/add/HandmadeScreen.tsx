"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Block, Button, Navbar, NavbarBackLink, Page, Preloader, Toggle } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import {
  checkHandmade,
  generateSku,
  HANDMADE_LIMITS,
  ONE_SIZE,
  slugify,
  snippet,
  type HandmadeField,
  type HandmadeInput,
} from "@/lib/handmade";
import { makeHandmadeProduct, type HandmadeSetup } from "@/server/actions/vetrina-add";
import type { HandmadeOutcome } from "@/server/add-products/handmade";
import type { VetrinaResult } from "@/server/vetrina/service";
import { FILL } from "../../catalog/act/parts";
import { TabbarSpacer } from "../../catalog/TabbarSpacer";
import { ErrorState } from "../../ErrorState";
import { parsePrice } from "../../format";
import { useBack } from "../../use-back";
import { CARD, FIELD, INPUT, INVALID, SECTION } from "./look";
import { photoKey, PhotosField, type FormPhoto } from "./PhotosField";
import { sizeRow, SizesField, type OneSize, type SizeRow } from "./SizesField";

const SWITCH_TARGET = "relative before:absolute before:-inset-x-2 before:-inset-y-2 before:content-['']";
const TOGGLE_COLORS = { checkedBgIos: "bg-[#34c759] dark:bg-[#30d158]" };
const LABEL = "mb-1 block px-1 text-[13px] opacity-60";
const PLUGIN_NAMES = { rankmath: "Rank Math", yoast: "Yoast SEO" } as const;

interface Form {
  photos: FormPhoto[];
  sku: string;
  title: string;
  brand: string;
  categoryIds: number[];
  description: string;
  mode: "sizes" | "one";
  sizes: SizeRow[];
  one: OneSize;
  seo: { title: string; description: string; slug: string };
  visible: boolean;
}

function startingForm(prefill: HandmadeSetup["prefill"]): Form {
  return {
    photos: (prefill?.photos ?? []).map((url) => ({
      key: photoKey(),
      url,
      link: true,
      status: "done" as const,
    })),
    sku: prefill?.sku ?? "",
    title: prefill?.title ?? "",
    brand: prefill?.brand ?? "",
    categoryIds: [],
    description: prefill?.description ?? "",
    mode: "sizes",
    sizes: (prefill?.sizes ?? []).map((label) => sizeRow(label)),
    one: { price: "", stock: "1", barcode: "" },
    seo: { title: "", description: "", slug: "" },
    visible: true,
  };
}

/** What the form says, as the product the server makes: a price that does not read is 0, which the check refuses. */
function toInput(form: Form): HandmadeInput {
  const stock = (text: string) => (text.trim() === "" ? 0 : Number.parseInt(text, 10));
  return {
    sku: form.sku,
    title: form.title,
    brand: form.brand,
    categoryIds: form.categoryIds,
    description: form.description,
    photos: form.photos.filter((p) => p.status === "done").map((p) => (p.id != null ? { id: p.id, url: p.url } : { url: p.url })),
    sizes:
      form.mode === "one"
        ? [
            {
              label: ONE_SIZE,
              price: parsePrice(form.one.price) ?? 0,
              stock: stock(form.one.stock),
              barcode: form.one.barcode,
            },
          ]
        : form.sizes.map((s) => ({
            label: s.label,
            price: parsePrice(s.price) ?? 0,
            stock: stock(s.stock),
            barcode: s.barcode,
          })),
    seo: form.seo,
    visible: form.visible,
  };
}

/**
 * "Aggiungi prodotti", by hand: the product a code nobody knows names — or a
 * product with no code yet — made from the phone, as a shop's admin makes
 * one: photos, name and code, brand and categories, description, sizes with
 * their prices and pieces, how it shows on Google, and whether it goes on
 * sale at once. The shop owns it from then on (src/server/add-products/handmade.ts).
 */
export function HandmadeScreen({ result, fromCodes }: { result: VetrinaResult<HandmadeSetup>; fromCodes: boolean }) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.handmade;
  const router = useRouter();
  const back = useBack("/vetrina/negozio/aggiungi");
  const setup = result.ok ? result.data : null;
  const [form, setForm] = React.useState<Form>(() => startingForm(setup?.prefill ?? null));
  const [invalid, setInvalid] = React.useState<ReadonlySet<HandmadeField>>(new Set());
  const [taken, setTaken] = React.useState<{
    title: string;
    editUrl: string;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [made, setMade] = React.useState<Extract<HandmadeOutcome, { ok: true }> | null>(null);
  const [catOpen, setCatOpen] = React.useState(false);
  const [catQuery, setCatQuery] = React.useState("");
  // Anything the owner changed: what leaving would lose.
  const [touched, setTouched] = React.useState(false);
  const dirty = touched && !made;

  // A half-made product is not lost to a closed tab without a word.
  React.useEffect(() => {
    if (!dirty) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [dirty]);

  const change = (next: (f: Form) => Form) => {
    setForm(next);
    setTouched(true);
  };
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    change((f) => ({ ...f, [key]: value }));
    if (invalid.size > 0)
      setInvalid((current) => new Set([...current].filter((f) => f !== (key === "one" || key === "mode" ? "sizes" : key))));
  };

  function leave(e?: React.MouseEvent) {
    if (dirty && !window.confirm(w.leave)) {
      e?.preventDefault();
      return;
    }
    back(e);
  }

  async function create() {
    if (form.photos.some((p) => p.status === "uploading")) {
      toast.message(w.uploadingWait);
      return;
    }
    const input = toInput(form);
    const checked = checkHandmade(input);
    if (!checked.ok) {
      setInvalid(new Set(checked.invalid));
      toast.error(`${w.invalid} ${checked.invalid.map((f) => w.fields[f]).join(", ")}`);
      return;
    }
    setBusy(true);
    setTaken(null);
    try {
      const res = await makeHandmadeProduct(input);
      if (!res.ok) {
        toast.error(`${w.failed} ${res.error}`);
        return;
      }
      const outcome = res.data;
      if (outcome.ok) {
        setMade(outcome);
        window.scrollTo({ top: 0 });
      } else if (outcome.code === "invalid") {
        setInvalid(new Set(outcome.invalid));
        toast.error(`${w.invalid} ${outcome.invalid.map((f) => w.fields[f]).join(", ")}`);
      } else {
        setTaken({ title: outcome.title, editUrl: outcome.editUrl });
        setInvalid(new Set(["sku"]));
      }
    } finally {
      setBusy(false);
    }
  }

  function another() {
    setForm(startingForm(null));
    setTouched(false);
    setMade(null);
    setInvalid(new Set());
    setTaken(null);
    router.replace("/vetrina/negozio/aggiungi/nuovo");
  }

  const navbar = (
    <Navbar
      title={w.title}
      titleClassName="truncate max-w-[calc(100%-176px)]"
      left={<NavbarBackLink onClick={leave} text={t.vetrinaCatalog.shop.add.title} />}
    />
  );

  if (!setup) {
    return (
      <Page>
        {navbar}
        {!result.ok && (
          <div className="pt-3">
            <ErrorState code={result.code} error={result.error} />
          </div>
        )}
        <TabbarSpacer />
      </Page>
    );
  }

  if (made) {
    return (
      <Page>
        {navbar}
        <Block strong inset className="space-y-1.5 text-[15px] leading-snug" role="status">
          <p className="text-[17px] font-semibold">{w.created}</p>
          <p className="opacity-80">
            {made.title} · {made.sku}
          </p>
          <p>{made.status === "publish" ? w.createdLive : form.visible ? w.createdHidden : w.createdHiddenByChoice}</p>
          {made.photosQueued > 0 && <p className="opacity-70">{w.createdPhotos(made.photosQueued)}</p>}
          {made.rejectedGtins.length > 0 && <p className="opacity-70">{w.gtinsRejected(made.rejectedGtins.length)}</p>}
          {made.failedSizes.length > 0 && <p className="text-red-600 dark:text-red-400">{w.sizesRefused(made.failedSizes)}</p>}
        </Block>
        <div className="space-y-2 px-4">
          {made.permalink && (
            <Button large rounded colors={FILL} className="w-full" onClick={() => window.open(made.permalink ?? "", "_blank", "noopener")}>
              {w.viewOnSite}
            </Button>
          )}
          <Button large rounded tonal className="w-full" onClick={() => window.open(made.editUrl, "_blank", "noopener")}>
            {w.editInWp}
          </Button>
          <Button large rounded tonal className="w-full" onClick={another}>
            {w.another}
          </Button>
          {fromCodes && (
            <Button large rounded tonal className="w-full" onClick={() => router.back()}>
              {w.backToCodes}
            </Button>
          )}
        </div>
        <TabbarSpacer />
      </Page>
    );
  }

  const bad = (field: HandmadeField) => invalid.has(field);
  const chosen = new Set(form.categoryIds);
  const query = catQuery.trim().toLowerCase();
  const categories = setup.categories.filter((c) => !query || c.path.toLowerCase().includes(query));
  const chosenPaths = setup.categories.filter((c) => chosen.has(c.id)).map((c) => c.path);
  const seoTitle = form.seo.title || form.title;
  const seoDescription = form.seo.description || snippet(form.description);
  const slugShown = form.seo.slug || slugify(form.title);

  return (
    <Page>
      {navbar}
      <p className="px-5 pb-1 pt-3 text-[15px] leading-snug opacity-60">{w.intro}</p>

      <h2 className={SECTION}>{w.photos}</h2>
      <div className="px-4">
        <div className={CARD}>
          <PhotosField
            photos={form.photos}
            onChange={(next) => change((f) => ({ ...f, photos: next(f.photos) }))}
            uploadable={setup.photosUploadable}
            title={form.title}
          />
        </div>
      </div>

      <h2 className={SECTION}>{w.details}</h2>
      <div className="px-4">
        <div className={CARD}>
          <label className="block">
            <span className={LABEL}>{w.name}</span>
            <input
              className={`${INPUT} ${bad("title") ? INVALID : ""}`}
              value={form.title}
              maxLength={HANDMADE_LIMITS.title}
              placeholder={w.namePlaceholder}
              enterKeyHint="next"
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <div>
            <label className={LABEL} htmlFor="handmade-sku">
              {w.sku}
            </label>
            <span className="flex gap-2">
              <input
                id="handmade-sku"
                className={`${FIELD} min-w-0 flex-1 font-mono ${bad("sku") ? INVALID : ""}`}
                value={form.sku}
                maxLength={HANDMADE_LIMITS.sku}
                placeholder={w.skuPlaceholder}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  set("sku", e.target.value.replace(/[\s,;]/g, ""));
                  setTaken(null);
                }}
              />
              {!form.sku && (
                <Button rounded tonal className="!h-auto !w-auto shrink-0 !px-3 text-[14px]" onClick={() => set("sku", generateSku())}>
                  {w.generate}
                </Button>
              )}
            </span>
            {taken && (
              <p className="mt-1.5 px-1 text-[13px] leading-snug text-red-600 dark:text-red-400">
                {w.skuTaken(taken.title)}{" "}
                <a href={taken.editUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
                  {w.openIt}
                </a>
              </p>
            )}
          </div>
          <label className="block">
            <span className={LABEL}>{w.brand}</span>
            <input
              className={INPUT}
              value={form.brand}
              list="handmade-brands"
              maxLength={HANDMADE_LIMITS.brand}
              placeholder={w.brandPlaceholder}
              autoComplete="off"
              onChange={(e) => set("brand", e.target.value)}
            />
            <datalist id="handmade-brands">
              {setup.brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <div>
            <span className={LABEL}>{w.categories}</span>
            <button
              type="button"
              aria-expanded={catOpen}
              onClick={() => setCatOpen((open) => !open)}
              className={`${INPUT} flex items-center justify-between gap-2 text-left`}
            >
              <span className={`truncate ${chosenPaths.length === 0 ? "opacity-40" : ""}`}>
                {chosenPaths.length > 0 ? chosenPaths.join(", ") : w.categoriesNone}
              </span>
              <span aria-hidden className="shrink-0 opacity-40">
                {catOpen ? "▴" : "▾"}
              </span>
            </button>
            {catOpen && (
              <div className="mt-2 space-y-2">
                <input
                  className={INPUT}
                  value={catQuery}
                  placeholder={w.categoriesSearch}
                  aria-label={w.categoriesSearch}
                  onChange={(e) => setCatQuery(e.target.value)}
                />
                <div className="max-h-72 overflow-y-auto rounded-xl border border-black/10 dark:border-white/15">
                  {categories.length === 0 ? (
                    <p className="px-3 py-3 text-[14px] opacity-60">{w.categoriesEmpty}</p>
                  ) : (
                    categories.map((c) => {
                      const on = chosen.has(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-black/5 px-3 py-2 last:border-b-0 dark:border-white/10"
                        >
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-[#007aff]"
                            checked={on}
                            onChange={() => {
                              if (!on && form.categoryIds.length >= HANDMADE_LIMITS.categories) {
                                toast.message(w.categoriesMax(HANDMADE_LIMITS.categories));
                                return;
                              }
                              set("categoryIds", on ? form.categoryIds.filter((id) => id !== c.id) : [...form.categoryIds, c.id]);
                            }}
                          />
                          <span className="text-[15px] leading-snug">{c.path}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <Button rounded tonal className="!h-10 w-full" onClick={() => setCatOpen(false)}>
                  {w.done}
                </Button>
              </div>
            )}
          </div>
          <label className="block">
            <span className={LABEL}>{w.description}</span>
            <textarea
              className={`${INPUT} min-h-[7rem] resize-y leading-snug`}
              value={form.description}
              maxLength={HANDMADE_LIMITS.description}
              placeholder={w.descriptionPlaceholder}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
        </div>
      </div>

      <h2 className={SECTION}>{w.sizes}</h2>
      <div className="px-4">
        <div className={CARD}>
          <SizesField
            mode={form.mode}
            onMode={(mode) => set("mode", mode)}
            sizes={form.sizes}
            onSizes={(next) => {
              change((f) => ({ ...f, sizes: next(f.sizes) }));
              if (invalid.has("sizes")) setInvalid((current) => new Set([...current].filter((f) => f !== "sizes")));
            }}
            one={form.one}
            onOne={(one) => set("one", one)}
            invalid={bad("sizes")}
          />
        </div>
      </div>

      <h2 className={SECTION}>{w.google}</h2>
      <div className="px-4">
        <div className={CARD}>
          <div className="space-y-0.5 rounded-xl border border-black/10 p-3 dark:border-white/15" aria-hidden>
            <p className="truncate text-[13px] text-[#202124] dark:text-[#bdc1c6]">
              {setup.site} › {slugShown || "…"}
            </p>
            <p className="line-clamp-2 text-[18px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">{seoTitle || w.namePlaceholder}</p>
            <p className="line-clamp-3 text-[14px] leading-snug text-[#4d5156] dark:text-[#bdc1c6]">{seoDescription || "…"}</p>
          </div>
          <p className="px-1 text-[13px] leading-snug opacity-60">
            {setup.seoPlugin ? `${w.googleHint} ${w.plugin(PLUGIN_NAMES[setup.seoPlugin])}.` : w.noPlugin}
          </p>
          {setup.seoPlugin && (
            <>
              <label className="block">
                <span className={`${LABEL} flex justify-between`}>
                  <span>{w.seoTitle}</span>
                  <span className={`tabular-nums ${seoTitle.length > HANDMADE_LIMITS.seoTitle ? "text-orange-600" : ""}`}>
                    {w.chars(seoTitle.length, HANDMADE_LIMITS.seoTitle)}
                  </span>
                </span>
                <input
                  className={INPUT}
                  value={form.seo.title}
                  maxLength={200}
                  placeholder={form.title || w.namePlaceholder}
                  onChange={(e) => set("seo", { ...form.seo, title: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={`${LABEL} flex justify-between`}>
                  <span>{w.seoDescription}</span>
                  <span className={`tabular-nums ${seoDescription.length > HANDMADE_LIMITS.seoDescription ? "text-orange-600" : ""}`}>
                    {w.chars(seoDescription.length, HANDMADE_LIMITS.seoDescription)}
                  </span>
                </span>
                <textarea
                  className={`${INPUT} min-h-[5rem] resize-y leading-snug`}
                  value={form.seo.description}
                  maxLength={500}
                  placeholder={snippet(form.description) || w.descriptionPlaceholder}
                  onChange={(e) => set("seo", { ...form.seo, description: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="block">
            <span className={LABEL}>{w.slug}</span>
            <input
              className={`${INPUT} font-mono text-[15px]`}
              value={form.seo.slug}
              maxLength={HANDMADE_LIMITS.slug}
              placeholder={slugify(form.title) || "nome-del-prodotto"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => set("seo", { ...form.seo, slug: e.target.value })}
              onBlur={() => set("seo", { ...form.seo, slug: slugify(form.seo.slug) })}
            />
          </label>
        </div>
      </div>

      <div className="px-4 pt-5">
        <div className={`${CARD} !space-y-1`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[16px]">{w.visible}</span>
            <Toggle
              className={SWITCH_TARGET}
              checked={form.visible}
              colors={TOGGLE_COLORS}
              aria-label={w.visible}
              onChange={() => set("visible", !form.visible)}
            />
          </div>
          <p className="text-[13px] leading-snug opacity-60">{form.visible ? w.visibleHint : w.hiddenHint}</p>
        </div>
      </div>

      <div className="px-4 pt-5">
        <Button large rounded colors={FILL} className="w-full" disabled={busy} onClick={() => void create()}>
          {busy ? (
            <span className="flex items-center gap-2">
              <Preloader className="!h-5 !w-5" />
              {w.creating}
            </span>
          ) : (
            w.create
          )}
        </Button>
      </div>
      <TabbarSpacer />
    </Page>
  );
}
