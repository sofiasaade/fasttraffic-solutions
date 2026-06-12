import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DayViewMap, { type DayMarker } from "@/components/DayViewMap";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarPlus,
  CalendarRange,
  PackageCheck,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Building2,
  Sunrise,
  Clock,
  Sunset,
  HelpCircle,
  CheckCircle2,
  Users,
} from "lucide-react";

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export { toKey as dayKey };

function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toKey(dt);
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

type DayJob = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  projectTitle: string | null;
  emoji: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  subStatus: string | null;
  setupDuration?: string | null;
  assignmentState?: string;
  permitStartTime?: string | null;
  nineAmBucket?: "before9" | "at9" | "after9" | "unknown";
  isCancelled?: boolean;
  techPrep?: string[];
  techSetup?: string[];
  techPickup?: string[];
};

/** Format an HH:MM (24h) permit time into a friendly 12h label. */
function prettyTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

function durationLabel(setup: string | null | undefined): {
  text: string;
  cls: string;
} | null {
  const v = (setup ?? "").toLowerCase();
  if (!v) return null;
  if (/24\s*hour/.test(v))
    return { text: "24h", cls: "bg-purple-100 text-purple-700" };
  if (/several\s+(days|nights)|daily set|nightly set/.test(v))
    return { text: "Daily", cls: "bg-blue-100 text-blue-700" };
  if (/night/.test(v))
    return { text: "Night", cls: "bg-indigo-100 text-indigo-700" };
  if (/daytime|day\s*time/.test(v))
    return { text: "Daytime", cls: "bg-amber-100 text-amber-700" };
  return null;
}

function JobCard({ job, onClick }: { job: DayJob; onClick: () => void }) {
  const cancelled = !!job.isCancelled;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border p-3 transition-all active:scale-[0.99]",
        cancelled
          ? "border-red-200 bg-red-50/60 hover:border-red-300"
          : "border-border bg-card hover:border-orange-300 hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "text-xl leading-none shrink-0",
            cancelled && "grayscale opacity-70",
          )}
        >
          {job.emoji || "📍"}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-1.5 font-semibold text-sm truncate",
              cancelled && "line-through text-muted-foreground",
            )}
          >
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{job.company || "—"}</span>
            {cancelled && (
              <span className="ml-1 shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 no-underline">
                {(job.status || "Cancelled").includes("Declin")
                  ? "Declined"
                  : "Cancelled"}
              </span>
            )}
            {!cancelled && (job.techPrep?.length ?? 0) > 0 && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                <CheckCircle2 className="size-3" /> Prepared
              </span>
            )}
          </div>
          {job.jobAddress && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.jobAddress}</span>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>
              {shortDate(job.startDate)} → {shortDate(job.endDate)}
            </span>
            {(() => {
              const dl = durationLabel(job.setupDuration);
              return dl ? (
                <span className={cn("rounded px-1.5 py-0.5 font-medium", dl.cls)}>
                  {dl.text}
                </span>
              ) : null;
            })()}
            {prettyTime(job.permitStartTime) && (
              <span className="inline-flex items-center gap-0.5 rounded bg-orange-50 px-1.5 py-0.5 font-medium text-orange-700">
                <Clock className="size-3" /> {prettyTime(job.permitStartTime)}
              </span>
            )}
            {job.subStatus && (
              <span className="truncate rounded bg-muted px-1.5 py-0.5">
                {job.subStatus}
              </span>
            )}
          </div>
          <CrewByPhase job={job} />
        </div>
      </div>
    </button>
  );
}

/**
 * Renders the technicians assigned to a job, grouped and ORDERED by phase:
 * Preparation → Setup → Pickup. Each name carries its phase label.
 */
