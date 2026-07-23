import { trpc } from "@/lib/trpc";
import { Loader2, Clock, TrendingUp, CircleDot } from "lucide-react";

function fmtHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(new Date(endIso).getTime() - 1);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MyHours() {
  const q = trpc.technician.myHours.useQuery();

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const data = q.data;
  if (!data) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No hours recorded yet. Check in on a job to start tracking your time.
      </div>
    );
  }

  const pct =
    data.threshold > 0
      ? Math.min(100, (data.regularHours / data.threshold) * 100)
      : 0;

  return (
    <div className="p-4">
      <h1 className="text-xl font-extrabold tracking-tight">My Hours</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        Pay period {fmtRange(data.period.start, data.period.end)}
      </p>

      {/* Big total for the current pay period */}
      <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-4xl font-extrabold tabular-nums leading-none">
              {fmtHours(data.totalHours)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              total this period
            </div>
          </div>
          {data.openLog && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 text-green-700 px-2.5 py-1 text-[11px] font-semibold">
              <CircleDot className="size-3 animate-pulse" /> On the clock
            </span>
          )}
        </div>

        {/* Regular-hours progress toward the OT threshold */}
        <div className="mt-4">
          <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
            <span>0h</span>
            <span>OT after {data.threshold}h</span>
          </div>
        </div>
      </div>

      {/* Regular vs overtime split */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
            <Clock className="size-3.5" /> Regular
          </div>
          <div className="text-2xl font-extrabold tabular-nums mt-1">
            {fmtHours(data.regularHours)}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "#c2410c" }}>
            <TrendingUp className="size-3.5" /> Overtime
          </div>
          <div
            className="text-2xl font-extrabold tabular-nums mt-1"
            style={{ color: data.overtimeHours > 0 ? "#c2410c" : undefined }}
          >
            {fmtHours(data.overtimeHours)}
          </div>
        </div>
      </div>

      {/* Recent entries */}
      <h2 className="font-bold mt-6 mb-2">Recent entries</h2>
      {data.recent.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-5 text-center">
          No check-ins yet.
        </div>
      ) : (
        <div className="space-y-2">
          {data.recent.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 shadow-xs"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{l.phase ?? "Shift"}</div>
                <div className="text-[11px] text-muted-foreground">
                  {fmtDateTime(l.checkInAt)}
                  {l.checkOutAt ? ` → ${fmtDateTime(l.checkOutAt)}` : " · in progress"}
                </div>
              </div>
              <div className="text-sm font-bold tabular-nums shrink-0">
                {l.hours != null ? fmtHours(l.hours) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
