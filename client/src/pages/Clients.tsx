import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Search,
  Building2,
  ChevronDown,
  MapPin,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";

/**
 * Projects grouped by CLIENT with their statuses. This is the foundation for
 * the future client portal: each client card is exactly what that client will
 * see when per-client logins are added (their in-progress projects + status).
 */

type Job = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  subStatus: string | null;
};

/** Normalize company names so "Kobi Construction Ltd" and "Kobi Construction Ltd." group together. */
function clientKey(company: string | null): string {
  return (company ?? "Unknown client")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+(ltd|inc|corp|llc|limited)\.?$/i, "")
    .trim();
}

function statusBadgeCls(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "field") return "bg-green-100 text-green-700";
  if (s.includes("approved")) return "bg-orange-100 text-orange-700";
  if (s.includes("submitted")) return "bg-blue-100 text-blue-700";
  if (s.includes("ready to bill")) return "bg-purple-100 text-purple-700";
  if (s.includes("picked up")) return "bg-rose-100 text-rose-700";
  if (s.includes("billed")) return "bg-slate-100 text-slate-600";
  if (s.includes("cancel") || s.includes("declin")) return "bg-red-100 text-red-700";
  return "bg-muted text-muted-foreground";
}

/** Sort order for statuses inside a client card: live work first. */
function statusRank(status: string | null): number {
  const s = (status ?? "").toLowerCase();
  if (s === "field") return 0;
  if (s.includes("approved")) return 1;
  if (s.includes("submitted")) return 2;
  if (s.includes("picked up")) return 3;
  if (s.includes("ready to bill")) return 4;
  return 5;
}

export default function Clients() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data, isLoading } = trpc.coordinator.mapJobs.useQuery();

  const clients = useMemo(() => {
    const jobs = ((data as Job[] | undefined) ?? []).filter((j) => {
      const s = (j.status ?? "").toLowerCase();
      return !(s.includes("cancel") || s.includes("declin"));
    });
    const byClient = new Map<string, { name: string; jobs: Job[] }>();
    for (const j of jobs) {
      const key = clientKey(j.company);
      const entry = byClient.get(key) ?? { name: j.company ?? "Unknown client", jobs: [] };
      entry.jobs.push(j);
      byClient.set(key, entry);
    }
    let list = Array.from(byClient.entries()).map(([key, v]) => ({
      key,
      name: v.name,
      jobs: v.jobs.sort(
        (a, b) =>
          statusRank(a.status) - statusRank(b.status) ||
          (b.startDate ?? "").localeCompare(a.startDate ?? ""),
      ),
      inField: v.jobs.filter((j) => (j.status ?? "") === "Field").length,
    }));
    const ql = q.trim().toLowerCase();
    if (ql) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(ql) ||
          c.jobs.some((j) => (j.jobAddress ?? "").toLowerCase().includes(ql)),
      );
    }
    // Most active clients first, then alphabetical.
    return list.sort(
      (a, b) => b.inField - a.inField || b.jobs.length - a.jobs.length || a.name.localeCompare(b.name),
    );
  }, [data, q]);

  const totals = useMemo(() => {
    const jobs = clients.flatMap((c) => c.jobs);
    return { clients: clients.length, jobs: jobs.length };
  }, [clients]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
            <Briefcase className="size-5 text-primary" /> Clients
          </h1>
          <p className="text-xs text-muted-foreground">
            Projects grouped by client with live status — the future client-portal view.
          </p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {isLoading ? "…" : `${totals.clients} clients · ${totals.jobs} projects`}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search client or address…"
          className="pl-8 h-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading clients…
        </div>
      ) : clients.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No clients match.
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => {
            const isOpen = open[c.key] ?? false;
            // Status summary chips for the collapsed card.
            const byStatus = new Map<string, number>();
            for (const j of c.jobs) {
              const s = j.status ?? "—";
              byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
            }
            return (
              <div
                key={c.key}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpen((p) => ({ ...p, [c.key]: !isOpen }))}
                  className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
                >
                  <span className="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary shrink-0">
                    <Building2 className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold truncate">{c.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {c.jobs.length} project{c.jobs.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    {Array.from(byStatus.entries()).map(([s, n]) => (
                      <span
                        key={s}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums",
                          statusBadgeCls(s),
                        )}
                      >
                        {s} ({n})
                      </span>
                    ))}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border divide-y divide-border/60">
                    {c.jobs.map((j) => {
                      return (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => navigate(`/projects/${j.id}`)}
                          className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-accent/40 transition-colors"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 flex-1">
                            <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{j.jobAddress ?? "No address"}</span>
                          </span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                            {fmtDate(j.startDate)} → {fmtDate(j.endDate)}
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn("text-[10px]", statusBadgeCls(j.status))}
                          >
                            {j.status ?? "—"}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
