/**
 * Worker recommendation engine (pure, override-friendly).
 *
 * Difficulty comes from the Airtable `impact` field (e.g. "3️⃣ High", "Medium",
 * "2️⃣ Low"). We normalize it to a severity tier, then rank technicians by:
 *   1. Level fit for the job difficulty
 *      - High   -> Senior recommended (Junior/Apprentice = level mismatch)
 *      - Medium -> Junior or Senior   (Apprentice = level mismatch)
 *      - Low    -> any level (Apprentice OK)
 *   2. Availability on the target date(s) (unavailable = strong demotion)
 *   3. Not already booked that day (double-booked = strong demotion)
 *
 * IMPORTANT: this only ranks/annotates — it never excludes a worker. The
 * coordinator can always override and pick anyone.
 */

export type ExperienceLevel = "apprentice" | "junior" | "senior";
export type Difficulty = "high" | "medium" | "low" | "unknown";

export interface RecoTechnician {
  airtableName: string;
  displayName: string;
  experienceLevel: ExperienceLevel;
  /** Number of safety certificates on file (light tie-breaker). */
  certificateCount?: number;
  /** True if the technician is unavailable on the target date. */
  unavailable?: boolean;
  /** True if already assigned to another job on the same date. */
  alreadyBooked?: boolean;
}

export type MatchQuality = "great" | "ok" | "warn";

export interface Recommendation {
  airtableName: string;
  displayName: string;
  experienceLevel: ExperienceLevel;
  /** 0..100, higher is a better match. */
  score: number;
  quality: MatchQuality;
  /** True when the level satisfies the job difficulty requirement. */
  levelOk: boolean;
  unavailable: boolean;
  alreadyBooked: boolean;
  /** Short human-readable reasons for the badge/tooltip. */
  reasons: string[];
}

const LEVEL_RANK: Record<ExperienceLevel, number> = {
  apprentice: 1,
  junior: 2,
  senior: 3,
};

/**
 * Strip Airtable keycap digits / emoji and lowercase, then bucket into a tier.
 * Examples: "3️⃣ High" -> high, "2️⃣ Low" -> low, "Moderate" -> medium.
 */
export function normalizeDifficulty(impact: string | null | undefined): Difficulty {
  if (!impact) return "unknown";
  const v = impact
    .replace(/[0-9\uFE0F\u20E3#*]/g, "")
    .replace(/^[\s.\-:]+/, "")
    .trim()
    .toLowerCase();
  if (!v) return "unknown";
  if (/(critical|severe|extreme|high|hard|major)/.test(v)) return "high";
  if (/(med|moderate)/.test(v)) return "medium";
  if (/(low|easy|minor)/.test(v)) return "low";
  return "unknown";
}

/** Minimum level rank recommended for a difficulty tier. */
export function minLevelRankFor(difficulty: Difficulty): number {
  switch (difficulty) {
    case "high":
      return LEVEL_RANK.senior; // Senior
    case "medium":
      return LEVEL_RANK.junior; // Junior+
    case "low":
    case "unknown":
    default:
      return LEVEL_RANK.apprentice; // any
  }
}

export function levelLabel(level: ExperienceLevel): string {
  return level === "senior"
    ? "Senior"
    : level === "apprentice"
      ? "Apprentice"
      : "Junior";
}

function difficultyLabel(d: Difficulty): string {
  return d === "high" ? "High" : d === "medium" ? "Medium" : d === "low" ? "Low" : "Unknown";
}

/**
 * Score a single technician against a job difficulty + their day state.
 * Returns a Recommendation with score, quality, and reasons.
 */
export function scoreTechnician(
  tech: RecoTechnician,
  difficulty: Difficulty,
): Recommendation {
  const minRank = minLevelRankFor(difficulty);
  const rank = LEVEL_RANK[tech.experienceLevel];
  const levelOk = rank >= minRank;
  const unavailable = !!tech.unavailable;
  const alreadyBooked = !!tech.alreadyBooked;

  let score = 50;
  const reasons: string[] = [];

  // Level fit.
  if (difficulty === "unknown") {
    reasons.push("No impact set — any level fits");
  } else if (levelOk) {
    score += 30;
    // Reward an exact match more than over-qualification so Seniors aren't
    // wastefully steered to Low jobs, but never penalize heavily.
    if (rank === minRank) {
      score += 10;
      reasons.push(`${levelLabel(tech.experienceLevel)} fits ${difficultyLabel(difficulty)} impact`);
    } else {
      reasons.push(`${levelLabel(tech.experienceLevel)} exceeds ${difficultyLabel(difficulty)} impact`);
    }
  } else {
    score -= 35;
    reasons.push(
      `${difficultyLabel(difficulty)} impact recommends ${
        minRank === LEVEL_RANK.senior ? "Senior" : "Junior or higher"
      } (this tech is ${levelLabel(tech.experienceLevel)})`,
    );
  }

  // Availability.
  if (unavailable) {
    score -= 40;
    reasons.push("Marked unavailable that day");
  }
  if (alreadyBooked) {
    score -= 25;
    reasons.push("Already booked on another job that day");
  }

  // Light tie-breaker: certificates on file.
  if (tech.certificateCount && tech.certificateCount > 0) {
    score += Math.min(tech.certificateCount, 5);
  }

  score = Math.max(0, Math.min(100, score));

  let quality: MatchQuality;
  if (!levelOk || unavailable) quality = "warn";
  else if (alreadyBooked || difficulty === "unknown") quality = "ok";
  else quality = "great";

  return {
    airtableName: tech.airtableName,
    displayName: tech.displayName,
    experienceLevel: tech.experienceLevel,
    score,
    quality,
    levelOk,
    unavailable,
    alreadyBooked,
    reasons,
  };
}

/**
 * Rank a list of technicians for a job. Sorted best-first. Never filters
 * anyone out — coordinators can override.
 */
export function recommendWorkers(
  technicians: RecoTechnician[],
  impact: string | null | undefined,
): { difficulty: Difficulty; recommendations: Recommendation[] } {
  const difficulty = normalizeDifficulty(impact);
  const recommendations = technicians
    .map((t) => scoreTechnician(t, difficulty))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable secondary ordering by name.
      return a.displayName.localeCompare(b.displayName);
    });
  return { difficulty, recommendations };
}
