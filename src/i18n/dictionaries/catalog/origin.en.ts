import type { originIt } from "./origin.it";

export const originEn: typeof originIt = {
  label: "Source",
  all: "All",
  short: {
    goldensneakers: "GS",
    kicksdb: "KicksDB",
    delisted: "Ex GS",
    woo: "Store only",
  },
  name: {
    goldensneakers: "GoldenSneakers",
    kicksdb: "KicksDB",
    delisted: "Ex GoldenSneakers",
    woo: "Store only",
  },
  aria: (name: string) => `Source: ${name}`,
  hint: {
    goldensneakers: "The supplier's feed carries it and decides whether it is in the shop. It can't be deleted: the feed would put it back.",
    kicksdb: "You added it from the Hub, priced from the market (StockX). If you no longer sell it, you can delete it.",
    delisted: "The supplier no longer sells it: the Hub keeps it sold out. You can delete it.",
    woo: "Made in the shop (WordPress): no price list updates it. If you no longer sell it, you can delete it.",
  },
};
