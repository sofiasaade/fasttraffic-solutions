import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ChangeType = "new" | "cancelled" | "postponed" | "modified";

export type JobChangeRow = {
  id: number;
  detectedDate: string;
  airtableJobId: string;
  requestId: string | null;
  company: string | null;
  changeType: ChangeType;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  startDate: string | null;
  acknowledgedAt: string | Date | null;
  createdAt: string | Date;
};

export const CHANGE_META: Record<
  ChangeType,
  { label: string; dot: string; badge: string }
> = {
  new: {
    label: "New",
    dot: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  cancelled: {
    label: "Cancelled",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-800 border-red-200",
  },
  postponed: {
    label: "Postponed",
    dot: "bg-amber-500",
    badge: "bg-amber-100 text-amber-900 border-amber-200",
  },
  modified: {
    label: "Modified",
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
  },
};

/** Priority when a job has several change types — show the most urgent. */
const PRIORITY: ChangeType[] = ["cancelled", "postponed", "modified", "new"];

export function topChangeType(changes: JobChangeRow[]): ChangeType | null {
  for (const t of PRIORITY) {
    if (changes.some((c) => c.changeType === t)) return t;
  }
  return null;
}

function describe(c: JobChangeRow): string {
  switch (c.changeType) {
    case "new":
      return "New job in the 5-day window";
    case "cancelled":
      return c.fieldName === "Removed"
        ? "Removed from Airtable"
        : c.fieldName === "Out of window"
          ? "Moved out of the window"
          : `Cancelled (${c.oldValue ?? "?"} → ${c.newValue ?? "?"})`;
    case "postponed":
      return `Start date ${c.oldValue ?? "?"} → ${c.newValue ?? "?"}`;
    case "modified":
      return `${c.fieldName}: ${c.oldValue ?? "—"} → ${c.newValue ?? "—"}`;
    default:
      return "Changed";
  }
}

/** Compact badge for a job row (Scheduler / Dispatch). Hover for details. */
export function ChangeBadge({
  changes,
  className,
}: {
  changes: JobChangeRow[];
  className?: string;
}) {
  if (!changes || changes.length === 0) return null;
  const top = topChangeType(changes);
  if (!top) return null;
  const meta = CHANGE_META[top];
  const extra = changes.length > 1 ? ` +${changes.length - 1}` : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            meta.badge,
            className,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
          {extra}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-1 text-xs">
          {changes.slice(0, 6).map((c) => (
            <li key={c.id}>{describe(c)}</li>
          ))}
          {changes.length > 6 && (
            <li className="opacity-70">+{changes.length - 6} more…</li>
          )}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export { describe as describeChange };
