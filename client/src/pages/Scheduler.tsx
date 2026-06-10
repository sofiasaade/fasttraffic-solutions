import { useMemo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  GripVertical,
  Search,
  Building2,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { DispatchJob as Job } from "@/lib/jobTypes";

type Phase = "Preparation" | "Setup" | "Pickup";
const PHASES: Phase[] = ["Preparation", "Setup", "Pickup"];

const PHASE_COLOR: Record<Phase, string> = {
  Preparation: "bg-blue-100 text-blue-800 border-blue-200",
  Setup: "bg-orange-100 text-orange-800 border-orange-200",
  Pickup: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

// Status sections mirror the Dispatch board grouping.
type SectionKey = "submitted" | "approved" | "field";
const STATUS_SECTIONS: {
  key: SectionKey;
  status: string;
  title: string;
  dot: string;
}[] = [
  {
    key: "submitted",
    status: "Permit Request Submitted",
    title: "Permit Request Submitted",
    dot: "#2563eb",
  },
  {
    key: "approved",
    status: "Permit Approved",
    title: "Permit Approved",
    dot: "#ea580c",
  },
  { key: "field", status: "Field", title: "Field", dot: "#16a34a" },
];

// ---- date helpers (local, no tz drift for day keys) ----
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // make Monday the first day
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseDayKey(s: string | null): string {
  if (!s) return "";
  return s.slice(0, 10);
}
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type ScheduledRow = {
  id: number;
  jobId: string;
  phase: string;
  technicianName: string;
  scheduledDate: string | null;
  startTime: string | null;
  endTime: string | null;
};

export default function Scheduler() {
  const jobsQuery = trpc.coordinator.boardJobs.useQuery();
  const techQuery = trpc.coordinator.technicians.useQuery();
  const utils = trpc.useUtils();
  const setScheduled = trpc.coordinator.setScheduled.useMutation();
  const removeScheduled = trpc.coordinator.removeScheduled.useMutation();

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    submitted: false,
    approved: false,
    field: false,
  });

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const dayKeys = useMemo(() => days.map(dayKeyLocal), [days]);

  // Day-pinned scheduled assignments for the visible week.
  const schedQuery = trpc.coordinator.scheduledAssignments.useQuery({
    startDate: dayKeys[0],
    endDate: dayKeys[6],
  });
  const scheduled = (schedQuery.data ?? []) as ScheduledRow[];

  // Drop dialog state
  const [drop, setDrop] = useState<{
    job: Job;
    dayKey: string;
    techName: string;
    techDisplay: string;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("Setup");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("16:00");
  const [pendingForce, setPendingForce] = useState<{
    conflicts: { technician: string; otherJobLabel: string }[];
  } | null>(null);

  // Jobs that overlap the visible week (start..end intersects the week).
  const weekJobs = useMemo(() => {
    const list = (jobsQuery.data ?? []) as Job[];
    const weekFirst = dayKeys[0];
    const weekLast = dayKeys[6];
    return list
      .filter((j) => {
        const s = parseDayKey(j.startDate);
        const e = parseDayKey(j.endDate) || s;
        if (!s) return false;
        return s <= weekLast && e >= weekFirst;
      })
      .sort((a, b) =>
        parseDayKey(a.startDate).localeCompare(parseDayKey(b.startDate)),
      );
  }, [jobsQuery.data, dayKeys]);

  // Group jobs by status section (like the dispatch board).
  const grouped = useMemo(() => {
    const map: Record<SectionKey, Job[]> = {
      submitted: [],
      approved: [],
      field: [],
    };
    for (const j of weekJobs) {
      const section = STATUS_SECTIONS.find((s) => s.status === j.status);
      if (section) map[section.key].push(j);
    }
    return map;
  }, [weekJobs]);

  // Technicians already booked (day-pinned) per day this week.
  const bookedByDay = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of scheduled) {
      if (!r.scheduledDate) continue;
      if (!m.has(r.scheduledDate)) m.set(r.scheduledDate, new Set());
      m.get(r.scheduledDate)!.add(r.technicianName);
    }
    return m;
  }, [scheduled]);

  const workers = useMemo(() => {
    const list = techQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) =>
        w.displayName.toLowerCase().includes(q) ||
        (w.zones ?? "").toLowerCase().includes(q),
    );
  }, [techQuery.data, search]);

  const jobCoversDay = useCallback((job: Job, dk: string) => {
    const s = parseDayKey(job.startDate);
    const e = parseDayKey(job.endDate) || s;
    return dk >= s && dk <= e;
  }, []);

  // Scheduled chips for a (job, day).
  const chipsFor = useCallback(
    (jobId: string, dk: string) =>
      scheduled.filter((r) => r.jobId === jobId && r.scheduledDate === dk),
    [scheduled],
  );

  // ---- drag handlers ----
  const onDragStartWorker = (
    e: React.DragEvent,
    techName: string,
    techDisplay: string,
  ) => {
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({ techName, techDisplay }),
    );
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDropCell = (e: React.DragEvent, job: Job, dk: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const { techName, techDisplay } = JSON.parse(raw);
      setPhase("Setup");
      setStartTime("08:00");
      setEndTime("16:00");
      setPendingForce(null);
      setDrop({ job, dayKey: dk, techName, techDisplay });
    } catch {
      /* ignore */
    }
  };

  const doSchedule = async (force: boolean) => {
    if (!drop) return;
    const res = await setScheduled.mutateAsync({
      jobId: drop.job.id,
      phase,
      technicianName: drop.techName,
      scheduledDate: drop.dayKey,
      startTime,
      endTime,
      force,
    });
    if (!res.ok) {
      setPendingForce({ conflicts: res.conflicts });
      return;
    }
    toast.success(`${drop.techDisplay} scheduled for ${phase} on ${drop.dayKey}.`);
    setDrop(null);
    setPendingForce(null);
    utils.coordinator.scheduledAssignments.invalidate();
  };

  const removeChip = async (row: ScheduledRow) => {
    await removeScheduled.mutateAsync({ id: row.id });
    toast.success(`Removed ${row.technicianName} from ${row.scheduledDate}.`);
    utils.coordinator.scheduledAssignments.invalidate();
  };

  const weekLabel = `${days[0].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${days[6].toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const loading = jobsQuery.isLoading || techQuery.isLoading;

  const renderJobRow = (job: Job) => (
    <div
      key={job.id}
      className="grid grid-cols-[240px_repeat(7,1fr)] border-b border-border hover:bg-accent/20"
    >
      {/* Job label */}
      <div className="px-4 py-3 border-r border-border">
        <div className="flex items-center gap-1.5">
          <Building2 className="size-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate">
            {job.company ?? "—"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {job.jobAddress ?? "No address"}
        </div>
      </div>

      {/* Day cells */}
      {dayKeys.map((dk, i) => {
        const covers = jobCoversDay(job, dk);
        const chips = chipsFor(job.id, dk);
        return (
          <div
            key={i}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => onDropCell(e, job, dk)}
            className={cn(
              "border-l border-border min-h-[64px] p-1.5 transition-colors",
              covers ? "bg-primary/5" : "bg-transparent",
              "hover:bg-primary/10",
            )}
          >
            <div className="space-y-1">
              {covers && dk === parseDayKey(job.startDate) && (
                <div className="h-1.5 rounded-full bg-primary/40" />
              )}
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => removeChip(c)}
                  title={`${c.technicianName} • ${c.phase}${
                    c.startTime ? ` • ${c.startTime}-${c.endTime ?? ""}` : ""
                  } — click to remove`}
                  className={cn(
                    "group w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate flex items-center justify-between gap-1",
                    PHASE_COLOR[c.phase as Phase] ??
                      "bg-card text-foreground border-border",
                  )}
                >
                  <span className="truncate">{c.technicianName}</span>
                  <X className="size-3 opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 md:px-6 pt-5 pb-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Scheduler</h1>
          <p className="text-sm text-muted-foreground">
            Drag a worker onto a job/day to schedule a day &amp; time. Jobs
            grouped by permit status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="text-sm font-semibold ml-2 whitespace-nowrap">
            {weekLabel}
          </span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Timeline */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="min-w-[760px]">
              {/* Day header */}
              <div className="grid grid-cols-[240px_repeat(7,1fr)] sticky top-0 z-10 bg-card border-b border-border">
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Job
                </div>
                {days.map((d, i) => {
                  const isToday = dayKeyLocal(d) === dayKeyLocal(new Date());
                  return (
                    <div
                      key={i}
                      className={cn(
                        "px-2 py-2 text-center border-l border-border",
                        isToday && "bg-primary/5",
                      )}
                    >
                      <div className="text-[11px] uppercase text-muted-foreground">
                        {WEEKDAY[i]}
                      </div>
                      <div
                        className={cn(
                          "text-sm font-semibold",
                          isToday && "text-primary",
                        )}
                      >
                        {d.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {weekJobs.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No jobs scheduled in this week.
                </div>
              ) : (
                STATUS_SECTIONS.map((section) => {
                  const sectionJobs = grouped[section.key];
                  if (sectionJobs.length === 0) return null;
                  const isCollapsed = collapsed[section.key];
                  return (
                    <div key={section.key}>
                      {/* Section header */}
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsed((c) => ({
                            ...c,
                            [section.key]: !c[section.key],
                          }))
                        }
                        className="w-full flex items-center gap-2 px-4 py-2 bg-muted/60 border-b border-border text-left sticky top-[41px] z-[5]"
                      >
                        <ChevronDown
                          className={cn(
                            "size-4 text-muted-foreground transition-transform",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: section.dot }}
                        />
                        <span className="font-semibold text-sm">
                          {section.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({sectionJobs.length})
                        </span>
                      </button>
                      {!isCollapsed && sectionJobs.map(renderJobRow)}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Workers panel */}
        <aside className="w-72 border-l border-border bg-card/40 flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <h2 className="font-bold text-sm">Workers</h2>
            <p className="text-[11px] text-muted-foreground mb-2">
              Drag a name onto a job/day cell.
            </p>
            <div className="relative">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workers"
                className="pl-8 h-9"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {workers.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No workers found.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {workers.map((w) => {
                  // Booked anywhere in the visible week?
                  let bookedDays = 0;
                  bookedByDay.forEach((set) => {
                    if (set.has(w.airtableName)) bookedDays += 1;
                  });
                  return (
                    <li
                      key={w.id}
                      draggable
                      onDragStart={(e) =>
                        onDragStartWorker(e, w.airtableName, w.displayName)
                      }
                      className="px-3 py-2.5 flex items-start gap-2 cursor-grab active:cursor-grabbing hover:bg-accent/60 transition-colors"
                    >
                      <GripVertical className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {w.displayName}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {w.zones ? w.zones : "No zones"}
                          {bookedDays > 0 && (
                            <span className="ml-1 text-amber-600">
                              • {bookedDays}d booked
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Schedule-on-drop dialog */}
      <Dialog
        open={!!drop}
        onOpenChange={(v) => {
          if (!v) {
            setDrop(null);
            setPendingForce(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule technician</DialogTitle>
            <DialogDescription>
              {drop && (
                <>
                  Schedule <strong>{drop.techDisplay}</strong> for{" "}
                  <strong>{drop.job.company ?? "this job"}</strong> (
                  {drop.job.jobAddress ?? "no address"}) on{" "}
                  <strong>{drop.dayKey}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Phase</label>
              <Select value={phase} onValueChange={(v) => setPhase(v as Phase)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHASES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2">
                <span
                  className={cn(
                    "inline-block text-xs px-2 py-1 rounded border",
                    PHASE_COLOR[phase],
                  )}
                >
                  {phase}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Start time
                </label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  End time
                </label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            {pendingForce && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
                  <AlertTriangle className="size-4" />
                  Worker already booked that day
                </div>
                <ul className="mt-1.5 text-xs text-amber-700 space-y-1">
                  {pendingForce.conflicts.map((c, idx) => (
                    <li key={idx}>
                      {c.technician} is booked on: {c.otherJobLabel}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDrop(null);
                setPendingForce(null);
              }}
            >
              <X className="size-4 mr-1" />
              Cancel
            </Button>
            {pendingForce ? (
              <Button
                variant="destructive"
                onClick={() => doSchedule(true)}
                disabled={setScheduled.isPending}
              >
                {setScheduled.isPending && (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                )}
                Schedule anyway
              </Button>
            ) : (
              <Button
                onClick={() => doSchedule(false)}
                disabled={setScheduled.isPending}
              >
                {setScheduled.isPending && (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                )}
                Schedule
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
