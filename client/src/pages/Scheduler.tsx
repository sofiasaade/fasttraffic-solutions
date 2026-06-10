import { useMemo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  Loader2,
  GripVertical,
  Search,
  Building2,
  AlertTriangle,
  X,
  Package,
  Users,
  Truck,
  MapPin,
  Calendar,
  Clock,
  Phone,
  User as UserIcon,
  FileText,
  Download,
  ExternalLink,
  Map as MapIcon,
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

type EquipmentRow = {
  id: number;
  jobId: string;
  equipmentName: string;
  scheduledDate: string;
  technicianName: string | null;
  quantity: number;
  notes: string | null;
};

type EquipmentItem = {
  id: number;
  name: string;
  category: string | null;
  color: string | null;
};

type TruckRow = {
  id: number;
  jobId: string;
  truckName: string;
  scheduledDate: string;
  driverName: string | null;
  notes: string | null;
};

type TruckItem = {
  id: number;
  name: string;
  plate: string | null;
  color: string | null;
};

// Drag payload: a worker, an equipment item, or a truck.
type DragPayload =
  | { kind: "worker"; techName: string; techDisplay: string }
  | { kind: "equipment"; equipmentName: string; color: string | null }
  | { kind: "truck"; truckName: string; color: string | null };

type PanelTab = "workers" | "equipment" | "trucks";

export default function Scheduler() {
  const jobsQuery = trpc.coordinator.boardJobs.useQuery();
  const techQuery = trpc.coordinator.technicians.useQuery();
  const equipmentCatalogQuery = trpc.coordinator.equipmentCatalog.useQuery();
  const utils = trpc.useUtils();
  const setScheduled = trpc.coordinator.setScheduled.useMutation();
  const removeScheduled = trpc.coordinator.removeScheduled.useMutation();
  const setEquipment = trpc.coordinator.setEquipment.useMutation();
  const removeEquipment = trpc.coordinator.removeEquipment.useMutation();
  const truckCatalogQuery = trpc.coordinator.truckCatalog.useQuery();
  const setTruck = trpc.coordinator.setTruck.useMutation();
  const removeTruck = trpc.coordinator.removeTruck.useMutation();

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<PanelTab>("workers");
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

  // Equipment placements for the visible week.
  const equipQuery = trpc.coordinator.equipmentAssignments.useQuery({
    startDate: dayKeys[0],
    endDate: dayKeys[6],
  });
  const equipment = (equipQuery.data ?? []) as EquipmentRow[];
  const catalog = (equipmentCatalogQuery.data ?? []) as EquipmentItem[];
  const colorByEquipment = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of catalog) m.set(e.name, e.color ?? "#475569");
    return m;
  }, [catalog]);

  // Truck placements for the visible week.
  const truckQuery = trpc.coordinator.truckAssignments.useQuery({
    startDate: dayKeys[0],
    endDate: dayKeys[6],
  });
  const trucks = (truckQuery.data ?? []) as TruckRow[];
  const truckCatalog = (truckCatalogQuery.data ?? []) as TruckItem[];
  const colorByTruck = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of truckCatalog) m.set(t.name, t.color ?? "#475569");
    return m;
  }, [truckCatalog]);

  // Worker drop dialog state
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

  // Equipment drop dialog state
  const [equipDrop, setEquipDrop] = useState<{
    job: Job;
    dayKey: string;
    equipmentName: string;
  } | null>(null);
  const [equipQty, setEquipQty] = useState(1);
  const [equipTech, setEquipTech] = useState<string>("none");
  const [equipNotes, setEquipNotes] = useState("");

  // Truck drop dialog state
  const [truckDrop, setTruckDrop] = useState<{
    job: Job;
    dayKey: string;
    truckName: string;
  } | null>(null);
  const [truckDriver, setTruckDriver] = useState<string>("none");
  const [truckNotes, setTruckNotes] = useState("");

  // Job detail side panel state
  const [detailJob, setDetailJob] = useState<Job | null>(null);

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

  const filteredEquipment = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.category ?? "").toLowerCase().includes(q),
    );
  }, [catalog, search]);

  const filteredTrucks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return truckCatalog;
    return truckCatalog.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.plate ?? "").toLowerCase().includes(q),
    );
  }, [truckCatalog, search]);

  const jobCoversDay = useCallback((job: Job, dk: string) => {
    const s = parseDayKey(job.startDate);
    const e = parseDayKey(job.endDate) || s;
    return dk >= s && dk <= e;
  }, []);

  // Scheduled worker chips for a (job, day).
  const chipsFor = useCallback(
    (jobId: string, dk: string) =>
      scheduled.filter((r) => r.jobId === jobId && r.scheduledDate === dk),
    [scheduled],
  );

  // Equipment chips for a (job, day).
  const equipFor = useCallback(
    (jobId: string, dk: string) =>
      equipment.filter((r) => r.jobId === jobId && r.scheduledDate === dk),
    [equipment],
  );

  // Truck chips for a (job, day).
  const trucksFor = useCallback(
    (jobId: string, dk: string) =>
      trucks.filter((r) => r.jobId === jobId && r.scheduledDate === dk),
    [trucks],
  );

  // ---- drag handlers ----
  const onDragStartWorker = (
    e: React.DragEvent,
    techName: string,
    techDisplay: string,
  ) => {
    const payload: DragPayload = { kind: "worker", techName, techDisplay };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDragStartEquipment = (
    e: React.DragEvent,
    equipmentName: string,
    color: string | null,
  ) => {
    const payload: DragPayload = { kind: "equipment", equipmentName, color };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDragStartTruck = (
    e: React.DragEvent,
    truckName: string,
    color: string | null,
  ) => {
    const payload: DragPayload = { kind: "truck", truckName, color };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDropCell = (e: React.DragEvent, job: Job, dk: string) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DragPayload;
      if (payload.kind === "worker") {
        setPhase("Setup");
        setStartTime("08:00");
        setEndTime("16:00");
        setPendingForce(null);
        setDrop({
          job,
          dayKey: dk,
          techName: payload.techName,
          techDisplay: payload.techDisplay,
        });
      } else if (payload.kind === "equipment") {
        setEquipQty(1);
        setEquipTech("none");
        setEquipNotes("");
        setEquipDrop({ job, dayKey: dk, equipmentName: payload.equipmentName });
      } else {
        setTruckDriver("none");
        setTruckNotes("");
        setTruckDrop({ job, dayKey: dk, truckName: payload.truckName });
      }
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

  const doScheduleEquipment = async () => {
    if (!equipDrop) return;
    await setEquipment.mutateAsync({
      jobId: equipDrop.job.id,
      equipmentName: equipDrop.equipmentName,
      scheduledDate: equipDrop.dayKey,
      technicianName: equipTech === "none" ? undefined : equipTech,
      quantity: equipQty,
      notes: equipNotes.trim() || undefined,
    });
    toast.success(
      `${equipQty}× ${equipDrop.equipmentName} scheduled on ${equipDrop.dayKey}.`,
    );
    setEquipDrop(null);
    utils.coordinator.equipmentAssignments.invalidate();
  };

  const removeChip = async (row: ScheduledRow) => {
    await removeScheduled.mutateAsync({ id: row.id });
    toast.success(`Removed ${row.technicianName} from ${row.scheduledDate}.`);
    utils.coordinator.scheduledAssignments.invalidate();
  };

  const removeEquipChip = async (row: EquipmentRow) => {
    await removeEquipment.mutateAsync({ id: row.id });
    toast.success(`Removed ${row.equipmentName} from ${row.scheduledDate}.`);
    utils.coordinator.equipmentAssignments.invalidate();
  };

  const doScheduleTruck = async () => {
    if (!truckDrop) return;
    await setTruck.mutateAsync({
      jobId: truckDrop.job.id,
      truckName: truckDrop.truckName,
      scheduledDate: truckDrop.dayKey,
      driverName: truckDriver === "none" ? undefined : truckDriver,
      notes: truckNotes.trim() || undefined,
    });
    toast.success(
      `${truckDrop.truckName} scheduled on ${truckDrop.dayKey}.`,
    );
    setTruckDrop(null);
    utils.coordinator.truckAssignments.invalidate();
  };

  const removeTruckChip = async (row: TruckRow) => {
    await removeTruck.mutateAsync({ id: row.id });
    toast.success(`Removed ${row.truckName} from ${row.scheduledDate}.`);
    utils.coordinator.truckAssignments.invalidate();
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
      {/* Job label — click to open full detail */}
      <button
        type="button"
        onClick={() => setDetailJob(job)}
        title="View job details & plan"
        className="group/jobcell text-left px-4 py-3 border-r border-border flex items-start gap-1.5 hover:bg-accent/40 transition-colors"
      >
        <ChevronRightIcon className="size-4 mt-0.5 text-muted-foreground shrink-0 transition-transform group-hover/jobcell:translate-x-0.5 group-hover/jobcell:text-primary" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate group-hover/jobcell:text-primary">
              {job.company ?? "—"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {job.jobAddress ?? "No address"}
          </div>
        </div>
      </button>

      {/* Day cells */}
      {dayKeys.map((dk, i) => {
        const covers = jobCoversDay(job, dk);
        const chips = chipsFor(job.id, dk);
        const equips = equipFor(job.id, dk);
        const truckChips = trucksFor(job.id, dk);
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
                  key={`w-${c.id}`}
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
              {equips.map((eq) => {
                const color = colorByEquipment.get(eq.equipmentName) ?? "#475569";
                return (
                  <button
                    key={`e-${eq.id}`}
                    type="button"
                    onClick={() => removeEquipChip(eq)}
                    title={`${eq.quantity}× ${eq.equipmentName}${
                      eq.technicianName ? ` • install: ${eq.technicianName}` : ""
                    }${eq.notes ? ` • ${eq.notes}` : ""} — click to remove`}
                    className="group w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate flex items-center gap-1"
                    style={{
                      backgroundColor: `${color}1a`,
                      borderColor: `${color}55`,
                      color,
                    }}
                  >
                    <Package className="size-3 shrink-0" />
                    <span className="truncate">
                      {eq.quantity > 1 ? `${eq.quantity}× ` : ""}
                      {eq.equipmentName}
                    </span>
                    <X className="size-3 opacity-0 group-hover:opacity-100 shrink-0 ml-auto" />
                  </button>
                );
              })}
              {truckChips.map((tk) => {
                const color = colorByTruck.get(tk.truckName) ?? "#475569";
                return (
                  <button
                    key={`t-${tk.id}`}
                    type="button"
                    onClick={() => removeTruckChip(tk)}
                    title={`${tk.truckName}${
                      tk.driverName ? ` • driver: ${tk.driverName}` : ""
                    }${tk.notes ? ` • ${tk.notes}` : ""} — click to remove`}
                    className="group w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate flex items-center gap-1 border-dashed"
                    style={{
                      backgroundColor: `${color}14`,
                      borderColor: `${color}66`,
                      color,
                    }}
                  >
                    <Truck className="size-3 shrink-0" />
                    <span className="truncate">
                      {tk.truckName}
                      {tk.driverName ? ` · ${tk.driverName}` : ""}
                    </span>
                    <X className="size-3 opacity-0 group-hover:opacity-100 shrink-0 ml-auto" />
                  </button>
                );
              })}
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
            Drag a worker or equipment onto a job/day to schedule it. Jobs
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
                            "size-4 transition-transform",
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

        {/* Resources panel: Workers / Equipment tabs */}
        <aside className="w-72 border-l border-border bg-card/40 flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <h2 className="font-bold text-sm mb-2">Resources</h2>
            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-muted rounded-lg mb-2">
              <button
                type="button"
                onClick={() => setTab("workers")}
                className={cn(
                  "flex items-center justify-center gap-1 text-xs font-medium rounded-md py-1.5 transition-colors",
                  tab === "workers"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Users className="size-3.5" />
                Workers
              </button>
              <button
                type="button"
                onClick={() => setTab("equipment")}
                className={cn(
                  "flex items-center justify-center gap-1 text-xs font-medium rounded-md py-1.5 transition-colors",
                  tab === "equipment"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Package className="size-3.5" />
                Equipment
              </button>
              <button
                type="button"
                onClick={() => setTab("trucks")}
                className={cn(
                  "flex items-center justify-center gap-1 text-xs font-medium rounded-md py-1.5 transition-colors",
                  tab === "trucks"
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Truck className="size-3.5" />
                Trucks
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mb-2">
              {tab === "workers"
                ? "Drag a name onto a job/day cell."
                : tab === "equipment"
                  ? "Drag equipment onto a job/day cell (e.g. No Parking signs the day before)."
                  : "Drag a truck onto a job/day cell and pick the driver for that day."}
            </p>
            <div className="relative">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  tab === "workers"
                    ? "Search workers"
                    : tab === "equipment"
                      ? "Search equipment"
                      : "Search trucks"
                }
                className="pl-8 h-9"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {tab === "workers" ? (
              workers.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No workers found.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {workers.map((w) => {
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
              )
            ) : tab === "equipment" ? (
              filteredEquipment.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No equipment found.
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredEquipment.map((eq) => {
                    const color = eq.color ?? "#475569";
                    return (
                      <li
                        key={eq.id}
                        draggable
                        onDragStart={(e) =>
                          onDragStartEquipment(e, eq.name, eq.color)
                        }
                        className="px-3 py-2.5 flex items-center gap-2 cursor-grab active:cursor-grabbing hover:bg-accent/60 transition-colors"
                      >
                        <GripVertical className="size-4 text-muted-foreground shrink-0" />
                        <span
                          className="size-3 rounded-sm shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {eq.name}
                          </div>
                          {eq.category && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {eq.category}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : filteredTrucks.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No trucks found.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredTrucks.map((tk) => {
                  const color = tk.color ?? "#475569";
                  return (
                    <li
                      key={tk.id}
                      draggable
                      onDragStart={(e) => onDragStartTruck(e, tk.name, tk.color)}
                      className="px-3 py-2.5 flex items-center gap-2 cursor-grab active:cursor-grabbing hover:bg-accent/60 transition-colors"
                    >
                      <GripVertical className="size-4 text-muted-foreground shrink-0" />
                      <Truck className="size-4 shrink-0" style={{ color }} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {tk.name}
                        </div>
                        {tk.plate && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {tk.plate}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Schedule-worker-on-drop dialog */}
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

      {/* Schedule-equipment-on-drop dialog */}
      <Dialog
        open={!!equipDrop}
        onOpenChange={(v) => {
          if (!v) setEquipDrop(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule equipment</DialogTitle>
            <DialogDescription>
              {equipDrop && (
                <>
                  Place <strong>{equipDrop.equipmentName}</strong> for{" "}
                  <strong>{equipDrop.job.company ?? "this job"}</strong> (
                  {equipDrop.job.jobAddress ?? "no address"}) on{" "}
                  <strong>{equipDrop.dayKey}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Quantity
                </label>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={equipQty}
                  onChange={(e) =>
                    setEquipQty(Math.max(1, Number(e.target.value) || 1))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Install by (optional)
                </label>
                <Select value={equipTech} onValueChange={setEquipTech}>
                  <SelectTrigger>
                    <SelectValue placeholder="No worker" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No worker</SelectItem>
                    {(techQuery.data ?? []).map((w) => (
                      <SelectItem key={w.id} value={w.airtableName}>
                        {w.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Notes (optional)
              </label>
              <Textarea
                value={equipNotes}
                onChange={(e) => setEquipNotes(e.target.value)}
                placeholder="e.g. Place No Parking signs along the north curb"
                rows={2}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tip: schedule No Parking signs the day before the closure, and
              assign a worker to install them.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEquipDrop(null)}>
              <X className="size-4 mr-1" />
              Cancel
            </Button>
            <Button
              onClick={doScheduleEquipment}
              disabled={setEquipment.isPending}
            >
              {setEquipment.isPending && (
                <Loader2 className="size-4 mr-1 animate-spin" />
              )}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule-truck-on-drop dialog */}
      <Dialog
        open={!!truckDrop}
        onOpenChange={(v) => {
          if (!v) setTruckDrop(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign truck</DialogTitle>
            <DialogDescription>
              {truckDrop && (
                <>
                  Assign <strong>{truckDrop.truckName}</strong> to{" "}
                  <strong>{truckDrop.job.company ?? "this job"}</strong> on{" "}
                  <strong>{truckDrop.dayKey}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Driver (optional)
              </label>
              <Select value={truckDriver} onValueChange={setTruckDriver}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No driver yet</SelectItem>
                  {(techQuery.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.airtableName}>
                      {w.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Notes (optional)
              </label>
              <Input
                value={truckNotes}
                onChange={(e) => setTruckNotes(e.target.value)}
                placeholder="e.g. fuel, trailer, special instructions"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTruckDrop(null)}>
              <X className="size-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={doScheduleTruck} disabled={setTruck.isPending}>
              {setTruck.isPending && (
                <Loader2 className="size-4 mr-1 animate-spin" />
              )}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Job detail side panel */}
      <Sheet open={!!detailJob} onOpenChange={(v) => !v && setDetailJob(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-0">
          {detailJob && (
            <div className="flex flex-col">
              <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  {detailJob.status && (
                    <Badge variant="secondary">{detailJob.status}</Badge>
                  )}
                  {detailJob.subStatus && (
                    <Badge variant="outline">{detailJob.subStatus}</Badge>
                  )}
                </div>
                <SheetTitle className="text-left text-xl">
                  {detailJob.company ?? "Untitled job"}
                </SheetTitle>
                {detailJob.projectTitle && (
                  <SheetDescription className="text-left">
                    {detailJob.projectTitle}
                  </SheetDescription>
                )}
              </SheetHeader>

              <div className="px-5 py-4 space-y-5 text-sm">
                {/* Key facts */}
                <div className="space-y-2.5">
                  <DetailRow icon={<MapPin className="size-4" />} label="Address">
                    {detailJob.jobAddress ?? "—"}
                  </DetailRow>
                  <DetailRow icon={<Calendar className="size-4" />} label="Dates">
                    {parseDayKey(detailJob.startDate) || "—"}
                    {detailJob.endDate &&
                    parseDayKey(detailJob.endDate) !== parseDayKey(detailJob.startDate)
                      ? ` → ${parseDayKey(detailJob.endDate)}`
                      : ""}
                  </DetailRow>
                  {detailJob.setupDuration && (
                    <DetailRow icon={<Clock className="size-4" />} label="Setup">
                      {detailJob.setupDuration}
                    </DetailRow>
                  )}
                  {(detailJob.municipality || detailJob.zone) && (
                    <DetailRow icon={<MapIcon className="size-4" />} label="Area">
                      {[detailJob.municipality, detailJob.zone]
                        .filter(Boolean)
                        .join(" • ")}
                    </DetailRow>
                  )}
                  {detailJob.requestorName && (
                    <DetailRow icon={<UserIcon className="size-4" />} label="Requestor">
                      {detailJob.requestorName}
                    </DetailRow>
                  )}
                  {detailJob.siteContactPhone && (
                    <DetailRow icon={<Phone className="size-4" />} label="Site contact">
                      <a
                        href={`tel:${detailJob.siteContactPhone}`}
                        className="text-primary hover:underline"
                      >
                        {detailJob.siteContactPhone}
                      </a>
                    </DetailRow>
                  )}
                  {detailJob.requestId && (
                    <DetailRow icon={<FileText className="size-4" />} label="Request ID">
                      {detailJob.requestId}
                    </DetailRow>
                  )}
                </div>

                {/* Technicians by phase */}
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-1.5">
                    <Users className="size-4 text-muted-foreground" />
                    Technicians
                  </h3>
                  <div className="space-y-1.5">
                    {PHASES.map((p) => {
                      const list =
                        p === "Preparation"
                          ? detailJob.techPrep
                          : p === "Setup"
                            ? detailJob.techSetup
                            : detailJob.techPickup;
                      return (
                        <div key={p} className="flex items-start gap-2">
                          <span
                            className={cn(
                              "text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 mt-0.5",
                              PHASE_COLOR[p],
                            )}
                          >
                            {p}
                          </span>
                          <span className="text-muted-foreground">
                            {list && list.length > 0 ? list.join(", ") : "Unassigned"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Job plan */}
                <div>
                  <h3 className="font-semibold mb-2 flex items-center gap-1.5">
                    <FileText className="size-4 text-muted-foreground" />
                    Job plan
                  </h3>
                  {detailJob.planFile && detailJob.planFile.length > 0 ? (
                    <div className="space-y-3">
                      {detailJob.planFile.map((f, idx) => (
                        <PlanPreview key={idx} url={f.url} filename={f.filename} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      No plan attached to this job.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="break-words">{children}</div>
      </div>
    </div>
  );
}

function PlanPreview({ url, filename }: { url: string; filename?: string }) {
  const lower = (filename ?? url).toLowerCase();
  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/.test(lower);
  const isPdf = /\.pdf(\?|$)/.test(lower);
  const name = filename ?? "Plan file";
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/50">
        <span className="text-xs font-medium truncate">{name}</span>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded hover:bg-accent"
            title="Open in new tab"
          >
            <ExternalLink className="size-3.5" />
          </a>
          <a
            href={url}
            download={filename}
            className="p-1.5 rounded hover:bg-accent"
            title="Download"
          >
            <Download className="size-3.5" />
          </a>
        </div>
      </div>
      {isImage ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img
            src={url}
            alt={name}
            className="w-full max-h-80 object-contain bg-background"
          />
        </a>
      ) : isPdf ? (
        <iframe
          src={url}
          title={name}
          className="w-full h-80 bg-background"
        />
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-4 text-sm text-primary hover:underline"
        >
          <FileText className="size-4" />
          Open {name}
        </a>
      )}
    </div>
  );
}
