import { useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, MapPin, Building2, Clock, ChevronRight, CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtDate, dayKey, fmtTimeRange } from "@/lib/format";
import type { MyJob } from "@/lib/jobTypes";

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
        <div className="flex flex-wrap gap-1 mt-2">
          {job.myPhases.map((p) => (
            <Badge key={p} variant="secondary" className="text-[11px]">
              {p}
            </Badge>
          ))}
        </div>
      </div>
      <ChevronRight className="size-5 text-muted-foreground shrink-0" />
    </Link>
  );
}

export default function MyJobs() {
  const jobsQuery = trpc.technician.myJobs.useQuery();

  const { today, upcoming, later } = useMemo(() => {
    const jobs = (jobsQuery.data ?? []) as MyJob[];
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
  }, [jobsQuery.data]);

  return (
    <div className="p-4">
      <h1 className="text-xl font-extrabold tracking-tight mb-4">My Jobs</h1>

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
