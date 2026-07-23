import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, AlertTriangle, Clock, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function levelStyles(level: string) {
  switch (level) {
    case "over":
      return {
        bar: "bg-destructive",
        text: "text-destructive",
        badge: "destructive" as const,
        label: "Over 44h",
      };
    case "approaching":
      return {
        bar: "bg-amber-500",
        text: "text-amber-600",
        badge: "secondary" as const,
        label: "Approaching",
      };
    default:
      return {
        bar: "bg-primary",
        text: "text-muted-foreground",
        badge: "outline" as const,
        label: "OK",
      };
  }
}

export default function OvertimeDashboard() {
  const utils = trpc.useUtils();
  // Pay-period navigation: offset in periods from the current one (14 days).
  const [periodOffset, setPeriodOffset] = useState(0);
  const refDate = new Date(Date.now() + periodOffset * 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  const otQuery = trpc.coordinator.overtime.useQuery(
    periodOffset === 0 ? undefined : { date: refDate },
    { refetchInterval: 60000 },
  );
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState("");

  const setThresholdMut = trpc.coordinator.setOvertimeThreshold.useMutation({
    onSuccess: () => {
      toast.success("Threshold updated");
      setEditing(false);
      utils.coordinator.overtime.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const data = otQuery.data;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Overtime Monitoring
        </h1>
      </div>
      {data && (
        <div className="flex items-center gap-2 mb-5">
          <button
            type="button"
            onClick={() => setPeriodOffset((o) => o - 1)}
            aria-label="Previous pay period"
            className="flex items-center justify-center size-7 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground"
          >
            ‹
          </button>
          <p className="text-sm text-muted-foreground tabular-nums">
            {/* Period bounds are UTC-anchored — render in UTC so the label
                matches the company payroll calendar (Mon → closing Sunday). */}
            Pay period{" "}
            {new Date(data.periodStart).toLocaleDateString("en-CA", {
              timeZone: "UTC",
            })}{" "}
            –{" "}
            {new Date(
              new Date(data.periodEnd).getTime() - 86400000,
            ).toLocaleDateString("en-CA", { timeZone: "UTC" })}
          </p>
          <button
            type="button"
            onClick={() => setPeriodOffset((o) => o + 1)}
            aria-label="Next pay period"
            className="flex items-center justify-center size-7 rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground"
          >
            ›
          </button>
          {periodOffset !== 0 && (
            <button
              type="button"
              onClick={() => setPeriodOffset(0)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Current period
            </button>
          )}
        </div>
      )}

      {/* Threshold control */}
      <div className="flex items-center gap-3 mb-6 p-4 bg-card border rounded-xl">
        <Clock className="size-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-medium">Alberta overtime threshold</div>
          <div className="text-xs text-muted-foreground">
            Regular hours per WEEK before overtime — resets every Monday
          </div>
        </div>
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-24"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={String(data?.threshold ?? 44)}
            />
            <Button
              size="sm"
              onClick={() =>
                setThresholdMut.mutate({ threshold: Number(threshold) || 44 })
              }
              disabled={setThresholdMut.isPending}
            >
              <Check className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{data?.threshold ?? 44}h</span>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setThreshold(String(data?.threshold ?? 44));
                setEditing(true);
              }}
            >
              <Pencil className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {otQuery.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {data && (
        <div className="space-y-3">
          {data.statuses.map((s) => {
            const st = levelStyles(s.level);
            const pct = Math.min(100, (s.hours / s.threshold) * 100);
            return (
              <div
                key={s.airtableName}
                className="bg-card border rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{s.technicianName}</span>
                    {s.level === "over" && (
                      <AlertTriangle className="size-4 text-destructive" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-bold tabular-nums", st.text)}>
                      {s.hours.toFixed(1)}h
                    </span>
                    <Badge variant={st.badge}>{st.label}</Badge>
                  </div>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", st.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>
                    {s.remaining >= 0
                      ? `${s.remaining.toFixed(1)}h until overtime (worst week)`
                      : `${Math.abs(s.remaining).toFixed(1)}h over`}
                  </span>
                  <span>{s.threshold}h/week</span>
                </div>
                {/* Weekly breakdown: OT resets each week (44h regular per week). */}
                <div className="flex gap-3 text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                  <span>Week 1: {(s as any).week1Hours?.toFixed(1) ?? "0.0"}h</span>
                  <span>Week 2: {(s as any).week2Hours?.toFixed(1) ?? "0.0"}h</span>
                  <span className="font-semibold">
                    Total: {(s as any).totalHours?.toFixed(1) ?? "0.0"}h
                  </span>
                  {((s as any).overtimeHours ?? 0) > 0 && (
                    <span className="font-bold text-red-600">
                      OT: {(s as any).overtimeHours.toFixed(1)}h
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
