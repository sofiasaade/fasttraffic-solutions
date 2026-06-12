import { describe, it, expect } from "vitest";
import {
  parseSignCount,
  sumSignTallies,
  EMPTY_SIGN_TALLY,
} from "../shared/signCount";

describe("parseSignCount", () => {
  it("returns empty tally for null/empty", () => {
    expect(parseSignCount(null)).toEqual(EMPTY_SIGN_TALLY);
    expect(parseSignCount("")).toEqual(EMPTY_SIGN_TALLY);
    expect(parseSignCount(undefined)).toEqual(EMPTY_SIGN_TALLY);
  });

  it("counts custom signs ONLY when explicitly labeled (Option A)", () => {
    const text = [
      "CA - Construction Ahead\t8",
      "CE - Construction Ends\t8",
      "CUSTOM SIGN\t3",
      "NTL - NARROWS TO THE LEFT\t2",
    ].join("\n");
    const t = parseSignCount(text);
    expect(t.customSigns).toBe(3);
    expect(t.arrowBoards).toBe(0);
    expect(t.messageBoards).toBe(0);
  });

  it("counts arrow boards from ARROW BOARD / AB / DAB", () => {
    const text = [
      "ARROW BOARD\t3",
      "AB - ARROW BOARD 2",
      "DAB - DOUBLE ARROW 1",
      "B - BARRICADES:AL ARROW LEFT 4", // NOT an arrow board -> ignored
    ].join("\n");
    const t = parseSignCount(text);
    expect(t.arrowBoards).toBe(6);
  });

  it("counts message boards from VMB / MESSAGE BOARD / VARIABLE MESSAGE", () => {
    const text = [
      "VMB-Message Board\t2",
      "2 MESSAGE BOARDS",
      "VMB- VARIABLE MESSAGE BOARD 1",
    ].join("\n");
    const t = parseSignCount(text);
    expect(t.messageBoards).toBe(5);
  });

  it("does not classify message boards as arrow boards", () => {
    const t = parseSignCount("VMB-Message Board\t2");
    expect(t.messageBoards).toBe(2);
    expect(t.arrowBoards).toBe(0);
  });

  it("handles leading-quantity format (e.g. '3 X CUSTOM SIGN')", () => {
    const t = parseSignCount("3 X CUSTOM SIGN");
    expect(t.customSigns).toBe(3);
  });

  it("counts a labeled line with no number as 1", () => {
    const t = parseSignCount("CUSTOM SIGN (SIGN ONLY) —");
    expect(t.customSigns).toBe(1);
  });

  it("ignores phase headers", () => {
    const text = [
      "PHASE 1 - FTS-1996-A",
      "CUSTOM SIGN 2",
      "PHASE 2",
      "ARROW BOARD 4",
    ].join("\n");
    const t = parseSignCount(text);
    expect(t.customSigns).toBe(2);
    expect(t.arrowBoards).toBe(4);
  });

  it("sums tallies across jobs", () => {
    const a = parseSignCount("CUSTOM SIGN 2\nARROW BOARD 1");
    const b = parseSignCount("ARROW BOARD 3\nVMB 2");
    const sum = sumSignTallies([a, b]);
    expect(sum).toEqual({ customSigns: 2, arrowBoards: 4, messageBoards: 2 });
  });
});
