"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { App } from "konsta/react";
import { Toaster } from "sonner";
import { OperationsProvider } from "./catalog/act/operations";
import { SheetMountContext, StandaloneContext } from "./sheet-mount";
import { useScreenTrail } from "./use-back";
import { TABBAR_SPACE, VetrinaTabbar, tabOf } from "./VetrinaTabbar";

/**
 * The Vetrina's app shell: a Konsta App filling the whole screen (the phone's
 * safe areas included), above the Hub's page backdrop, plus the toasts that
 * carry "Annulla" after every move and the tab bar (Homepage, Catalogo). On a
 * desktop it is a phone-width column in the middle of the screen, and
 * everything that floats (sheets, dialogs, action sheets, toasts, the tab
 * bar) opens inside that column.
 */
export function VetrinaApp({
  theme,
  standalone = false,
  children,
}: {
  theme: "ios" | "material";
  /** Served on the Vetrina's own address (VETRINA_HOST). */
  standalone?: boolean;
  children: ReactNode;
}) {
  const [mount, setMount] = React.useState<HTMLDivElement | null>(null);
  const dark = useDarkClass();
  const tab = tabOf(usePathname());
  // What the back buttons go back to (./use-back.ts).
  useScreenTrail();
  // The tab bar's room, for every page's TabbarSpacer: 0 where it is hidden. The catalog's
  // progress pill adds its own to --vetrina-tabbar while it shows (catalog/act/operations.tsx).
  const bar = tab ? TABBAR_SPACE : "0px";
  const frameStyle = { "--vetrina-tabbar": bar, "--vetrina-tabbar-bar": bar } as React.CSSProperties;
  return (
    <div className="vetrina-backdrop fixed inset-0 z-0 overflow-hidden">
      <div className="vetrina-frame relative mx-auto h-full w-full" style={frameStyle}>
        <StandaloneContext.Provider value={standalone}>
          <SheetMountContext.Provider value={mount}>
            <App theme={theme} safeAreas className="!min-h-0">
              {/* The catalog's actions, followed wherever the owner goes: progress, "Annulla", the log. */}
              <OperationsProvider>
                {children}
                <VetrinaTabbar active={tab} />
              </OperationsProvider>
              <div ref={setMount} />
            </App>
          </SheetMountContext.Provider>
        </StandaloneContext.Provider>
        {/* Below the navbar (44px + its gap): a toast with "Annulla" must not cover the back button or "⋯" for its 10 seconds. */}
        <Toaster
          // The app's dark mode is a class on <html> (the theme toggle), which sonner does not read on its own.
          theme={dark ? "dark" : "light"}
          position="top-center"
          offset={{ top: "calc(env(safe-area-inset-top) + 56px)" }}
          mobileOffset={{ top: "calc(env(safe-area-inset-top) + 56px)" }}
          toastOptions={{
            className: "!rounded-2xl !text-[15px]",
            // "Annulla" is a 44px target, as every tap in the app; the margins it eats keep the toast as tall as before.
            classNames: { actionButton: "!-my-2.5 !h-11 !rounded-xl !px-4 !text-[15px] !font-semibold" },
          }}
          visibleToasts={2}
        />
      </div>
    </div>
  );
}

/** Whether <html> carries the "dark" class — the theme toggle's — followed as it changes. */
function useDarkClass(): boolean {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => watch.disconnect();
  }, []);
  return dark;
}
