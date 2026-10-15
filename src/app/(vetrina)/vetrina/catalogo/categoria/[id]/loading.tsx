import { TermSkeleton } from "@/components/vetrina/catalog/term/TermSkeleton";

/** Shaped like the screen it stands in for, so nothing jumps when it arrives. */
export default function Loading() {
  return <TermSkeleton taxonomy="category" />;
}
