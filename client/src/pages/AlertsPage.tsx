import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, BellRing, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CHANGE_META,
  describeChange,
  type ChangeType,
  type JobChangeRow,
} from "@/components/ChangeBadge";
import { cn } from "@/lib/utils";

const FILTERS: { key: "all" | ChangeType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "postponed", label: "Postponed" },
  { key: "modified", label: "Modified" },
  { key: "cancelled", label: "Cancelled" },
];

export default function AlertsPage() {
  const utils = trpc.useUtils();
  const recent = trpc.coordinator.recentChanges.useQuery();
  const [filter, setFilter] = useState<"all" | ChangeType>("all");

  const runDetection = trpc.coordinator.runChangeDetection.useMutation({
    onSuccess: (r) => {
      toast.success(
        `Detection complete — ${r.total} change(s) across ${r.jobsInWindow} job(s) in window`,
      );
      utils.coordinator.recentChanges.invalidate();
      utils.coordinator.changeBadges.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const acknowledge = trpc.coordinator.acknowledgeChanges.useMutation({
    onSuccess: () => {
      utils.coordinator.recentChanges.invalidate();
      utils.coordinator.changeBadges.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const rows = (recent.data ?? []) as unknown as JobChangeRow[];

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.changeType === filter)),
    [rows, filter],
  );

  // Group by job (airtableJobId).
  const groups = useMemo(() => {
    const m = new Map<string, JobChangeRow[]>();
    for (const r of filtered) {
      const k = r.airtableJobId;
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.changeType] = (c[r.changeType] ?? 0) + 1;
    return c;
  }, [rows]);

  const unackIds = filtered
    .filter((r) => !r.acknowledgedAt)
    .map((r) => r.id);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <BellRing className="size-6 text-primary" />
          <h1 className="text-2xl font-extrabold tracking-tight">
            Change Alerts
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {unackIds.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => acknowledge.mutate({ ids: unackIds })}
              disabled={acknowledge.isPending}
            >
              <Check className="size-4 mr-1" />
              Acknowledge all ({unackIds.length})
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => runDetection.mutate()}
            disabled={runDetection.isPending}
          >
            {runDetection.isPending ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="size-4 mr-1" />
            )}
            Run detection now
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Jobs within the next 5 days that were added, cancelled, postponed, or
        modified in Airtable. Read-only — nothing is written back.
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            {f.label}
            {counts[f.key] ? (
              <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {recent.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!recent.isLoading && groups.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <BellRing className="size-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No changes detected in the current window.</p>
          <p className="text-xs mt-1">
            Run detection to take the first snapshot.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map(([jobId, changes]) => {
          const head = changes[0];
          const allAck = changes.every((c) => c.acknowledgedAt);
          return (
            <div
              key={jobId}
              className={cn(
                "bg-card border rounded-xl p-4",
                allAck && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">
                    {head.company ?? "Unknown company"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {head.requestId ? `Req ${head.requestId} · ` : ""}
                    {head.startDate ? `Start ${head.startDate}` : "No start date"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!allAck && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() =>
                        acknowledge.mutate({
                          ids: changes
                            .filter((c) => !c.acknowledgedAt)
                            .map((c) => c.id),
                        })
                      }
                    >
                      <Check className="size-3.5 mr-1" />
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {changes.map((c) => {
                  const meta = CHANGE_META[c.changeType];
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 text-sm flex-wrap"
                    >
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", meta.badge)}
                      >
                        {meta.label}
                      </Badge>
                      <span className="text-muted-foreground">
                        {describeChange(c)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 ml-auto">
                        {c.detectedDate}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
