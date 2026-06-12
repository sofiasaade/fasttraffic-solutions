import { describe, it, expect } from "vitest";
import { needsArrowboard, needsMessageBoard } from "../shared/equipmentSignals";

describe("equipmentSignals", () => {
  it("detects arrowboard from tire emoji in address", () => {
    expect(needsArrowboard("123 Main St \u{1F6DE}")).toBe(true);
  });

  it("detects arrowboard from the word 'tire' (case-insensitive, word boundary)", () => {
    expect(needsArrowboard("Tire shop lane")).toBe(true);
    expect(needsArrowboard("By the TIRE depot")).toBe(true);
    // should not match substrings like 'entire' / 'retire'
    expect(needsArrowboard("Entire block closure")).toBe(false);
    expect(needsArrowboard("Retirement Ave")).toBe(false);
  });

  it("detects message board from TV emoji in address", () => {
    expect(needsMessageBoard("456 Center Rd \u{1F4FA}")).toBe(true);
  });

  it("does not flag a plain address", () => {
    expect(needsArrowboard("789 Quiet Crescent")).toBe(false);
    expect(needsMessageBoard("789 Quiet Crescent")).toBe(false);
  });

  it("handles null/empty safely", () => {
    expect(needsArrowboard(null)).toBe(false);
    expect(needsArrowboard("")).toBe(false);
    expect(needsMessageBoard(undefined)).toBe(false);
  });

  it("an address can require both", () => {
    const addr = "1 Both Ave \u{1F6DE} \u{1F4FA}";
    expect(needsArrowboard(addr)).toBe(true);
    expect(needsMessageBoard(addr)).toBe(true);
  });
});
