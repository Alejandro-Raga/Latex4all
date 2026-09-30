import { describe, expect, it } from "vitest";
import { itemForCitekey, itemsByTitle } from "./cite-match";
import type { LibraryItem } from "./zotero-library";

const item = (key: string, title: string, creators: string, year: string) =>
  ({ key, title, creators, year, date: year, collections: [] }) as LibraryItem;

const items = {
  A: item(
    "A",
    "The Simple Economics of Basic Scientific Research",
    "Nelson",
    "1959",
  ),
  B: item(
    "B",
    "Absorptive Capacity: A New Perspective on Learning and Innovation",
    "Cohen, Levinthal",
    "1990",
  ),
  C: item("C", "Why Firms Publish", "Rotolo, Camerani", "2022"),
  D: item("D", "Another Paper", "Rotolo", "2022"),
};
const ctx = (extra = {}) => ({
  items,
  byTitle: itemsByTitle(Object.values(items)),
  itemKeys: new Map<string, string>(),
  ...extra,
});

describe("itemForCitekey", () => {
  it("uses the synced record, then the vault note's item", () => {
    expect(
      itemForCitekey("x", ctx({ itemKeys: new Map([["x", "C"]]) }))?.key,
    ).toBe("C");
    expect(itemForCitekey("x", ctx({ noteItemKey: "D" }))?.key).toBe("D");
  });

  it("matches the title whole or without its subtitle", () => {
    expect(
      itemForCitekey(
        "k",
        ctx({ bibTitle: "The simple economics of basic scientific research" }),
      )?.key,
    ).toBe("A");
    expect(
      itemForCitekey("k", ctx({ bibTitle: "Absorptive capacity" })),
    ).toBeUndefined();
    expect(
      itemForCitekey(
        "k",
        ctx({ bibTitle: "Absorptive Capacity: A New Perspective" }),
      )?.key,
    ).toBe("B");
  });

  it("falls back on first author and year when only one fits", () => {
    expect(itemForCitekey("cohen_absorptive_1990", ctx())?.key).toBe("B");
    expect(itemForCitekey("nelson1959", ctx())?.key).toBe("A");
    // Two Rotolo papers from 2022: no guess.
    expect(itemForCitekey("rotolo_why_2022", ctx())).toBeUndefined();
  });
});
