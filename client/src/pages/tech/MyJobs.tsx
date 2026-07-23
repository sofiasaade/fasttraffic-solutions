import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  MapPin,
  Building2,
  Clock,
  ChevronRight,
  CalendarDays,
  StickyNote,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtDate, dayKey, fmtTimeRange } from "@/lib/format";
import type { MyJob } from "@/lib/jobTypes";
import DayBar from "./DayBar";
import TechDayMap from "@/components/TechDayMap";

function JobRow({ job }: { job: MyJob }) {
  return (
    <Link
      href={`/app/job/${job.id}`}
      className="flex items-center gap-3 bg-card border rounded-xl p-4 active:scale-[0.99] transition-transform"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground shrink-0" />
          <span className="font-semibold truncate">{job.company ?? "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">{job.jobAddress ?? "No address"}</span>
        </div>
        {job.setupDuration && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
            <Clock className="size-3.5 shrink-0" />
            <span className="truncate">
              {fmtTimeRange(job.setupDuration) || job.setupDuration}
            </span>
          </div>
        )}
        {/* Coordinator note for this assignment */}
        {(job as any).coordinatorNote && (
          <div className="flex items-start gap-1.5 text-xs mt-1.5 rounded-lg bg-blue-50 text-blue-800 px-2 py-1.5">
            <StickyNote className="size-3.5 shrink-0 mt-0.5" />
            <span>{(job as any).coordinatorNote}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-1 mt-2 items-center">
          {/* Assigned start time — the schedule order key */}
          {(job as any).assignedStartTime && (
            <Badge className="text-[11px]">
              {(job as any).assignedStartTime}
              {(job as any).assignedEndTime
                ? `–${(job as any).assignedEndTime}`
                : ""}
            </Badge>
          )}
          {job.myPhases.map((p) => (
            <Badge key={p} variant="secondary" className="text-[11px]">
              {p}
            </Badge>
          ))}
          {(job as any).completedAt ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
              <CheckCircle2 className="size-3.5" /> Done
            </span>
          ) : !(job as any).hazardDoneToday ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
              <ShieldAlert className="size-3.5" /> Hazard pending
            </span>
          ) : null}
        </div>
      </div>
      <ChevronRight className="size-5 text-muted-foreground shrink-0" />
    </Link>
  );
}

export default function MyJobs() {
  const jobsQuery = trpc.technician.myJobs.useQuery();
  // Filter my jobs by client / address (find a specific customer fast).
  const [clientFilter, setClientFilter] = useState("");

  const { today, upcoming, later } = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    const jobs = ((jobsQuery.data ?? []) as MyJob[]).filter(
      (j) =>
        !q ||
        `${j.company ?? ""} ${j.jobAddress ?? ""}`.toLowerCase().includes(q),
    );
    const todayKey = dayKey(new Date().toISOString());
    const weekFromNow = dayKey(
      new Date(Date.now() + 7 * 86400000).toISOString(),
    );
    const today: MyJob[] = [];
    const upcoming: MyJob[] = [];
    const later: MyJob[] = [];
    for (const j of jobs) {
      const start = dayKey(j.startDate);
      const end = dayKey(j.endDate) || start;
      if (start && end && todayKey >= start && todayKey <= end) {
        today.push(j);
      } else if (start > todayKey && start <= weekFromNow) {
        upcoming.push(j);
      } else if (start > weekFromNow) {
        later.push(j);
      }
    }
    const sortByStart = (a: MyJob, b: MyJob) =>
      dayKey(a.startDate).localeCompare(dayKey(b.startDate));
    upcoming.sort(sortByStart);
    later.sort(sortByStart);
    return { today, upcoming, later };
  }, [jobsQuery.data, clientFilter]);

  const todayPins = useMemo(
    () =>
      today
        .filter((j) => typeof j.lat === "number" && typeof j.lon === "number")
        .map((j) => ({
          lat: j.lat as number,
          lon: j.lon as number,
          label: `${j.company ?? "Job"} — ${j.jobAddress ?? ""}`,
        })),
    [today],
  );

  return (
    <div className="p-4">
      <h1 className="text-xl font-extrabold tracking-tight mb-3">My Jobs</h1>

      {/* Find a specific client / address among my assignments */}
      <div className="relative mb-3">
        <input
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          placeholder="Search client or address…"
          className="w-full h-10 rounded-xl border border-border bg-card px-3 pr-8 text-sm"
        />
        {clientFilter && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setClientFilter("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        )}
      </div>

      {/* Day session: truck pick + gated end-of-day */}
      <DayBar />

      {/* All of today's jobs pinned on one map */}
      <TechDayMap points={todayPins} />

      {jobsQuery.isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {jobsQuery.data && (
        <>
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-4 text-primary" />
              <h2 className="font-bold">Today</h2>
              <Badge>{today.length}</Badge>
            </div>
            <div className="space-y-2">
              {today.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-5 text-center">
                  No jobs scheduled for today.
                </div>
              ) : (
                today.map((j) => <JobRow key={j.id} job={j} />)
              )}
            </div>
          </section>

          <section className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="size-4 text-primary" />
              <h2 className="font-bold">Next 7 days</h2>
              <Badge variant="secondary">{upcoming.length}</Badge>
            </div>
            <div className="space-y-2">
              {upcoming.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-5 text-center">
                  Nothing scheduled this week.
                </div>
              ) : (
                upcoming.map((j) => (
                  <div key={j.id}>
                    <div className="text-xs text-muted-foreground mb-1 ml-1">
                      {fmtDate(j.startDate)}
                    </div>
                    <JobRow job={j} />
                  </div>
                ))
              )}
            </div>
          </section>

          {later.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                <h2 className="font-bold text-muted-foreground">Later</h2>
                <Badge variant="outline">{later.length}</Badge>
              </div>
              <div className="space-y-2">
                {later.map((j) => (
                  <div key={j.id}>
                    <div className="text-xs text-muted-foreground mb-1 ml-1">
                      {fmtDate(j.startDate)}
                    </div>
                    <JobRow job={j} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
