/** The catalog list's own inline icons, drawn like ../../icons.tsx (SF-Symbols-like strokes). */

type IconProps = { className?: string };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The homepage: a product or a term shown in one of its sections. */
export function House({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...stroke}>
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