function CrewByPhase({ job }: { job: DayJob }) {
  const phases: { key: string; label: string; cls: string; names: string[] }[] = [
    { key: "prep", label: "Prep", cls: "bg-emerald-100 text-emerald-700", names: job.techPrep ?? [] },
    { key: "setup", label: "Setup", cls: "bg-blue-100 text-blue-700", names: job.techSetup ?? [] },
    { key: "pickup", label: "Pickup", cls: "bg-green-100 text-green-700", names: job.techPickup ?? [] },
  ];
  const hasAny = phases.some((p) => p.names.length > 0);
  if (!hasAny) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <Users className="size-3 text-muted-foreground shrink-0" />
      {phases.flatMap((p) =>
        p.names.map((name, i) => (
          <span
            key={`${p.key}-${i}-${name}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
          >
            <span className={cn("rounded px-1 font-bold uppercase tracking-wide", p.cls)}>
              {p.label}
            </span>
            <span className="text-foreground">{name}</span>
          </span>
        )),
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  accent,
  jobs,
  isLoading,
  onJob,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  accent: string;
  jobs: DayJob[];
  isLoading: boolean;
  onJob: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 flex flex-col min-h-[140px]">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="flex items-center justify-center size-7 rounded-lg shrink-0"
          style={{ background: `${accent}1a`, color: accent }}
        >
          <Icon className="size-4" />
        </div>
        <h3 className="font-bold text-sm">{title}</h3>
        <span className="ml-auto text-sm font-extrabold" style={{ color: accent }}>
          {isLoading ? "…" : jobs.length}
        </span>
      </div>
      <div className="space-y-2 flex-1">
        {isLoading ? (
          <>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </>
        ) : jobs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-6">
            No jobs
          </div>
        ) : (
          jobs.map((j) => <JobCard key={j.id} job={j} onClick={() => onJob(j.id)} />)
        )}
      </div>
    </div>
  );
}

/** A column split into before / at / after 9 AM sub-groups by permit start time. */
function BucketedSection({
  title,
  accent,
  icon: HeaderIcon,
  jobs,
  isLoading,
  onJob,
}: {
  title: string;
  accent: string;
  icon: React.ComponentType<{ className?: string }>;
  jobs: DayJob[];
  isLoading: boolean;
  onJob: (id: string) => void;
}) {
  const groups: {
    key: "before9" | "at9" | "after9" | "unknown";
    label: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    color: string;
  }[] = [
    { key: "before9", label: "Jobs before 9 AM", icon: Sunrise, color: "#d97706" },
    { key: "at9", label: "Jobs at 9 AM", icon: Clock, color: "#2563eb" },
    { key: "after9", label: "Jobs after 9 AM", icon: Sunset, color: "#4f46e5" },
    { key: "unknown", label: "Time not in permit", icon: HelpCircle, color: "#64748b" },
  ];
  const byBucket = (b: string) =>
    jobs.filter((j) => (j.nineAmBucket ?? "unknown") === b);

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4 flex flex-col min-h-[140px]">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="flex items-center justify-center size-7 rounded-lg shrink-0"
          style={{ background: `${accent}1a`, color: accent }}
        >
          <HeaderIcon className="size-4" />
        </div>
        <h3 className="font-bold text-sm">{title}</h3>
        <span className="ml-auto text-sm font-extrabold" style={{ color: accent }}>
          {isLoading ? "…" : jobs.length}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2 flex-1">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-xs text-muted-foreground py-6">
          No jobs
        </div>
      ) : (
        <div className="space-y-3 flex-1">
          {groups.map((g) => {
            const list = byBucket(g.key);
            if (list.length === 0) return null;
            const Icon = g.icon;
            return (
              <div key={g.key}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className="size-3.5" style={{ color: g.color }} />
                  <span
                    className="text-[11px] font-bold uppercase tracking-wide"
                    style={{ color: g.color }}
                  >
                    {g.label}
                  </span>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    ({list.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {list.map((j) => (
                    <JobCard key={j.id} job={j} onClick={() => onJob(j.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DashboardDay({
  date,
  setDate,
}: {
  date: string;
  setDate: (updater: string | ((d: string) => string)) => void;
}) {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.coordinator.dashboardDay.useQuery({ date });

  const isToday = date === toKey(new Date());
  // No dedicated job-detail route exists; send the coordinator to the
  // scheduler where jobs are managed/assigned.
  const onJob = (_id: string) => navigate("/scheduler");

  // Build map markers from all three buckets. Single-day jobs naturally appear
  // in both startingToday and pickup; DayViewMap de-dupes by id for the map.
  const mapMarkers = useMemo<DayMarker[]>(() => {
    const mk = (list: DayJob[] | undefined, bucket: DayMarker["bucket"]) =>
      ((list as any[]) ?? [])
        .filter((j) => !j.isCancelled)
        .map((j) => ({ ...j, bucket }));
    return [
      ...mk(data?.startingToday as DayJob[] | undefined, "starting"),
      ...mk(data?.ongoing as DayJob[] | undefined, "ongoing"),
      ...mk(data?.pickup as DayJob[] | undefined, "pickup"),
    ];
  }, [data]);

  const pretty = (() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">Day view</h2>
          <p className="text-xs text-muted-foreground">
            {pretty}
            {isToday && " · Today"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isToday && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDate(toKey(new Date()))}
            >
              Today
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <BucketedSection
          title="Starting today"
          accent="#ea580c"
          icon={CalendarPlus}
          jobs={(data?.startingToday as DayJob[]) ?? []}
          isLoading={isLoading}
          onJob={onJob}
        />
        <BucketedSection
          title="Ongoing (daily)"
          accent="#2563eb"
          icon={CalendarRange}
          jobs={(data?.ongoing as DayJob[]) ?? []}
          isLoading={isLoading}
          onJob={onJob}
        />
        <Section
          icon={PackageCheck}
          title="Pick up today"
          accent="#16a34a"
          jobs={(data?.pickup as DayJob[]) ?? []}
          isLoading={isLoading}
          onJob={onJob}
        />
      </div>

      {/* Map of the day's jobs (starting / ongoing / pickup). */}
      <DayViewMap markers={mapMarkers} isLoading={isLoading} />
    </div>
  );
}
