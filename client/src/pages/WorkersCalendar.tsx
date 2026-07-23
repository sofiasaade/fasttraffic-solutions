import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Loader2,
  Search,
  GraduationCap,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TechnicianProfileButton } from "@/components/TechnicianProfile";
import {
  WorkersDayTimeline,
  type DayAssignment,
} from "@/components/WorkersDayTimeline";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Format a Date as YYYY-MM-DD in local time. */
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday-start week containing the given date. */
function startOfWeek(d: Date) {
  const c = new Date(d);
  const dow = c.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  c.setDate(c.getDate() + diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Stable palette to color assignment bars by job.
const BAR_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-violet-100 text-violet-800 border-violet-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-lime-100 text-lime-800 border-lime-200",
  "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
];

function colorForJob(jobId: string | null) {
  if (!jobId) return BAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < jobId.length; i++) h = (h * 31 + jobId.charCodeAt(i)) >>> 0;
  return BAR_COLORS[h % BAR_COLORS.length];
}

const PHASE_LABEL: Record<string, string> = {
  preparation: "Prep",
  setup: "Setup",
  pickup: "Pickup",
};

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "CAD",
  });
}

/** Compact weekly billable flagging-hours summary, aggregated by job. */
function FlaggingWeekSummary({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const { data } = trpc.coordinator.flaggingSummary.useQuery({
    startDate,
    endDate,
  });
  if (!data || data.totalHours === 0) return null;
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-orange-800">
          <Flag className="size-4" />
          Billable flagging this week
        </span>
        <span className="flex items-center gap-3 text-sm font-semibold text-orange-800">
          <span>{data.totalHours}h</span>
          {data.totalAmountCents > 0 && (
            <span>{fmtMoney(data.totalAmountCents)}</span>
          )}
          <span className="text-xs font-normal text-orange-700">
            {data.jobs.length} job{data.jobs.length === 1 ? "" : "s"}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function WorkersCalendar() {
  const [view, setView] = useState<"week" | "day">("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  // Selected day for the per-hour Day view (defaults to today).
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [filter, setFilter] = useState("");

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Query range depends on the active view: the full week for the week grid,
  // or just the selected day for the per-hour timeline.
  const startDate = view === "week" ? ymd(days[0]) : ymd(selectedDay);
  const endDate = view === "week" ? ymd(days[6]) : ymd(selectedDay);

  const { data, isLoading } = trpc.coordinator.workerWeek.useQuery({
    startDate,
    endDate,
  });

  const todayStr = ymd(new Date());
  const utils = trpc.useUtils();

  // Click-to-edit for an assigned chip: task, times, or remove it.
  const [editing, setEditing] = useState<{
    id: number;
    label: string;
    phase: string;
    startTime: string;
    endTime: string;
  } | null>(null);
  const updateScheduled = trpc.coordinator.updateScheduled.useMutation({
    onSuccess: () => {
      toast.success("Assignment updated");
      setEditing(null);
      utils.coordinator.workerWeek.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeScheduled = trpc.coordinator.removeScheduled.useMutation({
    onSuccess: () => {
      toast.success("Assignment removed");
      setEditing(null);
      utils.coordinator.workerWeek.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // How many distinct technicians have at least one assignment TODAY.
  const workingTodayCount = useMemo(() => {
    if (!data) return 0;
    const set = new Set<string>();
    for (const a of data.assignments) {
      if (a.scheduledDate === todayStr) set.add(a.technicianName);
    }
    return set.size;
  }, [data, todayStr]);

  // Index assignments by technician + date.
  const assignByTechDate = useMemo(() => {
    type Assign = NonNullable<typeof data>["assignments"];
    const m = new Map<string, Assign>();
    if (!data) return m;
    for (const a of data.assignments) {
      if (!a.scheduledDate) continue;
      const key = `${a.technicianName}|${a.scheduledDate}`;
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [data]);

  // Build availability lookup: name -> { weekday: bool, dateOverrides: Map<date,bool> }
  const availByName = useMemo(() => {
    const m = new Map<
      string,
      { weekday: Map<number, boolean>; date: Map<string, boolean> }
    >();
    if (!data) return m;
    for (const r of data.availability) {
      const entry =
        m.get(r.airtableName) ?? {
          weekday: new Map<number, boolean>(),
          date: new Map<string, boolean>(),
        };
      if (r.kind === "weekday" && r.weekday != null) {
        entry.weekday.set(r.weekday, r.available);
      } else if (r.kind === "date" && r.date) {
        entry.date.set(r.date, r.available);
      }
      m.set(r.airtableName, entry);
    }
    return m;
  }, [data]);

  function isUnavailable(name: string, d: Date) {
    const entry = availByName.get(name);
    if (!entry) return false;
    const dateStr = ymd(d);
    if (entry.date.has(dateStr)) return !entry.date.get(dateStr);
    const wd = d.getDay();
    if (entry.weekday.has(wd)) return !entry.weekday.get(wd);
    return false; // available by default
  }

  // Day view: assignments for the selected day, indexed by technician name.
  const dayAssignmentsByTech = useMemo(() => {
    const m = new Map<string, DayAssignment[]>();
    if (!data) return m;
    const dayStr = ymd(selectedDay);
    for (const a of data.assignments) {
      if (a.scheduledDate !== dayStr) continue;
      const arr = m.get(a.technicianName) ?? [];
      arr.push(a as DayAssignment);
      m.set(a.technicianName, arr);
    }
    return m;
  }, [data, selectedDay]);

  const technicians = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return data.technicians;
    return data.technicians.filter(
      (t) =>
        t.displayName.toLowerCase().includes(f) ||
        t.airtableName.toLowerCase().includes(f),
    );
  }, [data, filter]);

  const weekLabel = `${days[0].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${days[6].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  function shiftWeek(deltaDays: number) {
    setWeekStart((prev) => {
      const n = new Date(prev);
      n.setDate(n.getDate() + deltaDays);
      return startOfWeek(n);
    });
  }

  function shiftDay(delta: number) {
    setSelectedDay((prev) => {
      const n = new Date(prev);
      n.setDate(n.getDate() + delta);
      n.setHours(0, 0, 0, 0);
      return n;
    });
  }

  const dayLabel = `${FULL_DAY_LABELS[selectedDay.getDay()]}, ${selectedDay.toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric" },
  )}`;

  function levelBadgeCls(level: string) {
    return level === "senior"
      ? "bg-blue-100 text-blue-700"
      : level === "medium"
        ? "bg-emerald-100 text-emerald-700"
        : level === "apprentice"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";
  }
  function levelLabel(level: string) {
    return level === "senior"
      ? "Senior"
      : level === "medium"
        ? "Medium"
        : level === "apprentice"
          ? "Apprentice"
          : "Junior";
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" /> Workers
          </h1>
          <p className="text-sm text-muted-foreground">
            Weekly availability and project assignments per technician.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Week / Day view toggle */}
          <div className="inline-flex rounded-md border border-border p-0.5">
            <Button
              variant={view === "week" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setView("week")}
            >
              Week
            </Button>
            <Button
              variant={view === "day" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3"
              onClick={() => setView("day")}
            >
              Day
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter workers"
              className="pl-7 w-44 h-9"
            />
          </div>
          {view === "week" ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => shiftWeek(-7)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={() => shiftWeek(7)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => shiftDay(-1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  setSelectedDay(d);
                }}
              >
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={() => shiftDay(1)}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="text-sm font-medium text-muted-foreground">
        {view === "week" ? weekLabel : dayLabel}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded border border-emerald-200 bg-emerald-50" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded border border-slate-300 bg-[repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb_3px,#f3f4f6_3px,#f3f4f6_6px)]" />
          Unavailable
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded border border-amber-400 border-dashed bg-amber-100" />
          Tentative (not notified)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded border border-emerald-500 bg-emerald-100" />
          Confirmed (notified)
        </span>
      </div>

      {view === "week" && (
        <FlaggingWeekSummary startDate={startDate} endDate={endDate} />
      )}

      {isLoading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : technicians.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No workers found.
        </div>
      ) : view === "day" ? (
        <WorkersDayTimeline
          technicians={technicians.map((t) => ({
            airtableName: t.airtableName,
            displayName: t.displayName,
            experienceLevel: t.experienceLevel,
            certificateCount: t.certificateCount,
          }))}
          assignmentsByTech={dayAssignmentsByTech}
          isUnavailable={(name) => isUnavailable(name, selectedDay)}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="min-w-[900px]">
            {/* Column header */}
            <div className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b border-border bg-muted/40 sticky top-0 z-10">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                Technician
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold tabular-nums"
                  title="Technicians with at least one assignment today"
                >
                  {workingTodayCount} working today
                </span>
              </div>
              {days.map((d) => {
                const isToday = ymd(d) === todayStr;
                return (
                  <div
                    key={ymd(d)}
                    className={cn(
                      "px-2 py-2 text-center border-l border-border",
                      isToday && "bg-primary/5",
                    )}
                  >
                    <div className="text-[11px] font-semibold text-muted-foreground">
                      {DAY_LABELS[d.getDay()]}
                    </div>
                    <div
                      className={cn(
                        "text-sm font-medium",
                        isToday && "text-primary",
                      )}
                    >
                      {d.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rows */}
            {technicians.map((t) => (
              <div
                key={t.airtableName}
                className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
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
                  </div>
                  <TechnicianProfileButton
                    airtableName={t.airtableName}
                    displayName={t.displayName}
                    experienceLevel={t.experienceLevel}
                  />
                </div>

                {/* Day cells */}
                {days.map((d) => {
                  const dateStr = ymd(d);
                  const unavailable = isUnavailable(t.airtableName, d);
                  const assigns =
                    assignByTechDate.get(`${t.airtableName}|${dateStr}`) ?? [];
                  const isToday = dateStr === todayStr;
                  return (
                    <div
                      key={dateStr}
                      className={cn(
                        "min-w-0 min-h-[60px] border-l border-border p-1 space-y-1 overflow-hidden",
                        isToday && "bg-primary/5",
                        unavailable &&
                          "bg-[repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb_4px,#f3f4f6_4px,#f3f4f6_8px)]",
                      )}
                    >
                      {assigns.map((a) => (
                        <div
                          key={a.id}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            setEditing({
                              id: a.id,
                              label: `${a.company ?? a.municipality ?? "Job"}${a.jobAddress ? " — " + a.jobAddress : ""}`,
                              phase: a.phase,
                              startTime: a.startTime ?? "",
                              endTime: a.endTime ?? "",
                            })
                          }
                          title={`${PHASE_LABEL[a.phase] ?? a.phase} · ${a.company ?? a.municipality ?? "Job"}${
                            a.jobAddress ? " — " + a.jobAddress : ""
                          }${a.startTime ? ` (${a.startTime}${a.endTime ? "–" + a.endTime : ""})` : ""} — click to edit`}
                          className={cn(
                            "min-w-0 max-w-full rounded border px-1.5 py-1 text-[10px] leading-tight cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow",
                            colorForJob(a.airtableJobId),
                            a.status === "confirmed"
                              ? "ring-1 ring-emerald-500"
                              : "border-dashed opacity-90",
                          )}
                        >
                          <div className="font-semibold truncate flex items-center gap-1">
                            {a.status === "confirmed" && (
                              <span className="inline-block size-1.5 rounded-full bg-emerald-500 shrink-0" />
                            )}
                            {PHASE_LABEL[a.phase] ?? a.phase}
                          </div>
                          <div className="truncate opacity-90">
                            {a.company ?? a.municipality ?? "Job"}
                          </div>
                        </div>
                      ))}
                      {unavailable && assigns.length === 0 && (
                        <div className="text-[10px] text-slate-500 text-center pt-2">
                          Off
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit an assigned chip: task, times, or remove the assignment. */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit assignment</DialogTitle>
            <DialogDescription className="truncate">
              {editing?.label}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Task
                </div>
                <Select
                  value={editing.phase}
                  onValueChange={(v) =>
                    setEditing((e) => (e ? { ...e, phase: v } : e))
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "Preparation",
                      "Setup",
                      "Set up aside",
                      "No Parking",
                      "Flagger",
                      "Pickup",
                    ].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Start time
                  </div>
                  <Input
                    type="time"
                    value={editing.startTime}
                    onChange={(e) =>
                      setEditing((s) =>
                        s ? { ...s, startTime: e.target.value } : s,
                      )
                    }
                    className="h-9"
                  />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    End time
                  </div>
                  <Input
                    type="time"
                    value={editing.endTime}
                    onChange={(e) =>
                      setEditing((s) =>
                        s ? { ...s, endTime: e.target.value } : s,
                      )
                    }
                    className="h-9"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removeScheduled.isPending}
                  onClick={() => removeScheduled.mutate({ id: editing.id })}
                >
                  Remove
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={updateScheduled.isPending}
                    onClick={() =>
                      updateScheduled.mutate({
                        id: editing.id,
                        phase: editing.phase as any,
                        startTime: editing.startTime || null,
                        endTime: editing.endTime || null,
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
