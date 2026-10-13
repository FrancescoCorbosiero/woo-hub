/**
 * The catalog's own inline icons, drawn like ../../icons.tsx (SF-Symbols-like
 * strokes): one set for the catalog's home, its lists, the product sheet and
 * the tab bar, so a thing looks the same wherever it shows.
 */

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The homepage: a product or a term shown in one of its sections. Named for screen readers when it stands alone. */
export function House({ className, label }: IconProps & { label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      {...stroke}
    >
      <path d="M3.5 10.5 12 3.5l8.5 7M5.5 9v10.5h4.5v-6h4v6h4.5V9" />
    </svg>
  );
}

/** A product with no photo on the store. */
export function NoPhoto({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke} strokeWidth={1.6}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m3.5 16 4.5-4.5 4 4 2.5-2.5 6 6M3 3l18 18" />
    </svg>
  );
}

/** Up and down arrows: the list's order. */
export function SortArrows({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5" />
    </svg>
  );
}

export function Check({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke} strokeWidth={2.4}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/** A box: the term's products, counted. */
export function Stack({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3ZM3.5 12 12 16.5l8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </svg>
  );
}

export function Search({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.5-4.5" />
    </svg>
  );
}

/** A box with nothing left in it: sold out. */
export function Empty({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 18 12-12" />
    </svg>
  );
}

/** A price tag: on sale. */
export function Tag({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0l-8.3-8.3Z" />
      <circle cx="8.2" cy="8.2" r="1.4" />
    </svg>
  );
}

/** A folder: a category (in the quick views, the lack of one). */
export function Folder({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5V7Z" />
    </svg>
  );
}

/** A page with a pencil: a draft, not on the site. */
export function Draft({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
      <path d="M13 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M17 3.2a1.6 1.6 0 0 1 2.3 2.3l-6 6-3 .8.8-3 5.9-6.1Z" />
    </svg>
  );
}
