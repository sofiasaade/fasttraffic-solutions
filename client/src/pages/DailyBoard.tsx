import { useMemo, useState } from "react";
import { Link } from "wouter";
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
  Hourglass,
  Check,
  FileText,
  Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { subStatusColor } from "@shared/subStatusColors";
import { fmtTime12 } from "@/lib/format";

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

// Time subgroups inside each phase section. 24-hour jobs get their own TIME
// group ("24 Hours") instead of an hour bucket.
const TIME_GROUPS = [
  { key: "before9", label: "Before 9:00 AM", icon: Sunrise },
  { key: "at9", label: "9:00 AM", icon: Clock },
  { key: "h24", label: "24 Hours", icon: Hourglass },
  { key: "after9", label: "After 9:00 AM", icon: Sun },
  { key: "notime", label: "No set time", icon: CircleHelp },
] as const;

// Pool sections. ONGOING is split by the Airtable Field-Operations sub-status
// — "Daily Setup (Field)" vs "24 Hours Setup (Field)" — per the coordinator's
// workflow; each section is then grouped by installation hour.
const POOL_PHASES = [
  { key: "starting", label: "Starting today", color: "#ea580c" },
  {
    key: "ongoingDaily",
    label: "Daily Setup (Field)",
    color: subStatusColor("Daily Setup (Field)").bg,
  },
  {
    key: "ongoing24h",
    label: "24 Hours Setup (Field)",
    color: subStatusColor("24 Hours Setup (Field)").bg,
  },
  { key: "pickup", label: "Pick up", color: "#16a34a" },
] as const;

const is24h = (
  setupDuration: string | null | undefined,
  subStatus?: string | null,
) => /24\s*hour/i.test(setupDuration ?? "") || /24\s*hour/i.test(subStatus ?? "");

const TASKS = [
  "Preparation",
  "Setup",
  "Set up aside",
  "No Parking",
  "Flagger",
  "Check up",
  "Pickup",
] as const;

