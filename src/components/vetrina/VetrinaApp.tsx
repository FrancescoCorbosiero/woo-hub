"use client";

import * as React from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { App } from "konsta/react";
import { Toaster } from "sonner";
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
  const tab = tabOf(usePathname());
  // What the back buttons go back to (./use-back.ts).
  useScreenTrail();
  // The tab bar's room, for every page's TabbarSpacer: 0 where it is hidden.
  const frameStyle = { "--vetrina-tabbar": tab ? TABBAR_SPACE : "0px" } as React.CSSProperties;
  return (
    <div className="vetrina-backdrop fixed inset-0 z-0 overflow-hidden">
      <div className="vetrina-frame relative mx-auto h-full w-full" style={frameStyle}>
        <StandaloneContext.Provider value={standalone}>
          <SheetMountContext.Provider value={mount}>
            <App theme={theme} safeAreas className="!min-h-0">
              {children}
              <VetrinaTabbar active={tab} />
              <div ref={setMount} />
            </App>
          </SheetMountContext.Provider>
        </StandaloneContext.Provider>
        <Toaster
          position="top-center"
          offset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
          mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
          toastOptions={{ className: "!rounded-2xl !text-[15px]" }}
          visibleToasts={2}
        />
      </div>
    </div>
  );
}
