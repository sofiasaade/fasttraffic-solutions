import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  Sunrise,
  Clock,
  Sun,
  CircleHelp,
  GripVertical,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function dayKeyLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return dayKeyLocal(x);
}
function prettyDay(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

const PHASE_META: Record<string, { label: string; dot: string; badge: string }> = {
  starting: { label: "Starting", dot: "#ea580c", badge: "bg-orange-100 text-orange-700" },
  ongoing: { label: "Ongoing daily", dot: "#2563eb", badge: "bg-blue-100 text-blue-700" },
  pickup: { label: "Pick up", dot: "#16a34a", badge: "bg-green-100 text-green-700" },
};

const TIME_GROUPS = [
  { key: "before9", label: "Before 9:00", icon: Sunrise },
  { key: "at9", label: "9:00", icon: Clock },
  { key: "after9", label: "After 9:00", icon: Sun },
  { key: "notime", label: "No set time", icon: CircleHelp },
] as const;

const TASKS = [
  "Preparation",
  "Setup",
  "Set up aside",
  "No Parking",
  "Flagger",
  "Pickup",
] as const;

// Suggested times per task (editable in the dialog before saving).
const TASK_TIMES: Record<string, { start: string; end: string }> = {
  Preparation: { start: "14:00", end: "16:00" },
  Setup: { start: "07:00", end: "15:00" },
  "Set up aside": { start: "07:00", end: "15:00" },
  "No Parking": { start: "07:00", end: "09:00" },
  Flagger: { start: "07:00", end: "17:00" },
  Pickup: { start: "15:00", end: "17:00" },
};

export default function DailyBoard() {
  const [date, setDate] = useState(() => dayKeyLocal(new Date()));
  const [poolFilter, setPoolFilter] = useState("");
  const [dragOverTech, setDragOverTech] = useState<string | null>(null);
  // Drop opens this dialog: pick task + time, THEN it saves.
  const [pending, setPending] = useState<{
    job: { id: string; phase: string; company?: string | null };
    techName: string;
    task: string;
    start: string;
    end: string;
  } | null>(null);

  const utils = trpc.useUtils();
  const q = trpc.coordinator.dayBoard.useQuery({ date });

  const setScheduled = trpc.coordinator.setScheduled.useMutation({
    onSuccess: () => {
      utils.coordinator.dayBoard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeScheduled = trpc.coordinator.removeScheduled.useMutation({
    onSuccess: () => utils.coordinator.dayBoard.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const confirmDay = trpc.coordinator.confirmDay.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Day confirmed: ${r.confirmed} assignment(s) — ${r.notified} technician(s) notified in their app`,
      );
      utils.coordinator.dayBoard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const confirmDayTech = trpc.coordinator.confirmDayTech.useMutation({
    onSuccess: (r) => {
      if (r.confirmed > 0) toast.success("Technician's day confirmed & notified");
      utils.coordinator.dayBoard.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const d = q.data;

  // Assignments still tentative for this date (techs can't see them yet).
  const tentativeCount = useMemo(
    () =>
      (d?.technicians ?? []).reduce(
        (n, t) =>
          n + t.assignments.filter((a: any) => a.status !== "confirmed").length,
        0,
      ),
    [d?.technicians],
  );

  // How many techs each pool job already has today (shown as ×N on the card).
  const assignedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of d?.technicians ?? []) {
      for (const a of t.assignments) {
        m.set(a.jobId, (m.get(a.jobId) ?? 0) + 1);
      }
    }
    return m;
  }, [d?.technicians]);

  const poolByTime = useMemo(() => {
    const groups: Record<string, any[]> = { before9: [], at9: [], after9: [], notime: [] };
    const ql = poolFilter.trim().toLowerCase();
    for (const j of d?.pool ?? []) {
      if (ql && !`${j.company ?? ""} ${j.jobAddress ?? ""}`.toLowerCase().includes(ql)) continue;
      groups[j.timeBucket]?.push(j);
    }
    return groups;
  }, [d?.pool, poolFilter]);

  const onDropOnTech = (e: React.DragEvent, techName: string) => {
    e.preventDefault();
    setDragOverTech(null);
    try {
      const job = JSON.parse(e.dataTransfer.getData("application/json"));
      if (!job?.id) return;
      // Default task follows the job's phase for the day; times follow the task.
      const task = job.phase === "pickup" ? "Pickup" : "Setup";
      const t = TASK_TIMES[task];
      setPending({ job, techName, task, start: t.start, end: t.end });
    } catch {
      // ignore malformed drops
    }
  };

  const saveAssign = () => {
    if (!pending) return;
    setScheduled.mutate(
      {
        jobId: pending.job.id,
        phase: pending.task as any,
        technicianName: pending.techName,
        scheduledDate: date,
        startTime: pending.start,
        endTime: pending.end,
        force: true,
      },
      {
        onSuccess: () => {
          toast.success(
            `${pending.job.company ?? "Job"} → ${pending.techName} · ${pending.task} ${pending.start}`,
          );
          setPending(null);
        },
      },
    );
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header + date nav */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Daily Board</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Drag a job from the left onto a technician — {prettyDay(date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-9"
            onClick={() => setDate((k) => addDays(k, -1))} aria-label="Previous day">
            <ChevronLeft className="size-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button variant="outline" size="icon" className="size-9"
            onClick={() => setDate((k) => addDays(k, 1))} aria-label="Next day">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDate(dayKeyLocal(new Date()))}>
            Today
          </Button>
          {/* THE gate: nothing reaches the technicians until this is pressed. */}
          <Button
            size="sm"
            disabled={tentativeCount === 0 || confirmDay.isPending}
            onClick={() => confirmDay.mutate({ date })}
            title="Technicians only see their jobs after you confirm the day"
          >
            {confirmDay.isPending && (
              <Loader2 className="size-4 animate-spin mr-1" />
            )}
            Confirm day
            {tentativeCount > 0 ? ` (${tentativeCount})` : ""}
          </Button>
        </div>
      </div>

      {tentativeCount > 0 && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 text-amber-800 px-3 py-1.5 text-xs font-medium">
          {tentativeCount} tentative assignment{tentativeCount === 1 ? "" : "s"}{" "}
          — technicians will NOT see them until you press "Confirm day".
        </div>
      )}

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-10 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading board…
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-4 flex-1 min-h-0">
          {/* ============ LEFT: job pool (draggable) ============ */}
          <div className="rounded-2xl border border-border bg-card/60 flex flex-col min-h-0">
            <div className="p-3 border-b border-border">
              <div className="font-bold text-sm mb-2">
                Jobs of the day{" "}
                <span className="text-muted-foreground font-normal">
                  ({d?.pool.length ?? 0})
                </span>
              </div>
              <input
                value={poolFilter}
                onChange={(e) => setPoolFilter(e.target.value)}
                placeholder="Search client or address…"
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
            <div className="overflow-y-auto p-3 space-y-4 flex-1 min-h-0 max-h-[70vh]">
              {TIME_GROUPS.map((g) => {
                const jobs = poolByTime[g.key] ?? [];
                if (jobs.length === 0) return null;
                const Icon = g.icon;
                return (
                  <div key={g.key}>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground mb-1.5 sticky top-0 bg-card/95 py-0.5">
                      <Icon className="size-3.5" /> {g.label}
                      <span className="text-muted-foreground/60">({jobs.length})</span>
                    </div>
                    <div className="space-y-1.5">
                      {jobs.map((j) => {
                        const meta = PHASE_META[j.phase];
                        const n = assignedCount.get(j.id) ?? 0;
                        return (
                          <div
                            key={j.id + j.phase}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData(
                                "application/json",
                                JSON.stringify({ id: j.id, phase: j.phase, company: j.company }),
                              );
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm transition-all select-none"
                            title="Drag onto a technician"
                          >
                            <GripVertical className="size-4 text-muted-foreground/50 shrink-0" />
                            <span className="size-2.5 rounded-full shrink-0" style={{ background: meta.dot }} />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{j.company ?? "Job"}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {j.jobAddress ?? j.municipality ?? ""}
                              </div>
                            </div>
                            {n > 0 && (
                              <span
                                className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5 shrink-0"
                                title={`Already assigned to ${n} technician(s) — drag again to add another`}
                              >
                                ⚠ Assigned{n > 1 ? ` ×${n}` : ""}
                              </span>
                            )}
                            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", meta.badge)}>
                              {meta.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {(d?.pool.length ?? 0) === 0 && (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No active jobs for this day.
                </div>
              )}
            </div>
          </div>

          {/* ============ RIGHT: technicians (drop targets) ============ */}
          <div className="rounded-2xl border border-border bg-card/60 flex flex-col min-h-0">
            <div className="p-3 border-b border-border font-bold text-sm">
              Technicians{" "}
              <span className="text-muted-foreground font-normal">
                ({d?.technicians.length ?? 0})
              </span>
            </div>
            <div className="overflow-y-auto p-3 space-y-2 flex-1 min-h-0 max-h-[70vh]">
              {d?.technicians.map((t) => {
                const over = dragOverTech === t.airtableName;
                return (
                  <div
                    key={t.airtableName}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setDragOverTech(t.airtableName);
                    }}
                    onDragLeave={() =>
                      setDragOverTech((cur) => (cur === t.airtableName ? null : cur))
                    }
                    onDrop={(e) => onDropOnTech(e, t.airtableName)}
                    className={cn(
                      "rounded-xl border px-3 py-2 transition-all",
                      over
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5 scale-[1.01]"
                        : "border-border bg-background",
                    )}
                  >
                    {(() => {
                      const total = t.assignments.length;
                      const tentative = t.assignments.filter(
                        (a: any) => a.status !== "confirmed",
                      ).length;
                      const allConfirmed = total > 0 && tentative === 0;
                      return (
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                            {allConfirmed && (
                              <Check className="size-4 text-emerald-600 shrink-0" />
                            )}
                            {t.displayName}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-muted-foreground">
                              {total} job{total === 1 ? "" : "s"}
                            </span>
                            {tentative > 0 && (
                              <button
                                onClick={() =>
                                  confirmDayTech.mutate({
                                    date,
                                    technicianName: t.airtableName,
                                  })
                                }
                                disabled={confirmDayTech.isPending}
                                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-semibold hover:opacity-90"
                                title="Confirm this technician's day & notify them"
                              >
                                <Check className="size-3" /> Confirm
                              </button>
                            )}
                            {allConfirmed && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">
                                <Check className="size-3" /> Sent
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {t.assignments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {t.assignments.map((a) => (
                          <span
                            key={a.id}
                            title={
                              a.status === "confirmed"
                                ? "Confirmed — visible to the technician"
                                : "Tentative — NOT visible to the technician yet"
                            }
                            className={cn(
                              "group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                              a.status === "confirmed"
                                ? "border-border bg-card"
                                : "border-dashed border-amber-400 bg-amber-50",
                            )}
                          >
                            <span
                              className="size-1.5 rounded-full"
                              style={{
                                background:
                                  a.phase === "Pickup" ? "#16a34a" : "#2563eb",
                              }}
                            />
                            <span className="max-w-36 truncate">{a.company ?? a.jobId}</span>
                            {a.startTime && (
                              <span className="text-muted-foreground">{a.startTime}</span>
                            )}
                            <button
                              onClick={() => removeScheduled.mutate({ id: a.id })}
                              className="text-muted-foreground/60 hover:text-red-600"
                              title="Remove"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Drop dialog: choose the TASK and the TIME before saving — a worker
          doing several jobs a day gets each one at its own hour. */}
      {pending && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setPending(null)}
        >
          <div
            className="bg-card w-full max-w-sm rounded-2xl shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-bold">{pending.job.company ?? "Job"}</div>
            <div className="text-xs text-muted-foreground mb-3">
              → {pending.techName} · {prettyDay(date)}
            </div>

            <div className="text-xs font-medium text-muted-foreground mb-1">
              Task
            </div>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {TASKS.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    setPending((p) =>
                      p
                        ? {
                            ...p,
                            task: t,
                            start: TASK_TIMES[t].start,
                            end: TASK_TIMES[t].end,
                          }
                        : p,
                    )
                  }
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
                    pending.task === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Start time
                </div>
                <input
                  type="time"
                  value={pending.start}
                  onChange={(e) =>
                    setPending((p) => (p ? { ...p, start: e.target.value } : p))
                  }
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  End time
                </div>
                <input
                  type="time"
                  value={pending.end}
                  onChange={(e) =>
                    setPending((p) => (p ? { ...p, end: e.target.value } : p))
                  }
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={setScheduled.isPending}
                onClick={saveAssign}
              >
                {setScheduled.isPending && (
                  <Loader2 className="size-4 animate-spin mr-1" />
                )}
                Assign
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
