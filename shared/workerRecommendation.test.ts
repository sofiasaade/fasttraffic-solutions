import { describe, it, expect } from "vitest";
import {
  normalizeDifficulty,
  minLevelRankFor,
  scoreTechnician,
  recommendWorkers,
  type RecoTechnician,
} from "./workerRecommendation";

describe("normalizeDifficulty", () => {
  it("strips Airtable keycap digits and emoji", () => {
    expect(normalizeDifficulty("3️⃣ High")).toBe("high");
    expect(normalizeDifficulty("2️⃣ Low")).toBe("low");
    expect(normalizeDifficulty("Medium")).toBe("medium");
  });
  it("buckets synonyms", () => {
    expect(normalizeDifficulty("Critical")).toBe("high");
    expect(normalizeDifficulty("Moderate")).toBe("medium");
    expect(normalizeDifficulty("Easy")).toBe("low");
  });
  it("handles null / empty as unknown", () => {
    expect(normalizeDifficulty(null)).toBe("unknown");
    expect(normalizeDifficulty("")).toBe("unknown");
    expect(normalizeDifficulty("???")).toBe("unknown");
  });
});

describe("minLevelRankFor", () => {
  it("requires senior for high, junior for medium, any for low/unknown", () => {
    expect(minLevelRankFor("high")).toBe(3);
    expect(minLevelRankFor("medium")).toBe(2);
    expect(minLevelRankFor("low")).toBe(1);
    expect(minLevelRankFor("unknown")).toBe(1);
  });
});

const senior: RecoTechnician = {
  airtableName: "senior1",
  displayName: "Senior One",
  experienceLevel: "senior",
};
const junior: RecoTechnician = {
  airtableName: "junior1",
  displayName: "Junior One",
  experienceLevel: "junior",
};
const apprentice: RecoTechnician = {
  airtableName: "appr1",
  displayName: "Appr One",
  experienceLevel: "apprentice",
};

describe("scoreTechnician level fit", () => {
  it("high impact: senior is a great match, junior/apprentice are warnings", () => {
    expect(scoreTechnician(senior, "high").quality).toBe("great");
    expect(scoreTechnician(senior, "high").levelOk).toBe(true);
    expect(scoreTechnician(junior, "high").levelOk).toBe(false);
    expect(scoreTechnician(junior, "high").quality).toBe("warn");
    expect(scoreTechnician(apprentice, "high").levelOk).toBe(false);
  });

  it("medium impact: junior+ ok, apprentice is a warning", () => {
    expect(scoreTechnician(junior, "medium").levelOk).toBe(true);
    expect(scoreTechnician(senior, "medium").levelOk).toBe(true);
    expect(scoreTechnician(apprentice, "medium").levelOk).toBe(false);
  });

  it("low impact: any level is acceptable", () => {
    expect(scoreTechnician(apprentice, "low").levelOk).toBe(true);
    expect(scoreTechnician(junior, "low").levelOk).toBe(true);
    expect(scoreTechnician(senior, "low").levelOk).toBe(true);
  });
});

describe("scoreTechnician availability/booking", () => {
  it("unavailable demotes to warn even when level fits", () => {
    const r = scoreTechnician(
      { ...senior, unavailable: true },
      "high",
    );
    expect(r.unavailable).toBe(true);
    expect(r.quality).toBe("warn");
    expect(r.reasons.some((x) => /unavailable/i.test(x))).toBe(true);
  });

  it("already booked demotes score and reads ok (not great)", () => {
    const r = scoreTechnician({ ...senior, alreadyBooked: true }, "high");
    expect(r.alreadyBooked).toBe(true);
    expect(r.quality).toBe("ok");
  });
});

describe("recommendWorkers ranking", () => {
  it("ranks the qualified, available worker first for a High job", () => {
    const { difficulty, recommendations } = recommendWorkers(
      [
        junior,
        { ...senior, unavailable: false },
        apprentice,
      ],
      "3️⃣ High",
    );
    expect(difficulty).toBe("high");
    expect(recommendations[0].airtableName).toBe("senior1");
    // The junior/apprentice should not be excluded — still present (override).
    expect(recommendations).toHaveLength(3);
  });

  it("does not exclude anyone (override-friendly)", () => {
    const { recommendations } = recommendWorkers(
      [
        { ...senior, unavailable: true },
        { ...junior, alreadyBooked: true },
      ],
      "High",
    );
    expect(recommendations).toHaveLength(2);
  });
});
