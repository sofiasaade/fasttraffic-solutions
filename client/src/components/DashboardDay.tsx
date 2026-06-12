import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
} from "lucide-react";

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  assignmentState?: string;
};

function JobCard({ job, onClick }: { job: DayJob; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card p-3 hover:border-orange-300 hover:shadow-sm transition-all active:scale-[0.99]"
    >
      <div className="flex items-start gap-2.5">
        <div className="text-xl leading-none shrink-0">{job.emoji || "📍"}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold text-sm truncate">
            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{job.company || "—"}</span>
          </div>
          {job.jobAddress && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.jobAddress}</span>
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {shortDate(job.startDate)} → {shortDate(job.endDate)}
            </span>
            {job.subStatus && (
              <span className="truncate rounded bg-muted px-1.5 py-0.5">
                {job.subStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
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

export default function DashboardDay() {
  const [, navigate] = useLocation();
  const [date, setDate] = useState(() => toKey(new Date()));
  const { data, isLoading } = trpc.coordinator.dashboardDay.useQuery({ date });

  const isToday = date === toKey(new Date());
  // No dedicated job-detail route exists; send the coordinator to the
  // scheduler where jobs are managed/assigned.
  const onJob = (_id: string) => navigate("/scheduler");

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
        <Section
          icon={CalendarPlus}
          title="Starting today"
          accent="#ea580c"
          jobs={(data?.startingToday as DayJob[]) ?? []}
          isLoading={isLoading}
          onJob={onJob}
        />
        <Section
          icon={CalendarRange}
          title="Ongoing (daily)"
          accent="#2563eb"
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
    </div>
  );
}
