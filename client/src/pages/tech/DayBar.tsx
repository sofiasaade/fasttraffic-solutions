import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Truck, LogOut, ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Day bar for the technician app: warehouse check-in picking the truck for the
 * day, and the end-of-day check-out — which stays LOCKED until every job
 * worked today has its hazard assessment submitted.
 */
export default function DayBar() {
  const utils = trpc.useUtils();
  const q = trpc.technician.dayStatus.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [truck, setTruck] = useState<string>("");

  const start = trpc.technician.startDay.useMutation({
    onSuccess: () => {
      toast.success("Day started — drive safe!");
      utils.technician.dayStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const end = trpc.technician.endDay.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Checked out. See you tomorrow!");
      } else {
        toast.error(
          `Hazard assessment missing for: ${r.missingHazards.join(", ")}. Complete them before checking out.`,
          { duration: 8000 },
        );
      }
      utils.technician.dayStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const d = q.data;
  if (!d) return null;

  // Not checked in yet → truck picker.
  if (!d.session) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm mb-4">
        <div className="flex items-center gap-2 font-bold text-sm mb-2">
          <Truck className="size-4 text-primary" /> Start your day
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Pick the truck you&apos;ll drive today, then check in.
        </p>
        <div className="flex gap-2">
          <Select value={truck} onValueChange={setTruck}>
            <SelectTrigger className="h-9 flex-1">
              <SelectValue placeholder="Choose a truck…" />
            </SelectTrigger>
            <SelectContent>
              {d.trucks.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                  {t.ref ? ` · ${t.ref}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-9"
            disabled={!truck || start.isPending}
            onClick={() => {
              const t = d.trucks.find((x) => x.name === truck);
              start.mutate({ truckName: truck, truckCode: t?.code ?? null });
            }}
          >
            Check in
          </Button>
        </div>
      </div>
    );
  }

  const done = !!d.session.checkOutAt;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-bold text-sm">
            <Truck className="size-4 text-primary" />
            <span className="truncate">
              {d.session.truckName ?? "No truck"}
              {d.session.truckCode ? ` (${d.session.truckCode})` : ""}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {done ? "Day complete — checked out." : "On duty today"}
          </div>
        </div>
        {!done && (
          <Button
            size="sm"
            variant={d.canCheckOut ? "default" : "outline"}
            disabled={end.isPending}
            onClick={() => end.mutate()}
          >
            <LogOut className="size-4 mr-1" /> End day
          </Button>
        )}
        {done && <CheckCircle2 className="size-5 text-green-600 shrink-0" />}
      </div>

      {/* Hazard gate warning */}
      {!done && d.missingHazardCount > 0 && (
        <div className="flex items-center gap-1.5 mt-3 rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-[12px] font-medium">
          <ShieldAlert className="size-4 shrink-0" />
          {d.missingHazardCount} hazard assessment
          {d.missingHazardCount === 1 ? "" : "s"} pending — required before you
          can check out.
        </div>
      )}
    </div>
  );
}
