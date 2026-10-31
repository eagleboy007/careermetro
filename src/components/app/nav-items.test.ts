import { describe, expect, it } from "vitest";
import { MENU_NAV, TAB_NAV, TOP_NAV, withJunction } from "./nav-items";

describe("Junction in the nav (FR-61)", () => {
  it("keeps Junction as Soon while JUNCTION_ENABLED is off, exactly as before", () => {
    expect(TOP_NAV.find((i) => i.key === "junction")?.built).toBe(false);
    expect(withJunction(TOP_NAV, false)).toEqual(TOP_NAV);
    expect(withJunction(TAB_NAV, false)).toEqual(TAB_NAV);
  });

  it("makes only Junction a link while it is on", () => {
    const on = withJunction(TOP_NAV, true);
    expect(on.find((i) => i.key === "junction")).toMatchObject({ built: true, href: "/junction" });
    expect(on.filter((i) => i.key !== "junction")).toEqual(TOP_NAV.filter((i) => i.key !== "junction"));
    expect(withJunction(TAB_NAV, true).find((i) => i.key === "junction")?.built).toBe(true);
    expect(withJunction(MENU_NAV, true)).toEqual(MENU_NAV);
  });
});
