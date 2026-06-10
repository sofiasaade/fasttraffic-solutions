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
  const otQuery = trpc.coordinator.overtime.useQuery(undefined, {
    refetchInterval: 60000,
  });
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
        <p className="text-sm text-muted-foreground mb-5">
          Pay period {new Date(data.periodStart).toLocaleDateString("en-CA")} –{" "}
          {new Date(
            new Date(data.periodEnd).getTime() - 86400000,
          ).toLocaleDateString("en-CA")}
        </p>
      )}

      {/* Threshold control */}
      <div className="flex items-center gap-3 mb-6 p-4 bg-card border rounded-xl">
        <Clock className="size-5 text-primary" />
        <div className="flex-1">
          <div className="text-sm font-medium">Alberta overtime threshold</div>
          <div className="text-xs text-muted-foreground">
            Hours per pay period before overtime
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
                      ? `${s.remaining.toFixed(1)}h until overtime`
                      : `${Math.abs(s.remaining).toFixed(1)}h over`}
                  </span>
                  <span>{s.threshold}h</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
