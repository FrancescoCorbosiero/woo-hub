"use client";

import * as React from "react";
import { Button, Preloader } from "konsta/react";
import { toast } from "sonner";
import { useI18n } from "@/i18n/provider";
import { HANDMADE_LIMITS } from "@/lib/handmade";
import { removeUploadedPhoto } from "@/server/actions/vetrina-add";
import { FIELD } from "./look";
import { uploadPhoto } from "./photos";

/** One photo in the form: uploaded to the library (its id), or an address the shop downloads. */
export interface FormPhoto {
  key: string;
  /** The library's id, once uploaded. */
  id?: number;
  /** What the tile shows: the library's address, the link, or the phone's own copy while it uploads. */
  url: string;
  /** A link the owner gave (or the code's known photo), downloaded by the shop. */
  link?: boolean;
  status: "uploading" | "done" | "failed";
}

let nextKey = 0;
export const photoKey = () => `p${++nextKey}`;

/**
 * The form's photos: taken or chosen on the phone and uploaded at once, one
 * after the other (a product's dozen shots on a phone's connection), or
 * given as links. The first is the main one; a tap on another puts it first.
 */
export function PhotosField({
  photos,
  onChange,
  uploadable,
  title,
}: {
  photos: FormPhoto[];
  onChange: (change: (current: FormPhoto[]) => FormPhoto[]) => void;
  uploadable: boolean;
  /** The product's name: each photo is filed under it. */
  title: string;
}) {
  const { t } = useI18n();
  const w = t.vetrinaCatalog.shop.handmade;
  const input = React.useRef<HTMLInputElement>(null);
  const [linking, setLinking] = React.useState(!uploadable);
  const [link, setLink] = React.useState("");
  const room = HANDMADE_LIMITS.photos - photos.length;

  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = [...files].slice(0, Math.max(room, 0));
    if (files.length > chosen.length) toast.message(w.tooManyPhotos(HANDMADE_LIMITS.photos));
    const added = chosen.map((file) => ({
      file,
      photo: {
        key: photoKey(),
        url: URL.createObjectURL(file),
        status: "uploading" as const,
      },
    }));
    onChange((current) => [...current, ...added.map((a) => a.photo)]);
    // One at a time: a phone's upload is the narrow part, and the order is kept.
    for (const { file, photo } of added) {
      const answer = await uploadPhoto(file, title || file.name);
      onChange((current) =>
        current.map((p) =>
          p.key !== photo.key
            ? p
            : answer.ok
              ? {
                  ...p,
                  id: answer.id,
                  url: answer.url || p.url,
                  status: "done",
                }
              : { ...p, status: "failed" },
        ),
      );
      if (answer.ok) URL.revokeObjectURL(photo.url);
      else toast.error(`${w.photoFailed}: ${answer.error}`);
    }
  }

  function addLink() {
    const url = link.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      toast.error(w.photoLinkInvalid);
      return;
    }
    if (room <= 0) {
      toast.message(w.tooManyPhotos(HANDMADE_LIMITS.photos));
      return;
    }
    onChange((current) => [...current, { key: photoKey(), url, link: true, status: "done" }]);
    setLink("");
  }

  function remove(photo: FormPhoto) {
    onChange((current) => current.filter((p) => p.key !== photo.key));
    // Uploaded for this product only, which takes it no more: out of the library again.
    if (photo.id != null) void removeUploadedPhoto(photo.id);
  }

  function makeMain(photo: FormPhoto) {
    onChange((current) => [photo, ...current.filter((p) => p.key !== photo.key)]);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo, i) => (
          <div key={photo.key} className="relative aspect-square overflow-hidden rounded-xl bg-black/[0.04] dark:bg-white/10">
            <button
              type="button"
              className="absolute inset-0 block h-full w-full"
              aria-label={i === 0 ? w.main : w.makeMain}
              disabled={i === 0}
              onClick={() => makeMain(photo)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the phone's own copy or the library's: never resized here */}
              <img src={photo.url} alt="" className={`h-full w-full object-cover ${photo.status === "done" ? "" : "opacity-50"}`} />
            </button>
            {photo.status === "uploading" && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <Preloader className="!h-6 !w-6" />
              </span>
            )}
            {photo.status === "failed" && (
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-600/90 px-1 py-0.5 text-center text-[11px] font-semibold text-white">
                {w.photoFailed}
              </span>
            )}
            {i === 0 && photo.status === "done" && (
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {w.main}
              </span>
            )}
            {photo.status !== "uploading" && (
              <button
                type="button"
                aria-label={w.remove}
                onClick={() => remove(photo)}
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-[18px] leading-none text-white active:opacity-60"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {uploadable && room > 0 && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-black/15 text-center text-[13px] font-semibold text-primary active:opacity-60 dark:border-white/20"
          >
            <span>
              <span className="block text-[28px] leading-none">+</span>
              {w.addPhoto}
            </span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="px-1 text-[13px] leading-snug opacity-60">{uploadable ? w.photosHint : w.photosNoUpload}</p>
      {linking ? (
        <div className="flex gap-2">
          <input
            className={`${FIELD} min-w-0 flex-1`}
            value={link}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={w.photoLinkPlaceholder}
            aria-label={w.photoLink}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
          />
          <Button rounded tonal className="!h-auto !w-auto shrink-0 !px-4" onClick={addLink}>
            {w.add}
          </Button>
        </div>
      ) : (
        <button type="button" className="h-11 px-1 text-[14px] text-primary active:opacity-50" onClick={() => setLinking(true)}>
          {w.photoLink}
        </button>
      )}
    </div>
  );
}
