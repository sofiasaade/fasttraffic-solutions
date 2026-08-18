// Internal (non-project) activities — fill technicians' dead time with shop
// work. Stored in job_assignments with a synthetic "internal:" job id, so the
// whole assignment flow (confirm day, tech app, hours) works unchanged.
export const INTERNAL_JOB_PREFIX = "internal:";

export const INTERNAL_ACTIVITIES = [
  { id: "internal:recover-signs", label: "Recover abandoned signs", emoji: "🚧" },
  { id: "internal:organize-shop", label: "Organize signs at the shop", emoji: "🏭" },
  { id: "internal:truck-maintenance", label: "Truck maintenance", emoji: "🔧" },
  { id: "internal:yard-work", label: "Shop / yard work", emoji: "🧹" },
  { id: "internal:errand", label: "Errand / other", emoji: "📦" },
] as const;

export function isInternalJobId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(INTERNAL_JOB_PREFIX);
}

export function internalLabel(id: string | null | undefined): string {
  return (
    INTERNAL_ACTIVITIES.find((a) => a.id === id)?.label ?? "Internal task"
  );
}
