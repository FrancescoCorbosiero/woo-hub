/**
 * Room at the bottom of a Vetrina page for the tab bar, so the last row is
 * never under it. VetrinaTabbar sets --vetrina-tabbar to its height, the
 * phone's safe area included, and to 0 where it is hidden.
 */
export function TabbarSpacer() {
  return <div aria-hidden className="h-[calc(var(--vetrina-tabbar,0px)+16px)] shrink-0" />;
}
