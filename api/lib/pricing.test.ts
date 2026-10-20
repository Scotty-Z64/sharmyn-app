import { describe, expect, it } from "vitest";
import { COLLECTIONS, inCollection, productGender } from "../../src/lib/store";
import {
  fulfilmentStage,
  lockerBoxLabel,
  lockerParcels,
  openingSpecialForCart,
  orderLockerLabel,
  pudoDeliveryFee,
} from "../../contracts/types";

describe("locker delivery pricing (Medium R150 for 1-2 items, Large R170 for 3-4)", () => {
  it.each([
    [1, 150],
    [2, 150],
    [3, 170],
    [4, 170],
    [5, 320], // Large + Medium
    [6, 320],
    [7, 340], // 2 x Large
    [8, 340],
    [9, 490],
    [10, 490],
  ])("%i items cost R%i", (items, fee) => {
    expect(pudoDeliveryFee(items)).toBe(fee);
  });

  it("never charges less than one locker, even for a nonsense quantity", () => {
    expect(pudoDeliveryFee(0)).toBe(150);
    expect(pudoDeliveryFee(-3)).toBe(150);
  });

  it("splits an order across lockers without losing or inventing items", () => {
    for (let n = 1; n <= 40; n++) {
      const parcels = lockerParcels(n);
      expect(parcels.reduce((s, p) => s + p.items, 0)).toBe(n);
      expect(parcels.every((p) => p.items >= 1 && p.items <= (p.size === "medium" ? 2 : 4))).toBe(true);
    }
  });

  it("is never dearer than putting everything in Large lockers", () => {
    for (let n = 1; n <= 40; n++) {
      expect(pudoDeliveryFee(n)).toBeLessThanOrEqual(Math.ceil(n / 4) * 170);
    }
  });

  it("labels the locker size", () => {
    expect(lockerBoxLabel(1)).toBe("Medium locker");
    expect(lockerBoxLabel(3)).toBe("Large locker");
    expect(lockerBoxLabel(5)).toBe("Large locker + Medium locker");
    expect(lockerBoxLabel(8)).toBe("2 × Large locker");
  });

  it("only labels orders that were really charged by locker size", () => {
    const items = [{ qty: 2 }];
    expect(orderLockerLabel({ items, delivery: { method: "pudo", fee: 150 } })).toBe("Medium locker");
    // an older order charged under the earlier R100-per-item rule keeps no locker label
    expect(orderLockerLabel({ items, delivery: { method: "pudo", fee: 200 } })).toBeNull();
    expect(orderLockerLabel({ items, delivery: { method: "door", fee: 150 } })).toBeNull();
    expect(orderLockerLabel({ items, delivery: null })).toBeNull();
  });
});

describe("Opening Special (R100 off each pair of sneakers, R50 off each handbag, from the second)", () => {
  it("gives nothing for a single item", () => {
    expect(openingSpecialForCart([{ category: "sneakers", qty: 1 }], true)).toEqual([0]);
    expect(openingSpecialForCart([{ category: "handbags", qty: 1 }], true)).toEqual([0]);
  });

  it("gives R100 off every pair once there are two or more sneakers", () => {
    expect(openingSpecialForCart([{ category: "sneakers", qty: 2 }], true)).toEqual([100]);
  });

  it("counts a category across separate lines", () => {
    expect(
      openingSpecialForCart(
        [
          { category: "sneakers", qty: 1 },
          { category: "sneakers", qty: 1 },
        ],
        true
      )
    ).toEqual([100, 100]);
  });

  it("gives R50 off every handbag from the second", () => {
    expect(openingSpecialForCart([{ category: "handbags", qty: 3 }], true)).toEqual([50]);
  });

  it("does not mix categories, and ignores categories with no special", () => {
    expect(
      openingSpecialForCart(
        [
          { category: "sneakers", qty: 1 },
          { category: "handbags", qty: 1 },
          { category: "bags", qty: 2 },
        ],
        true
      )
    ).toEqual([0, 0, 0]);
  });

  it("gives nothing when the owner has switched the special off", () => {
    expect(openingSpecialForCart([{ category: "sneakers", qty: 4 }], false)).toEqual([0]);
  });
});

describe("fulfilment stages", () => {
  const base = { paymentStatus: "paid" as const, supplierOrderedAt: null, stockReceivedAt: null, trackingSetAt: null };
  it("walks through the pipeline in order", () => {
    expect(fulfilmentStage({ ...base, paymentStatus: "unpaid" })).toBe("awaiting_payment");
    expect(fulfilmentStage(base)).toBe("awaiting_supplier");
    expect(fulfilmentStage({ ...base, supplierOrderedAt: "2026-10-01" })).toBe("awaiting_stock");
    expect(fulfilmentStage({ ...base, supplierOrderedAt: "2026-10-01", stockReceivedAt: "2026-10-02" })).toBe("ready_to_pack");
    expect(fulfilmentStage({ ...base, supplierOrderedAt: "2026-10-01", stockReceivedAt: "2026-10-02", trackingSetAt: "2026-10-03" })).toBe("packed");
  });
});

describe("storefront ranges (Shoes, Women Sneakers, Men Sneakers, then the rest)", () => {
  it("lists the ranges in the order the shop asked for", () => {
    expect(COLLECTIONS.map((c) => c.label)).toEqual(["Shoes", "Women Sneakers", "Men Sneakers", "Jewellery", "Handbags", "Bags", "Clothing"]);
  });
  it("counts a sneaker with no gender as women", () => {
    expect(productGender({})).toBe("women");
    expect(productGender({ gender: null })).toBe("women");
    expect(productGender({ gender: "men" })).toBe("men");
  });
  it("puts each sneaker in exactly one of the two ranges", () => {
    const women = COLLECTIONS.find((c) => c.key === "womens-sneakers")!;
    const men = COLLECTIONS.find((c) => c.key === "mens-sneakers")!;
    const unset = { category: "sneakers" as const };
    const man = { category: "sneakers" as const, gender: "men" as const };
    expect(inCollection(unset, women)).toBe(true);
    expect(inCollection(unset, men)).toBe(false);
    expect(inCollection(man, women)).toBe(false);
    expect(inCollection(man, men)).toBe(true);
  });
  it("keeps other categories out of the sneaker ranges and uses their own range", () => {
    const women = COLLECTIONS.find((c) => c.key === "womens-sneakers")!;
    const handbags = COLLECTIONS.find((c) => c.key === "handbags")!;
    expect(inCollection({ category: "handbags" as const }, women)).toBe(false);
    expect(inCollection({ category: "handbags" as const }, handbags)).toBe(true);
    expect(inCollection({ category: "bags" as const }, handbags)).toBe(false);
  });
});