// Suggested times per task (editable in the dialog before saving).
const TASK_TIMES: Record<string, { start: string; end: string }> = {
  Preparation: { start: "14:00", end: "16:00" },
  Setup: { start: "07:00", end: "15:00" },
  "Set up aside": { start: "07:00", end: "15:00" },
  "No Parking": { start: "07:00", end: "09:00" },
  Flagger: { start: "07:00", end: "17:00" },
  "Check up": { start: "10:00", end: "11:00" },
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
  // Click an assigned chip → edit its task/time/note.
  const [editing, setEditing] = useState<{
    id: number;
    jobId: string;
    techName: string;
    company: string;
    task: string;
    start: string;
    end: string;
    note: string;
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
  const updateScheduled = trpc.coordinator.updateScheduled.useMutation();
  const setAssignmentNote = trpc.coordinator.setAssignmentNote.useMutation();
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

  // Pool grouped by SECTION, then by installation TIME.
  // Ongoing splits by Field-Ops sub-status: Daily Setup vs 24 Hours Setup.
  // In Starting/Pickup, 24-hour jobs land in the "24 Hours" time group.
  const sectionOf = (j: any) =>
    j.phase === "ongoing"
      ? is24h(j.setupDuration, j.subStatus)
        ? "ongoing24h"
        : "ongoingDaily"
      : j.phase;
  // The hour a card lives by: Pick up cards use the permit END time (when the
  // signs come down); every other section uses the start time.
  const cardTimeOf = (j: any, section: string) =>
    section === "pickup" ? j.permitEndTime : j.permitStartTime;
  // Install-hour bucket: the city-permit time wins over the Airtable
  // work-hours text (24-hour jobs often have no hour in their work hours).
  const bucketOf = (j: any, section: string) => {
    const t = cardTimeOf(j, section);
    if (t) {
      const h = Number(String(t).split(":")[0]);
      if (!Number.isNaN(h)) return h < 9 ? "before9" : h === 9 ? "at9" : "after9";
    }
    return j.timeBucket;
  };
  const timeKeyOf = (j: any, section: string) =>
    section === "ongoing24h"
      ? bucketOf(j, section) // inside the 24h section, group by install hour
      : is24h(j.setupDuration, j.subStatus)
        ? "h24"
        : bucketOf(j, section);
  const poolByPhase = useMemo(() => {
    const empty = () =>
      ({ before9: [], at9: [], h24: [], after9: [], notime: [] }) as Record<string, any[]>;
    const groups: Record<string, Record<string, any[]>> = {
      starting: empty(),
      ongoingDaily: empty(),
      ongoing24h: empty(),
      pickup: empty(),
    };
    const ql = poolFilter.trim().toLowerCase();
    for (const j of d?.pool ?? []) {
      if (ql && !`${j.company ?? ""} ${j.jobAddress ?? ""}`.toLowerCase().includes(ql)) continue;
      const s = sectionOf(j);
      groups[s]?.[timeKeyOf(j, s)]?.push(j);
    }
    // Earliest first inside every group: city-permit time wins (END time in
    // Pick up), then the Airtable work-hours start; no-time jobs go last.
    const cardMinutes = (j: any, section: string) => {
      const t = cardTimeOf(j, section);
      if (t) {
        const [h, mm] = String(t).split(":").map(Number);
        if (!Number.isNaN(h)) return h * 60 + (mm || 0);
      }
      if (typeof j.startTime === "number") return j.startTime * 60;
      return 24 * 60 + 1;
    };
    for (const [section, ph] of Object.entries(groups)) {
      for (const arr of Object.values(ph)) {
        arr.sort((a, b) => cardMinutes(a, section) - cardMinutes(b, section));
      }
    }
    return groups;
  }, [d?.pool, poolFilter]);

  const phaseCounts = useMemo(() => {
    const c: Record<string, number> = {
      starting: 0,
      ongoingDaily: 0,
      ongoing24h: 0,
      pickup: 0,
    };
    for (const j of d?.pool ?? []) c[sectionOf(j)] = (c[sectionOf(j)] ?? 0) + 1;
    return c;
  }, [d?.pool]);

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
              {POOL_PHASES.map((ph) => (
                <div key={ph.key}>
                  <div
                    className="flex items-center gap-2 mb-2 pb-1 border-b-2"
                    style={{ borderColor: ph.color }}
                  >
                    <span className="size-3 rounded-full" style={{ background: ph.color }} />
                    <span className="text-sm font-extrabold">{ph.label}</span>
                    <span className="text-xs text-muted-foreground">
                      ({phaseCounts[ph.key] ?? 0})
                    </span>
                  </div>
                  {(phaseCounts[ph.key] ?? 0) === 0 && (
                    <div className="text-[11px] text-muted-foreground mb-3 ml-1">
                      Nothing in this section today.
                    </div>
                  )}
                  {TIME_GROUPS.map((g) => {
                    const jobs = poolByPhase[ph.key]?.[g.key] ?? [];
                    if (jobs.length === 0) return null;
                    const Icon = g.icon;
                    return (
                  <div key={g.key} className="mb-2 ml-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground mb-1.5">
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
                            <span
                              className="size-2.5 rounded-full shrink-0 ring-1 ring-black/10"
                              title={j.subStatus ?? undefined}
                              style={{ background: subStatusColor(j.subStatus).bg }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{j.company ?? "Job"}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {j.jobAddress ?? j.municipality ?? ""}
                              </div>
                              {(() => {
                                // Prefer the parsed city-permit time (END time
                                // on Pick up cards); else the work-hours window
                                // from Airtable "Setup Duration".
                                const isPickup = ph.key === "pickup";
                                const permitT = isPickup
                                  ? (j as any).permitEndTime
                                  : j.permitStartTime;
                                const range = (j.setupDuration ?? "").match(
                                  /\(([^)]*\d[^)]*)\)/,
                                )?.[1];
                                const shown = permitT || range;
                                if (!shown) return null;
                                return (
                                  <div
                                    className="text-[11px] font-semibold text-primary flex items-center gap-1 mt-0.5"
                                    title={
                                      permitT
                                        ? isPickup
                                          ? "City permit valid-to time (pickup)"
                                          : "City permit valid-from time"
                                        : "Work hours (Airtable)"
                                    }
                                  >
                                    <Landmark className="size-3 shrink-0" />
                                    <span className="truncate">
                                      {permitT
                                        ? `${isPickup ? "Pickup" : "Permit"} ${fmtTime12(permitT)}`
                                        : shown}
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>
                            {/* Project details + plans */}
                            <Link
                              href={`/projects/${j.id}`}
                              draggable={false}
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary shrink-0"
                              title="Project details & plans"
                            >
                              <FileText className="size-4" />
                            </Link>
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
                </div>
              ))}
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
                            className={cn(
                              "group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                              a.status === "confirmed"
                                ? "border-border bg-card"
                                : "border-dashed border-amber-400 bg-amber-50",
                            )}
                          >
                            <button
                              onClick={() =>
                                setEditing({
                                  id: a.id,
                                  jobId: a.jobId,
                                  techName: t.airtableName,
                                  company: a.company ?? a.jobId,
                                  task: a.phase,
                                  start: a.startTime ?? "",
                                  end: a.endTime ?? "",
                                  note: (a as any).note ?? "",
                                })
                              }
                              className="inline-flex items-center gap-1 hover:text-primary"
                              title="Edit time / task / note"
                            >
                              <span
                                className="size-2 rounded-full ring-1 ring-black/10"
                                title={(a as any).subStatus ?? undefined}
                                style={{
                                  background: subStatusColor(
                                    (a as any).subStatus,
                                  ).bg,
                                }}
                              />
                              <span className="max-w-36 truncate">
                                {a.company ?? a.jobId}
                              </span>
                              {a.startTime && (
                                <span className="text-muted-foreground">
                                  {fmtTime12(a.startTime)}
                                </span>
                              )}
                              {(a as any).note && (
                                <span title="Has a note">📝</span>
                              )}
                            </button>
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
      {/* Edit an already-assigned chip: task / time / note. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setEditing(null)}
        >
          <div
            className="bg-card w-full max-w-sm rounded-2xl shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-bold">{editing.company}</div>
            <div className="text-xs text-muted-foreground mb-3">
              → {editing.techName} · {prettyDay(date)}
            </div>

            <div className="text-xs font-medium text-muted-foreground mb-1">Task</div>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {TASKS.map((t) => (
                <button
                  key={t}
                  onClick={() => setEditing((p) => (p ? { ...p, task: t } : p))}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors",
                    editing.task === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Start time</div>
                <input type="time" value={editing.start}
                  onChange={(e) => setEditing((p) => (p ? { ...p, start: e.target.value } : p))}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm" />
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">End time</div>
                <input type="time" value={editing.end}
                  onChange={(e) => setEditing((p) => (p ? { ...p, end: e.target.value } : p))}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm" />
              </div>
            </div>

            <div className="text-xs font-medium text-muted-foreground mb-1">
              Note for the technician
            </div>
            <textarea
              value={editing.note}
              onChange={(e) => setEditing((p) => (p ? { ...p, note: e.target.value } : p))}
              placeholder="e.g. client asked not to block the driveway…"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm mb-4"
            />

            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-red-600"
                onClick={() => {
                  removeScheduled.mutate({ id: editing.id });
                  setEditing(null);
                }}
              >
                <X className="size-4 mr-1" /> Remove
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={updateScheduled.isPending}
                  onClick={async () => {
                    await updateScheduled.mutateAsync({
                      id: editing.id,
                      phase: editing.task as any,
                      startTime: editing.start || null,
                      endTime: editing.end || null,
                    });
                    await setAssignmentNote.mutateAsync({
                      jobId: editing.jobId,
                      technicianName: editing.techName,
                      note: editing.note.trim() || null,
                    });
                    toast.success("Assignment updated");
                    setEditing(null);
                    utils.coordinator.dayBoard.invalidate();
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
