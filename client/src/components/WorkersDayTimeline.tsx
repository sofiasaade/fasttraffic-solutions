import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { GraduationCap } from "lucide-react";
import { TechnicianProfileButton } from "@/components/TechnicianProfile";

/**
 * WorkersDayTimeline
 *
 * A per-day, per-hour availability grid for the Workers section. Each technician
 * is a row; the horizontal axis is the working hours of the day. Busy blocks
 * (day-pinned assignments that carry start/end times) are drawn as colored bars,
 * and the empty space between them is the technician's FREE time — so a
 * coordinator can see at a glance which hours are open to take on more tasks.
 *
 * Assignments without an explicit start/end time can't be placed on the hour
 * axis, so they are listed compactly under the row as "all-day / no time set".
 */

const PHASE_LABEL: Record<string, string> = {
  preparation: "Prep",
  setup: "Setup",
  pickup: "Pickup",
};

// Default working window shown on the axis. Auto-expands if an assignment
// starts earlier or ends later than this.
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 20;

export type DayAssignment = {
  id: number;
  technicianName: string;
  airtableJobId: string | null;
  phase: string;
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
  status: "tentative" | "confirmed";
  company: string | null;
  jobAddress: string | null;
  municipality: string | null;
};

export type DayTech = {
  airtableName: string;
  displayName: string;
  experienceLevel: string;
  certificateCount: number;
};

/** Parse "HH:MM" into fractional hours (e.g. "07:30" -> 7.5). Null if invalid. */
function parseHour(t: string | null): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h + min / 60;
}

function fmtHourLabel(h: number): string {
  const hour = ((h % 24) + 24) % 24;
  const ampm = hour < 12 ? "AM" : "PM";
  let display = hour % 12;
  if (display === 0) display = 12;
  return `${display}${ampm}`;
}

const BAR_COLORS = [
  "bg-blue-500/85 border-blue-600",
  "bg-emerald-500/85 border-emerald-600",
  "bg-violet-500/85 border-violet-600",
  "bg-amber-500/85 border-amber-600",
  "bg-rose-500/85 border-rose-600",
  "bg-cyan-500/85 border-cyan-600",
  "bg-lime-500/85 border-lime-600",
  "bg-fuchsia-500/85 border-fuchsia-600",
];

function colorForJob(jobId: string | null) {
  if (!jobId) return BAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) >>> 0;
  return BAR_COLORS[h % BAR_COLORS.length];
}

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

export function WorkersDayTimeline({
  technicians,
  assignmentsByTech,
  isUnavailable,
}: {
  technicians: DayTech[];
  /** Assignments for the selected day, indexed by technician airtableName. */
  assignmentsByTech: Map<string, DayAssignment[]>;
  /** Whether a technician is off on the selected day. */
  isUnavailable: (name: string) => boolean;
}) {
  // Compute the visible hour window across all timed assignments so nothing is
  // clipped, then snap to whole hours.
  const { startHour, endHour, hourMarks } = useMemo(() => {
    let min = DEFAULT_START_HOUR;
    let max = DEFAULT_END_HOUR;
    for (const list of Array.from(assignmentsByTech.values())) {
      for (const a of list) {
        const s = parseHour(a.startTime);
        const e = parseHour(a.endTime);
        if (s != null) min = Math.min(min, Math.floor(s));
        if (e != null) max = Math.max(max, Math.ceil(e));
      }
    }
    if (max <= min) max = min + 1;
    const marks: number[] = [];
    for (let h = min; h <= max; h++) marks.push(h);
    return { startHour: min, endHour: max, hourMarks: marks };
  }, [assignmentsByTech]);

  const span = endHour - startHour;

  function pct(hour: number) {
    return ((hour - startHour) / span) * 100;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[820px]">
        {/* Hour axis header */}
        <div className="grid grid-cols-[200px_1fr] border-b border-border bg-muted/40 sticky top-0 z-10">
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
            Technician
          </div>
          <div className="relative h-8">
            {hourMarks.map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 flex items-center"
                style={{ left: `${pct(h)}%` }}
              >
                <span className="-translate-x-1/2 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {fmtHourLabel(h)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        {technicians.map((t) => {
          const list = assignmentsByTech.get(t.airtableName) ?? [];
          const timed = list.filter(
            (a) => parseHour(a.startTime) != null && parseHour(a.endTime) != null,
          );
          const untimed = list.filter(
            (a) => !(parseHour(a.startTime) != null && parseHour(a.endTime) != null),
          );
          const off = isUnavailable(t.airtableName);
          return (
            <div
              key={t.airtableName}
              className="grid grid-cols-[200px_1fr] border-b border-border last:border-b-0 hover:bg-accent/20 transition-colors"
            >
              {/* Name cell */}
              <div className="px-3 py-2 flex items-start gap-2 border-r border-border">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {t.displayName}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        levelBadgeCls(t.experienceLevel),
                      )}
                    >
                      {levelLabel(t.experienceLevel)}
                    </span>
                    {t.certificateCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <GraduationCap className="size-3" />
                        {t.certificateCount}
                      </span>
                    )}
                  </div>
                  {untimed.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {untimed.map((a) => (
                        <div
                          key={a.id}
                          className="text-[10px] text-muted-foreground truncate"
                          title={`${PHASE_LABEL[a.phase] ?? a.phase} · ${a.company ?? a.municipality ?? "Job"} (no time set)`}
                        >
                          • {PHASE_LABEL[a.phase] ?? a.phase}:{" "}
                          {a.company ?? a.municipality ?? "Job"}{" "}
                          <span className="opacity-70">(no time)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <TechnicianProfileButton
                  airtableName={t.airtableName}
                  displayName={t.displayName}
                  experienceLevel={t.experienceLevel}
                />
              </div>

              {/* Hour track */}
              <div
                className={cn(
                  "relative min-h-[52px] py-2",
                  off &&
                    "bg-[repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb_4px,#f3f4f6_4px,#f3f4f6_8px)]",
                )}
              >
                {/* Hour gridlines */}
                {hourMarks.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 border-l border-border/50"
                    style={{ left: `${pct(h)}%` }}
                  />
                ))}

                {off && timed.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-slate-500">
                    Off / unavailable
                  </div>
                ) : timed.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-[11px] text-emerald-600 font-medium">
                    Free all day
                  </div>
                ) : (
                  timed.map((a) => {
                    const s = parseHour(a.startTime)!;
                    const e = parseHour(a.endTime)!;
                    const left = pct(s);
                    const width = ((e - s) / span) * 100;
                    return (
                      <div
                        key={a.id}
                        title={`${PHASE_LABEL[a.phase] ?? a.phase} · ${a.company ?? a.municipality ?? "Job"}${
                          a.jobAddress ? " — " + a.jobAddress : ""
                        } (${a.startTime}–${a.endTime})`}
                        className={cn(
                          "absolute top-1.5 bottom-1.5 rounded border px-1.5 py-0.5 text-[10px] leading-tight text-white overflow-hidden shadow-sm",
                          colorForJob(a.airtableJobId),
                          a.status === "confirmed"
                            ? "ring-1 ring-white/70"
                            : "opacity-90 border-dashed",
                        )}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(width, 3)}%`,
                        }}
                      >
                        <div className="font-semibold truncate">
                          {PHASE_LABEL[a.phase] ?? a.phase} · {a.startTime}–
                          {a.endTime}
                        </div>
                        <div className="truncate opacity-95">
                          {a.company ?? a.municipality ?? "Job"}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
