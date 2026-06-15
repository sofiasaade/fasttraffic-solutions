import { useMemo, useRef, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useInvalidateJobData } from "@/hooks/useInvalidateJobData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Clock,
  Users,
  Boxes,
  Truck as TruckIcon,
  X,
  GripVertical,
  Megaphone,
  MonitorSmartphone,
  Sunrise,
  Sunset,
  CheckCircle2,
} from "lucide-react";
import {
  durationCategory,
  categoryHeaderClasses,
} from "@/lib/jobDuration";
import { isCancelledJob } from "@shared/jobStatus";
import { subStatusColor, subStatusLegend } from "@shared/subStatusColors";
import { needsArrowboard, needsMessageBoard } from "@shared/equipmentSignals";

/* --------------------------- status categories --------------------------- */

type StatusKey = "submitted" | "approved" | "field" | "cancelled";
const STATUS_FILTERS: {
  key: StatusKey;
  title: string;
  dot: string;
}[] = [
  { key: "submitted", title: "Permit Request Submitted", dot: "#2563eb" },
  { key: "approved", title: "Permit Approved", dot: "#ea580c" },
  { key: "field", title: "Field", dot: "#16a34a" },
  { key: "cancelled", title: "Cancelled", dot: "#dc2626" },
];

function statusKeyOf(p: { status: string | null; subStatus: string | null }): StatusKey {
  if (isCancelledJob({ status: p.status, subStatus: p.subStatus })) return "cancelled";
  const st = (p.status ?? "").toLowerCase();
  if (st.includes("submitted")) return "submitted";
  if (st.includes("approved")) return "approved";
  return "field";
}
function statusMeta(key: StatusKey) {
  return STATUS_FILTERS.find((s) => s.key === key)!;
}

/* ------------------------- per-column color tint ------------------------- */
// Each project column is tinted by its Airtable "Sub-Status Field Operations"
// color so the board mirrors the classification colors used in Airtable.

