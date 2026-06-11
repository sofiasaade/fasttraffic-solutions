import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Loader2,
  ChevronDown,
  CalendarOff,
  CalendarClock,
} from "lucide-react";

type Quality = "great" | "ok" | "warn";

function levelBadgeCls(level: string) {
  return level === "senior"
    ? "bg-blue-100 text-blue-700"
    : level === "apprentice"
      ? "bg-amber-100 text-amber-700"
      : "bg-slate-100 text-slate-600";
}
function levelLabel(level: string) {
  return level === "senior"
    ? "Senior"
    : level === "apprentice"
      ? "Apprentice"
      : "Junior";
}

function difficultyMeta(d: string) {
  switch (d) {
    case "high":
      return { label: "High", cls: "bg-orange-100 text-orange-800 border-orange-200" };
    case "medium":
      return { label: "Medium", cls: "bg-amber-100 text-amber-800 border-amber-200" };
    case "low":
      return { label: "Low", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    default:
      return { label: "Unknown", cls: "bg-slate-100 text-slate-700 border-slate-200" };
  }
}

/**
 * Suggestion panel for a job. Ranks technicians by impact-fit + availability.
 * Suggestion only — coordinators drag any worker from the Workers panel to
 * override.
 */
export function RecommendedWorkers({
  jobId,
  date,
  defaultOpen = false,
}: {
  jobId: string;
  date?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading } = trpc.coordinator.recommendWorkers.useQuery(
    { jobId, date },
    { enabled: open },
  );

  const diff = data ? difficultyMeta(data.difficulty) : null;

  return (
    <div className="rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Recommended workers
          {diff && (
            <span
              className={cn(
                "ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
                diff.cls,
              )}
            >
              {diff.label} impact
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-3 pb-3">
          {isLoading ? (
            <div className="py-4 flex justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.recommendations.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No technicians available to recommend.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground mb-2">
                Sorted by best match. Suggestions only — drag any worker from the
                Workers panel to override.
              </p>
              <ul className="space-y-1.5">
                {data.recommendations.slice(0, 8).map((r) => (
                  <RecoRow key={r.airtableName} r={r} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RecoRow({
  r,
}: {
  r: {
    airtableName: string;
    displayName: string;
    experienceLevel: string;
    quality: Quality;
    levelOk: boolean;
    unavailable: boolean;
    alreadyBooked: boolean;
    reasons: string[];
  };
}) {
  const qualityIcon =
    r.quality === "great" ? (
      <CheckCircle2 className="size-4 text-emerald-600" />
    ) : r.quality === "ok" ? (
      <CheckCircle2 className="size-4 text-amber-500" />
    ) : (
      <AlertTriangle className="size-4 text-amber-600" />
    );

  return (
    <li
      title={r.reasons.join(" · ")}
      className={cn(
        "flex items-start gap-2 rounded-md border px-2 py-1.5",
        r.quality === "great"
          ? "border-emerald-200 bg-emerald-50/60"
          : r.quality === "warn"
            ? "border-amber-200 bg-amber-50/50"
            : "border-border bg-background",
      )}
    >
      <span className="mt-0.5 shrink-0">{qualityIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{r.displayName}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              levelBadgeCls(r.experienceLevel),
            )}
          >
            {levelLabel(r.experienceLevel)}
          </span>
          {r.unavailable && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
              <CalendarOff className="size-3" /> Off
            </span>
          )}
          {r.alreadyBooked && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
              <CalendarClock className="size-3" /> Booked
            </span>
          )}
        </div>
        {r.reasons.length > 0 && (
          <div className="text-[11px] text-muted-foreground truncate">
            {r.reasons[0]}
          </div>
        )}
      </div>
    </li>
  );
}
