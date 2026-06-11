import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { fmtDate } from "@/lib/format";
import {
  Loader2,
  MapPin,
  Building2,
  ArrowRight,
  ChevronDown,
  HardHat,
  FileClock,
  FileCheck2,
} from "lucide-react";

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

type GroupDef = {
  key: string;
  label: string;
  match: (s: string) => boolean;
  dot: string;
  Icon: typeof HardHat;
  /** Tailwind classes for the count card accent. */
  cardAccent: string;
  iconWrap: string;
};

// Status groups shown on the dashboard, in priority order.
const GROUPS: GroupDef[] = [
  {
    key: "field",
    label: "Field",
    match: (s) => s === "field",
    dot: "#16a34a",
    Icon: HardHat,
    cardAccent: "data-[active=true]:ring-green-500/60 data-[active=true]:bg-green-50",
    iconWrap: "bg-green-100 text-green-700",
  },
  {
    key: "permit-requested",
    label: "Permit Request Submitted",
    match: (s) => s.includes("request") || s.includes("submitted"),
    dot: "#2563eb",
    Icon: FileClock,
    cardAccent: "data-[active=true]:ring-blue-500/60 data-[active=true]:bg-blue-50",
    iconWrap: "bg-blue-100 text-blue-700",
  },
  {
    key: "permit-approved",
    label: "Permit Approved",
    match: (s) => s.includes("approved"),
    dot: "#ea580c",
    Icon: FileCheck2,
    cardAccent: "data-[active=true]:ring-orange-500/60 data-[active=true]:bg-orange-50",
    iconWrap: "bg-orange-100 text-orange-700",
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

  // Collapsed state per group key. Default: all collapsed so nothing forces scroll.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

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
        <div>
          {/* Count cards — click to expand/collapse the matching section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4">
            {grouped.map((g) => {
              const isOpen = !!open[g.key];
              return (
                <button
                  key={g.key}
                  type="button"
                  data-active={isOpen}
                  onClick={() => toggle(g.key)}
                  className={`group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left ring-2 ring-transparent transition-all duration-200 hover:bg-accent/50 active:scale-[0.98] ${g.cardAccent}`}
                >
                  <span
                    className={`flex size-10 items-center justify-center rounded-lg ${g.iconWrap}`}
                  >
                    <g.Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-2xl font-bold leading-none tabular-nums">
                      {g.jobs.length}
                    </span>
                    <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
                      {g.label}
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* Collapsible sections */}
          <div className="border-t border-border">
            {grouped.map((g) =>
              g.jobs.length === 0 ? null : (
                <div key={g.key} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(g.key)}
                    className={`flex w-full items-center justify-between px-5 py-2.5 text-xs font-bold uppercase tracking-wide transition-colors hover:brightness-95 ${
                      g.key === "field"
                        ? "bg-green-50 text-green-800"
                        : g.key === "permit-requested"
                          ? "bg-blue-50 text-blue-800"
                          : "bg-orange-50 text-orange-800"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: g.dot }}
                      />
                      {g.label}
                      <span className="tabular-nums opacity-70">
                        ({g.jobs.length})
                      </span>
                    </span>
                    <ChevronDown
                      className={`size-4 transition-transform duration-200 ${
                        open[g.key] ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {open[g.key] && (
                    <div className="max-h-[360px] overflow-y-auto">
                      <JobTable jobs={g.jobs} dot={g.dot} />
                    </div>
                  )}
                </div>
              ),
            )}

            {otherActive.length > 0 && (
              <div className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle("other")}
                  className="flex w-full items-center justify-between px-5 py-2.5 text-xs font-bold uppercase tracking-wide bg-muted/60 text-muted-foreground transition-colors hover:brightness-95"
                >
                  <span className="flex items-center gap-2">
                    Other
                    <span className="tabular-nums opacity-70">
                      ({otherActive.length})
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-4 transition-transform duration-200 ${
                      open["other"] ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {open["other"] && (
                  <div className="max-h-[360px] overflow-y-auto">
                    <JobTable jobs={otherActive} dot="#94a3b8" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
