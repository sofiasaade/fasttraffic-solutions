import { useLocation } from "wouter";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Building2,
  MapPin,
  CalendarRange,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Search,
  X,
} from "lucide-react";

function formatDate(value: string | null): string {
  if (!value) return "No date";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function PendingJobs() {
  const [, navigate] = useLocation();
  const pending = trpc.coordinator.pendingJobs.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const allJobs = pending.data?.jobs ?? [];
  const [search, setSearch] = useState("");
  const jobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allJobs;
    return allJobs.filter((j) =>
      `${j.company ?? ""} ${j.jobAddress ?? ""} ${j.municipality ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [allJobs, search]);
  const count = pending.data?.count ?? 0;

  return (
    <div className="container py-6 max-w-5xl">
      <div className="flex items-start gap-3 mb-6">
        <div className="mt-0.5 rounded-xl bg-rose-100 p-2.5 text-rose-600">
          <AlertTriangle className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Pending Jobs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Jobs with <span className="font-medium">no technician assigned</span>{" "}
            yet. Assign a technician in the Scheduler, then confirm them to
            notify the worker.
          </p>
        </div>
      </div>

      {pending.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="size-5 animate-spin" />
          Loading pending jobs…
        </div>
      ) : count === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-16 text-center">
          <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
          <div className="font-semibold text-lg">No pending jobs</div>
          <p className="text-sm text-muted-foreground mt-1">
            Every active job has at least one technician assigned.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-rose-600">
              {count} job{count === 1 ? "" : "s"} need a technician
            </div>
            <div className="relative w-full max-w-xs">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search pending jobs…"
                className="pl-8 h-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
          {jobs.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card py-10 text-center text-sm text-muted-foreground">
              No pending jobs match “{search.trim()}”.
            </div>
          )}
          {jobs.map((job) => (
            <div
              key={job.id}
              className="group rounded-xl border border-border bg-card p-4 flex items-start gap-3 hover:border-rose-300 hover:shadow-sm transition-all"
            >
              <div className="shrink-0 text-2xl leading-none mt-0.5" aria-hidden>
                {job.emoji ?? (
                  <Building2 className="size-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold truncate">
                    {job.company ?? "Untitled job"}
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border border-rose-300 bg-rose-50 text-rose-700">
                    <AlertTriangle className="size-2.5" />
                    Pending
                  </span>
                  {job.zone && (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border border-border bg-muted text-muted-foreground">
                      {job.zone}
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {job.jobAddress ?? "No address"}
                    {job.municipality ? ` · ${job.municipality}` : ""}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <CalendarRange className="size-3.5 shrink-0" />
                  <span>
                    {formatDate(job.startDate)}
                    {job.endDate && job.endDate !== job.startDate
                      ? ` → ${formatDate(job.endDate)}`
                      : ""}
                  </span>
                  {job.status && (
                    <span className="ml-1 text-xs text-muted-foreground/80">
                      · {job.status}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-rose-300 text-rose-700 hover:bg-rose-50"
                onClick={() =>
                  navigate(`/scheduler?project=${encodeURIComponent(job.id)}`)
                }
              >
                Assign
                <ArrowRight className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
