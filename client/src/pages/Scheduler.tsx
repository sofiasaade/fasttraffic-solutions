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
  // Airtable date strings are ISO; take the date part.
  return s.slice(0, 10);
}
const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Scheduler() {
  const jobsQuery = trpc.coordinator.boardJobs.useQuery();
  const techQuery = trpc.coordinator.technicians.useQuery();
  const utils = trpc.useUtils();
  const assign = trpc.coordinator.assignTechnicians.useMutation();

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [search, setSearch] = useState("");

  // Drop dialog state
  const [drop, setDrop] = useState<{
    job: Job;
    dayKey: string;
    techName: string;
    techDisplay: string;
  } | null>(null);
  const [phase, setPhase] = useState<Phase>("Setup");
  const [pendingForce, setPendingForce] = useState<{
    conflicts: { technician: string; otherJobLabel: string }[];
  } | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const dayKeys = useMemo(() => days.map(dayKeyLocal), [days]);

  // Jobs that overlap the visible week (start..end intersects the week).
  const jobs = useMemo(() => {
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

  // Does a job span a given day?
  const jobCoversDay = useCallback((job: Job, dk: string) => {
    const s = parseDayKey(job.startDate);
    const e = parseDayKey(job.endDate) || s;
    return s <= dk && dk >= s && dk <= e;
  }, []);

  const assignedTechsForJob = useCallback((job: Job) => {
    const all = new Set<string>([
      ...job.techPrep,
      ...job.techSetup,
      ...job.techPickup,
    ]);
    return Array.from(all);
  }, []);

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
      setPendingForce(null);
      setDrop({ job, dayKey: dk, techName, techDisplay });
    } catch {
      /* ignore */
    }
  };

  const currentPhaseTechs = (job: Job, p: Phase): string[] =>
    p === "Preparation"
      ? job.techPrep
      : p === "Setup"
      ? job.techSetup
      : job.techPickup;

  const doAssign = async (force: boolean) => {
    if (!drop) return;
    const existing = currentPhaseTechs(drop.job, phase);
    if (existing.includes(drop.techName) && !force) {
      toast.info(`${drop.techDisplay} is already on ${phase} for this job.`);
      setDrop(null);
      return;
    }
    const technicians = existing.includes(drop.techName)
      ? existing
      : [...existing, drop.techName];

    const res = await assign.mutateAsync({
      jobId: drop.job.id,
      phase,
      technicians,
      force,
    });

    if (!res.ok) {
      setPendingForce({ conflicts: res.conflicts });
      return;
    }
    toast.success(`${drop.techDisplay} assigned to ${phase}.`);
    setDrop(null);
    setPendingForce(null);
    utils.coordinator.boardJobs.invalidate();
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

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-4 md:px-6 pt-5 pb-3 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Scheduler</h1>
          <p className="text-sm text-muted-foreground">
            Drag a worker onto a job/day to assign. Jobs shown by company &
            address.
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

              {/* Job rows */}
              {jobs.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No jobs scheduled in this week.
                </div>
              ) : (
                jobs.map((job) => (
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
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {job.status}
                      </div>
                    </div>

                    {/* Day cells */}
                    {dayKeys.map((dk, i) => {
                      const covers = jobCoversDay(job, dk);
                      const techs = assignedTechsForJob(job);
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
                          {/* Show a bar on the first covered day to indicate the span start,
                              and assignment chips */}
                          {covers && (
                            <div className="space-y-1">
                              {dk === parseDayKey(job.startDate) && (
                                <div className="h-1.5 rounded-full bg-primary/40" />
                              )}
                              {techs.slice(0, 3).map((t) => (
                                <div
                                  key={t}
                                  className="text-[10px] leading-tight px-1.5 py-0.5 rounded bg-card border truncate"
                                  title={t}
                                >
                                  {t}
                                </div>
                              ))}
                              {techs.length > 3 && (
                                <div className="text-[10px] text-muted-foreground">
                                  +{techs.length - 3} more
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
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
                {workers.map((w) => (
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
                      {w.zones && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {w.zones}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Assign-on-drop dialog */}
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
            <DialogTitle>Assign technician</DialogTitle>
            <DialogDescription>
              {drop && (
                <>
                  Assign <strong>{drop.techDisplay}</strong> to{" "}
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

            {pendingForce && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
                  <AlertTriangle className="size-4" />
                  Scheduling conflict detected
                </div>
                <ul className="mt-1.5 text-xs text-amber-700 space-y-1">
                  {pendingForce.conflicts.map((c, idx) => (
                    <li key={idx}>
                      {c.technician} overlaps with: {c.otherJobLabel}
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
                onClick={() => doAssign(true)}
                disabled={assign.isPending}
              >
                {assign.isPending && (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                )}
                Assign anyway
              </Button>
            ) : (
              <Button
                onClick={() => doAssign(false)}
                disabled={assign.isPending}
              >
                {assign.isPending && (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                )}
                Assign
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