/** Convert a #rrggbb hex to an rgba() string at the given alpha. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ----------------------------- date helpers ----------------------------- */

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function prettyDate(key: string): string {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10) || null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function hhmm(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
function label12(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const ap = hour < 12 ? "AM" : "PM";
  return `${h} ${ap}`;
}

/* ----------------------------- drag payload ----------------------------- */

type Kind = "worker" | "equipment" | "truck";
type DragData =
  // creating a new block from the resource panel
  | { mode: "create"; kind: Kind; name: string; color: string | null }
  // moving an existing block
  | {
      mode: "move";
      kind: Kind;
      id: number;
      name: string;
      phase: string | null;
      color: string | null;
    };

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const KIND_ICON: Record<Kind, typeof Users> = {
  worker: Users,
  equipment: Boxes,
  truck: TruckIcon,
};

function SummaryBox({
  icon: Icon,
  label,
  value,
  accent,
  secondary,
}: {
  icon: typeof Users;
  label: string;
  value: number | null;
  accent: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <div className={`shrink-0 ${accent}`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none">
          {value === null ? <span className="text-muted-foreground">—</span> : value}
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
          {label}
        </div>
        {secondary && (
          <div className="mt-0.5 text-[10px] text-muted-foreground">{secondary}</div>
        )}
      </div>
    </div>
  );
}

export default function DayTimeline() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const initialDate = params.get("date") || toKey(new Date());
  const [date, setDate] = useState(initialDate);
  const [range, setRange] = useState<"day" | "night" | "all">("all");
  const [search, setSearch] = useState("");
  const [showLegend, setShowLegend] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Record<StatusKey, boolean>>({
    submitted: true,
    approved: true,
    field: true,
    cancelled: true,
  });
  const toggleStatus = (key: StatusKey) =>
    setStatusFilter((prev) => ({ ...prev, [key]: !prev[key] }));
  const scrollRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const timelineQuery = trpc.coordinator.dayTimeline.useQuery({ date });
  const techQuery = trpc.coordinator.technicians.useQuery();
  const equipQuery = trpc.coordinator.equipmentCatalog.useQuery();
  const truckQuery = trpc.coordinator.truckCatalog.useQuery();

  const invalidateJobData = useInvalidateJobData();
  // Refresh the date-scoped timeline AND all other job-related windows so the
  // schedule stays consistent everywhere after a change here.
  const refresh = () => {
    utils.coordinator.dayTimeline.invalidate({ date });
    invalidateJobData();
  };

  const addBlock = trpc.coordinator.addTimelineBlock.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const moveBlock = trpc.coordinator.moveTimelineBlock.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });
  const removeBlock = trpc.coordinator.removeTimelineBlock.useMutation({
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  });

  const allProjects = (timelineQuery.data?.projects ?? []) as Project[];
  // Count per category (for the chip labels) and the filtered set shown.
  const statusCounts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      submitted: 0,
      approved: 0,
      field: 0,
      cancelled: 0,
    };
    for (const p of allProjects) c[statusKeyOf(p)]++;
    return c;
  }, [allProjects]);
  const projects = useMemo(
    () => allProjects.filter((p) => statusFilter[statusKeyOf(p)]),
    [allProjects, statusFilter],
  );

  // Daily summary totals (computed over the currently visible/filtered projects).
  // Arrowboards / message boards come from the Job Address signals.
  // before/at/after 9AM + finished/picked up come from the Street Use Permit
  // PDF analysis returned by the backend (permitSummary), when available.
  const summary = useMemo(() => {
    let arrowboards = 0;
    let messageBoards = 0;
    for (const p of projects) {
      if (needsArrowboard(p.jobAddress)) arrowboards++;
      if (needsMessageBoard(p.jobAddress)) messageBoards++;
    }
    return { arrowboards, messageBoards };
  }, [projects]);

  const permitSummary = (
    timelineQuery.data as unknown as {
      permitSummary?: {
        before9: number;
        at9: number;
        after9: number;
        finished: number;
        analyzed: number;
        total: number;
      };
    }
  )?.permitSummary;

  // Visible hour range based on the Day/Night toggle.
  const visibleHours = useMemo(() => {
    if (range === "day") return HOURS.filter((h) => h >= 6 && h < 18);
    if (range === "night") return HOURS.filter((h) => h >= 18 || h < 6);
    return HOURS;
  }, [range]);

  // Scroll to 6 AM on first load when showing all hours.
  useEffect(() => {
    if (range === "all" && scrollRef.current) {
      const rowH = 56;
      scrollRef.current.scrollTop = rowH * 6;
    }
  }, [range, timelineQuery.data]);

  const dragRef = useRef<DragData | null>(null);

  function onDropCell(projectId: string, hour: number) {
    const data = dragRef.current;
    dragRef.current = null;
    if (!data) return;
    const startTime = hhmm(hour);
    const endTime = hhmm((hour + 1) % 24 === 0 ? 24 : hour + 1).replace(
      "24:00",
      "23:59",
    );
    if (data.mode === "create") {
      addBlock.mutate({
        kind: data.kind,
        airtableJobId: projectId,
        scheduledDate: date,
        startTime,
        endTime,
        name: data.name,
        phase: data.kind === "worker" ? "Setup" : undefined,
      });
    } else {
      moveBlock.mutate({
        kind: data.kind,
        id: data.id,
        airtableJobId: projectId,
        scheduledDate: date,
        startTime,
        endTime,
      });
    }
  }

  const techs = (techQuery.data ?? []) as {
    id: number;
    airtableName: string;
    displayName: string;
  }[];
  const equipment = (equipQuery.data ?? []) as {
    id: number;
    name: string;
    color: string | null;
  }[];
  const trucks = (truckQuery.data ?? []) as {
    id: number;
    name: string;
    color: string | null;
  }[];

  const q = search.trim().toLowerCase();
  const fTechs = q
    ? techs.filter((t) => t.displayName.toLowerCase().includes(q))
    : techs;
  const fEquip = q
    ? equipment.filter((e) => e.name.toLowerCase().includes(q))
    : equipment;
  const fTrucks = q
    ? trucks.filter((t) => t.name.toLowerCase().includes(q))
    : trucks;

  return (
    <div className="flex h-[calc(100vh-1px)] flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3">
        <button
          onClick={() => navigate("/scheduler")}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Scheduler
        </button>
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Day Timeline</h1>
        </div>

        <div className="ml-2 flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8 bg-background"
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="bg-background"
            onClick={() => setDate(toKey(new Date()))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 bg-background"
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>

        <div className="text-sm font-medium text-muted-foreground">
          {prettyDate(date)}
        </div>

        {/* Day / Night / All toggle */}
        <div className="ml-auto flex items-center rounded-lg border border-border bg-background p-0.5 text-sm">
          {(
            [
              { k: "day", icon: Sun, label: "Day" },
              { k: "night", icon: Moon, label: "Night" },
              { k: "all", icon: Clock, label: "24h" },
            ] as const
          ).map(({ k, icon: Icon, label }) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${
                range === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Daily summary boxes */}
      <div className="grid grid-cols-2 gap-2 border-b border-border bg-muted/20 px-5 py-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryBox
          icon={Sunrise}
          label="Jobs before 9 AM"
          value={permitSummary ? permitSummary.before9 : null}
          accent="text-amber-600"
        />
        <SummaryBox
          icon={Clock}
          label="Jobs at 9 AM"
          value={permitSummary ? permitSummary.at9 : null}
          accent="text-blue-600"
        />
        <SummaryBox
          icon={Sunset}
          label="Jobs after 9 AM"
          value={permitSummary ? permitSummary.after9 : null}
          accent="text-indigo-600"
        />
        <SummaryBox
          icon={CheckCircle2}
          label="Finished / picked up"
          value={permitSummary ? permitSummary.finished : null}
          accent="text-emerald-600"
        />
        <SummaryBox
          icon={Megaphone}
          label="Arrowboards"
          value={summary.arrowboards}
          accent="text-orange-600"
          secondary={
            <span className="inline-flex items-center gap-0.5">
              <MonitorSmartphone className="size-3" /> {summary.messageBoards} msg board
              {summary.messageBoards === 1 ? "" : "s"}
            </span>
          }
        />
      </div>
      {permitSummary && permitSummary.analyzed < permitSummary.total && (
        <div className="border-b border-border bg-amber-50 px-5 py-1 text-[11px] text-amber-700">
          Permit times read from {permitSummary.analyzed} of {permitSummary.total} Street Use
          Permits ({permitSummary.total - permitSummary.analyzed} missing a readable permit PDF).
        </div>
      )}

      {/* Category filter row */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card/60 px-5 py-2">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          Filter:
        </span>
        {STATUS_FILTERS.map((s) => {
          const on = statusFilter[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggleStatus(s.key)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on
                  ? "bg-accent border-border text-foreground"
                  : "border-dashed border-border text-muted-foreground opacity-60 hover:opacity-100"
              }`}
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: s.dot }}
              />
              {s.title}
              <span className="opacity-70">({statusCounts[s.key]})</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowLegend((v) => !v)}
          className="ml-auto text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          {showLegend ? "Hide sub-status colors" : "Sub-status colors"}
        </button>
      </div>

      {/* Sub-status color legend (mirrors Airtable option colors) */}
      {showLegend && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-5 py-2">
          <span className="text-xs font-medium text-muted-foreground mr-1">
            Sub-Status Field Operations:
          </span>
          {subStatusLegend().map((l) => (
            <span
              key={l.label}
              className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: l.color.bg, color: l.color.text }}
            >
              {l.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Resource panel */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/30">
          <div className="border-b border-border p-2">
            <Input
              placeholder="Search resources…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 bg-background"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 space-y-3">
            <ResourceGroup title="Workers" icon={Users}>
              {fTechs.map((t) => (
                <ResourceChip
                  key={t.id}
                  label={t.displayName}
                  color={null}
                  onDragStart={() => {
                    dragRef.current = {
                      mode: "create",
                      kind: "worker",
                      name: t.airtableName,
                      color: null,
                    };
                  }}
                />
              ))}
            </ResourceGroup>
            <ResourceGroup title="Equipment" icon={Boxes}>
              {fEquip.map((e) => (
                <ResourceChip
                  key={e.id}
                  label={e.name}
                  color={e.color}
                  onDragStart={() => {
                    dragRef.current = {
                      mode: "create",
                      kind: "equipment",
                      name: e.name,
                      color: e.color,
                    };
                  }}
                />
              ))}
            </ResourceGroup>
            <ResourceGroup title="Trucks" icon={TruckIcon}>
              {fTrucks.map((t) => (
                <ResourceChip
                  key={t.id}
                  label={t.name}
                  color={t.color}
                  onDragStart={() => {
                    dragRef.current = {
                      mode: "create",
                      kind: "truck",
                      name: t.name,
                      color: t.color,
                    };
                  }}
                />
              ))}
            </ResourceGroup>
          </div>
        </aside>

        {/* Timeline grid */}
        <div className="min-h-0 min-w-0 flex-1 overflow-auto" ref={scrollRef}>
          {timelineQuery.isLoading && !timelineQuery.data ? (
            <div className="p-8 text-sm text-muted-foreground">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">
              {allProjects.length === 0
                ? `No projects scheduled on ${prettyDate(date)}. Jobs whose date range covers this day, or that already have assignments, appear here.`
                : "No jobs match the selected categories. Adjust the filter above."}
            </div>
          ) : (
            <div
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `64px repeat(${projects.length}, minmax(200px, 1fr))`,
              }}
            >
              {/* Header row */}
              <div className="sticky top-0 z-20 border-b border-r border-border bg-card" />
              {projects.map((p, idx) => {
                const cat = durationCategory(p.setupDuration);
                const h = categoryHeaderClasses(cat);
                const ssc = subStatusColor(p.subStatus);
                return (
                  <div
                    key={p.id}
                    className="sticky top-0 z-20 border-b border-r border-border"
                    style={{ backgroundColor: hexToRgba(ssc.bg, 0.16) }}
                  >
                    {/* Top bar colored by Airtable Sub-Status Field Operations */}
                    <div
                      className="h-1.5 w-full"
                      style={{ backgroundColor: ssc.bg }}
                      title={p.subStatus ?? undefined}
                    />
                    <div className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        {p.emoji && <span>{p.emoji}</span>}
                        <span className="truncate text-sm font-semibold">
                          {p.company || "Untitled"}
                        </span>
                      </div>
                      {p.projectTitle && (
                        <div className="truncate text-xs font-medium text-foreground/80">
                          {p.projectTitle}
                        </div>
                      )}
                      <div className="truncate text-xs text-muted-foreground">
                        {p.jobAddress || "—"}
                      </div>
                      {(p.municipality || p.zone) && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[p.municipality, p.zone].filter(Boolean).join(" · ")}
                        </div>
                      )}

                      {/* Start / End dates */}
                      {(() => {
                        const s = shortDate(p.startDate);
                        const e = shortDate(p.endDate);
                        if (!s && !e) return null;
                        return (
                          <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-border bg-background/60 px-1.5 py-1 text-[10px] leading-tight">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">Start</span>
                              <span className="font-medium">{s ?? "—"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-muted-foreground">End</span>
                              <span className="font-medium">{e ?? s ?? "—"}</span>
                            </div>
                          </div>
                        );
                      })()}

                      <div className="mt-1 flex flex-wrap gap-1">
                        {(() => {
                          const sk = statusKeyOf(p);
                          const meta = statusMeta(sk);
                          return (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              title={p.status ?? meta.title}
                            >
                              <span
                                className="size-1.5 rounded-full"
                                style={{ backgroundColor: meta.dot }}
                              />
                              {meta.title}
                            </span>
                          );
                        })()}
                        {p.subStatus && (
                          <span
                            className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: ssc.bg, color: ssc.text }}
                            title="Sub-Status Field Operations"
                          >
                            {p.subStatus}
                          </span>
                        )}
                        {p.setupDuration && (
                          <span
                            className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${h.chip}`}
                            title={p.setupDuration}
                          >
                            {p.setupDuration}
                          </span>
                        )}
                        {p.impact && (
                          <span className="inline-block rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {p.impact}
                          </span>
                        )}
                        {p.closureType && (
                          <span
                            className="inline-block rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={p.closureType}
                          >
                            {p.closureType}
                          </span>
                        )}
                      </div>

                      {(p.requestId || p.requestorName || p.siteContactPhone) && (
                        <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                          {p.requestId && (
                            <div className="truncate">ID: {p.requestId}</div>
                          )}
                          {p.requestorName && (
                            <div className="truncate">Requestor: {p.requestorName}</div>
                          )}
                          {p.siteContactPhone && (
                            <div className="truncate">
                              <a
                                href={`tel:${p.siteContactPhone}`}
                                className="hover:underline"
                              >
                                {p.siteContactPhone}
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Hour rows */}
              {visibleHours.map((hour) => (
                <HourRow
                  key={hour}
                  hour={hour}
                  projects={projects}
                  onDropCell={onDropCell}
                  dragRef={dragRef}
                  onRemove={(kind, id) => removeBlock.mutate({ kind, id })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- subcomponents ----------------------------- */

function ResourceGroup({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ResourceChip({
  label,
  color,
  onDragStart,
}: {
  label: string;
  color: string | null;
  onDragStart: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", label);
        onDragStart();
      }}
      className="flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs active:cursor-grabbing hover:bg-accent"
    >
      <GripVertical className="size-3 shrink-0 text-muted-foreground" />
      {color && (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

type Project = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  projectTitle?: string | null;
  emoji: string | null;
  setupDuration: string | null;
  closureType?: string | null;
  impact?: string | null;
  calendarInfo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  municipality?: string | null;
  zone?: string | null;
  requestId?: string | null;
  requestorName?: string | null;
  siteContactPhone?: string | null;
  status: string | null;
  subStatus: string | null;
  blocks: {
    kind: Kind;
    id: number;
    name: string;
    phase: string | null;
    startTime: string | null;
    endTime: string | null;
    color: string | null;
    driverName?: string | null;
  }[];
};

function HourRow({
  hour,
  projects,
  onDropCell,
  dragRef,
  onRemove,
}: {
  hour: number;
  projects: Project[];
  onDropCell: (projectId: string, hour: number) => void;
  dragRef: React.MutableRefObject<DragData | null>;
  onRemove: (kind: Kind, id: number) => void;
}) {
  return (
    <>
      {/* hour label */}
      <div className="sticky left-0 z-10 flex h-14 items-start justify-end border-b border-r border-border bg-card pr-2 pt-1 text-[11px] text-muted-foreground">
        {label12(hour)}
      </div>
      {projects.map((p) => {
        const blocks = p.blocks.filter((b) => {
          const start = b.startTime ? parseInt(b.startTime.slice(0, 2), 10) : null;
          return start === hour;
        });
        const ssc = subStatusColor(p.subStatus);
        return (
          <div
            key={p.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={() => onDropCell(p.id, hour)}
            className="relative h-14 border-b border-r border-border p-1 transition-colors hover:bg-accent/40"
            style={{ backgroundColor: hexToRgba(ssc.bg, 0.1) }}
          >
            <div className="flex flex-wrap gap-1">
              {blocks.map((b) => (
                <TimelineBlock
                  key={`${b.kind}-${b.id}`}
                  block={b}
                  projectId={p.id}
                  dragRef={dragRef}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function TimelineBlock({
  block,
  projectId,
  dragRef,
  onRemove,
}: {
  block: Project["blocks"][number];
  projectId: string;
  dragRef: React.MutableRefObject<DragData | null>;
  onRemove: (kind: Kind, id: number) => void;
}) {
  const Icon = KIND_ICON[block.kind];
  const bg =
    block.kind === "worker"
      ? "bg-emerald-100 text-emerald-900 border-emerald-300"
      : block.color
        ? ""
        : "bg-slate-100 text-slate-800 border-slate-300";
  const span =
    block.startTime && block.endTime
      ? `${block.startTime}–${block.endTime}`
      : "";
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", block.name);
        dragRef.current = {
          mode: "move",
          kind: block.kind,
          id: block.id,
          name: block.name,
          phase: block.phase,
          color: block.color,
        };
      }}
      title={`${block.name}${block.phase ? ` · ${block.phase}` : ""}${
        span ? ` · ${span}` : ""
      }`}
      style={
        block.color && block.kind !== "worker"
          ? { backgroundColor: `${block.color}22`, borderColor: block.color }
          : undefined
      }
      className={`group flex max-w-full cursor-grab items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium active:cursor-grabbing ${bg}`}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{block.name}</span>
      {block.phase && block.kind === "worker" && (
        <span className="shrink-0 opacity-70">· {block.phase}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(block.kind, block.id);
        }}
        className="ml-0.5 shrink-0 rounded opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
