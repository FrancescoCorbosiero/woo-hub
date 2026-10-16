import { attempt, readHome } from "@/server/vetrina/service";
import { HomeScreen } from "@/components/vetrina/HomeScreen";

export const dynamic = "force-dynamic";

/**
 * "La tua homepage", from the homepage the screens share (home-cache.ts):
 * read from the site at most once a minute, again after our own changes and on ↻.
 */
export default async function VetrinaPage() {
  const result = await attempt(() => readHome());
  return <HomeScreen result={result} />;
}
