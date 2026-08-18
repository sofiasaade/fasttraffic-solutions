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
import { dayKey, fmtTimeRange, fmtTime12 } from "@/lib/format";
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
              {fmtTime12((job as any).assignedStartTime)}
              {(job as any).assignedEndTime
                ? ` – ${fmtTime12((job as any).assignedEndTime)}`
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

  // ONE day at a time: the tech picks a WORK DAY and sees only that day's
  // jobs (replaces the confusing "Next 7 days" list). Days are CALGARY days —
  // a UTC key would flip "today" to tomorrow every evening after 6 PM.
  const calgaryDay = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", {
      timeZone: "America/Edmonton",
    });
  const todayKey = calgaryDay(0);
  const [selDay, setSelDay] = useState(todayKey);

  const { dayJobs, workDays } = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    const jobs = ((jobsQuery.data ?? []) as MyJob[]).filter(
      (j) =>
        !q ||
        `${j.company ?? ""} ${j.jobAddress ?? ""}`.toLowerCase().includes(q),
    );
    const covers = (j: MyJob, d: string) => {
      const start = dayKey(j.startDate);
      const end = dayKey(j.endDate) || start;
      return !!start && d >= start && d <= end;
    };
    // Chips: today + the next 14 days that actually have work.
    const workDays: string[] = [];
    for (let i = 0; i < 15; i++) {
      const d = calgaryDay(i);
      if (i === 0 || jobs.some((j) => covers(j, d))) workDays.push(d);
    }
    const dayJobs = jobs
      .filter((j) => covers(j, selDay))
      .sort((a, b) => dayKey(a.startDate).localeCompare(dayKey(b.startDate)));
    return { dayJobs, workDays };
  }, [jobsQuery.data, clientFilter, selDay]);

  const todayPins = useMemo(
    () =>
      dayJobs
        .filter((j) => typeof j.lat === "number" && typeof j.lon === "number")
        .map((j) => ({
          lat: j.lat as number,
          lon: j.lon as number,
          label: `${j.company ?? "Job"} — ${j.jobAddress ?? ""}`,
        })),
    [dayJobs],
  );

  const chipLabel = (d: string) => {
    if (d === todayKey) return "Today";
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
    });
  };

  // Header label for the selected day — parse components locally so a plain
  // "YYYY-MM-DD" never shifts a day across timezones (fmtDate would).
  const dayHeading = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

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
          {/* Work-day filter: pick the day, see only that day's jobs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-3">
            {workDays.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelDay(d)}
                className={
                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition-colors " +
                  (selDay === d
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {chipLabel(d)}
              </button>
            ))}
            <input
              type="date"
              value={selDay}
              onChange={(e) => e.target.value && setSelDay(e.target.value)}
              className="shrink-0 h-8 rounded-lg border border-border bg-card px-2 text-xs"
              aria-label="Pick a work day"
            />
          </div>

          <section className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-4 text-primary" />
              <h2 className="font-bold">
                {selDay === todayKey ? "Today" : dayHeading(selDay)}
              </h2>
              <Badge>{dayJobs.length}</Badge>
            </div>
            <div className="space-y-2">
              {dayJobs.length === 0 ? (
                <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-5 text-center">
                  No jobs scheduled for this day.
                </div>
              ) : (
                dayJobs.map((j) => <JobRow key={j.id} job={j} />)
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
