// Shared helpers to categorize a job's Airtable "Setup Duration" and color it
// consistently across the Scheduler week grid and the Day Timeline view.
//   24 Hours -> purple, Daily/Daytime -> amber, Night -> blue, else neutral.

export type DurationCategory = "24h" | "daily" | "night" | "unknown";

export function durationCategory(
  value: string | null | undefined,
): DurationCategory {
  const v = (value ?? "").toLowerCase();
  if (/24\s*hour/.test(v)) return "24h";
  if (/night/.test(v)) return "night";
  if (/daily|daytime|day\s*time/.test(v)) return "daily";
  return "unknown";
}

// Tailwind classes for the project column header accent by category.
export function categoryHeaderClasses(cat: DurationCategory): {
  bar: string;
  chip: string;
  label: string;
} {
  switch (cat) {
    case "24h":
      return {
        bar: "bg-purple-500/70",
        chip: "bg-purple-100 text-purple-800 border-purple-200",
        label: "24 Hours",
      };
    case "night":
      return {
        bar: "bg-blue-500/70",
        chip: "bg-blue-100 text-blue-800 border-blue-200",
        label: "Night",
      };
    case "daily":
      return {
        bar: "bg-amber-500/70",
        chip: "bg-amber-100 text-amber-800 border-amber-200",
        label: "Daily",
      };
    default:
      return {
        bar: "bg-slate-400/60",
        chip: "bg-slate-100 text-slate-700 border-slate-200",
        label: "—",
      };
  }
}

// Soft column background tint for the timeline body, by category.
export function categoryColumnTint(cat: DurationCategory): string {
  switch (cat) {
    case "24h":
      return "bg-purple-500/[0.04]";
    case "night":
      return "bg-blue-500/[0.04]";
    case "daily":
      return "bg-amber-400/[0.05]";
    default:
      return "bg-transparent";
  }
}

// Pull a "HH:MM-HH:MM" or "(time window)" hint from the setup duration text.
export function extractTimeWindow(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/\(([^)]*\d[^)]*)\)/);
  return m ? m[1].trim() : null;
}
