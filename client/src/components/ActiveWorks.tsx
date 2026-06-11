import { useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { fmtDate } from "@/lib/format";
import { Loader2, MapPin, Building2, ArrowRight } from "lucide-react";

type MapJob = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  municipality: string | null;
  startDate: string | null;
  endDate: string | null;
  setupDuration: string | null;
  status: string | null;
  subStatus: string | null;
  zone: string;
  lat: number | null;
  lon: number | null;
};

/** "Active" = not cancelled/declined. */
function isActive(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return !(s.includes("cancel") || s.includes("declin"));
}

// Status groups shown on the dashboard, in priority order.
const GROUPS: {
  key: string;
  label: string;
  match: (s: string) => boolean;
  dot: string;
  headerBg: string;
}[] = [
  {
    key: "field",
    label: "Field",
    match: (s) => s === "field",
    dot: "#16a34a",
    headerBg: "bg-green-50 text-green-800",
  },
  {
    key: "permit-approved",
    label: "Permit Approved",
    match: (s) => s.includes("approved"),
    dot: "#ea580c",
    headerBg: "bg-orange-50 text-orange-800",
  },
  {
    key: "permit-requested",
    label: "Permit Request Submitted",
    match: (s) => s.includes("request") || s.includes("submitted"),
    dot: "#2563eb",
    headerBg: "bg-blue-50 text-blue-800",
  },
];

function JobTable({ jobs, dot }: { jobs: MapJob[]; dot: string }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {jobs.map((j) => (
          <tr key={j.id} className="hover:bg-accent/50 transition-colors">
            <td className="px-5 py-2.5 font-medium w-[28%]">
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ background: dot }}
                />
                <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                {j.company ?? "Job"}
              </span>
            </td>
            <td className="px-3 py-2.5 text-muted-foreground">
              {j.jobAddress ?? "—"}
            </td>
            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap w-[24%]">
              {fmtDate(j.startDate)} → {fmtDate(j.endDate)}
            </td>
            <td className="px-3 py-2.5 text-muted-foreground w-[18%]">{j.zone}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ActiveWorks() {
  const { data: jobs, isLoading } = trpc.coordinator.mapJobs.useQuery();

  const { grouped, otherActive, total } = useMemo(() => {
    const list = ((jobs as MapJob[] | undefined) ?? []).filter((j) =>
      isActive(j.status),
    );
    const grouped = GROUPS.map((g) => ({
      ...g,
      jobs: list.filter((j) => g.match((j.status ?? "").toLowerCase())),
    }));
    const claimed = new Set(grouped.flatMap((g) => g.jobs.map((j) => j.id)));
    const otherActive = list.filter((j) => !claimed.has(j.id));
    return { grouped, otherActive, total: list.length };
  }, [jobs]);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <MapPin className="size-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight">
            {isLoading ? "Active works" : `${total} Active works`}
          </h2>
        </div>
        <Link
          href="/map"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent transition-colors active:scale-[0.97]"
        >
          View on map <ArrowRight className="size-4" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-10 text-muted-foreground text-sm justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading active works…
        </div>
      ) : total === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          No active works right now.
        </div>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {grouped.map((g) =>
            g.jobs.length === 0 ? null : (
              <div key={g.key}>
                <div
                  className={`sticky top-0 z-10 flex items-center justify-between px-5 py-2 text-xs font-bold uppercase tracking-wide backdrop-blur ${g.headerBg}`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: g.dot }}
                    />
                    {g.label}
                  </span>
                  <span className="tabular-nums">{g.jobs.length}</span>
                </div>
                <JobTable jobs={g.jobs} dot={g.dot} />
              </div>
            ),
          )}

          {otherActive.length > 0 && (
            <div>
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-2 text-xs font-bold uppercase tracking-wide bg-muted/60 text-muted-foreground backdrop-blur">
                <span>Other</span>
                <span className="tabular-nums">{otherActive.length}</span>
              </div>
              <JobTable jobs={otherActive} dot="#94a3b8" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
