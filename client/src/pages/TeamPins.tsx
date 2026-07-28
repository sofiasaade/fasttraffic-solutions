import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, RefreshCw, UserCog } from "lucide-react";
import { toast } from "sonner";

export default function TeamPins() {
  const utils = trpc.useUtils();
  const q = trpc.coordinator.teamPins.useQuery();
  const [coordPin, setCoordPin] = useState("");

  const reset = trpc.coordinator.resetTechPin.useMutation({
    onSuccess: (r) => {
      toast.success(`New PIN: ${r.pin}`);
      utils.coordinator.teamPins.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setCoord = trpc.coordinator.setCoordinatorPin.useMutation({
    onSuccess: () => {
      toast.success("Coordinator PIN updated");
      setCoordPin("");
      utils.coordinator.teamPins.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const d = q.data;

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
        <KeyRound className="size-6 text-primary" /> Team PINs
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5 mb-5">
        Each person signs in with their PIN. Technicians see only their own
        jobs; the coordinator PIN opens the full console. Share PINs privately.
      </p>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Coordinator PIN */}
          <div className="rounded-2xl border border-border bg-card p-4 mb-4">
            <div className="flex items-center gap-2 font-bold text-sm mb-2">
              <UserCog className="size-4 text-primary" /> Coordinator PIN
            </div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-extrabold tabular-nums tracking-widest">
                {d?.coordinatorPin ?? "—"}
              </span>
              <input
                value={coordPin}
                onChange={(e) => setCoordPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="New PIN"
                className="h-9 w-28 rounded-md border border-border bg-background px-3 text-sm ml-auto"
              />
              <Button
                size="sm"
                disabled={coordPin.length < 4 || setCoord.isPending}
                onClick={() => setCoord.mutate({ pin: coordPin })}
              >
                Change
              </Button>
            </div>
          </div>

          {/* Technician PINs */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground">
              {d?.technicians.length ?? 0} technicians
            </div>
            <div className="divide-y divide-border">
              {d?.technicians.map((t) => (
                <div
                  key={t.airtableName}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="font-medium text-sm flex-1 truncate">
                    {t.displayName}
                  </div>
                  <span className="text-lg font-extrabold tabular-nums tracking-widest">
                    {t.pin ?? "—"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reset.isPending}
                    onClick={() => reset.mutate({ technicianName: t.airtableName })}
                    title="Generate a new PIN"
                  >
                    <RefreshCw className="size-3.5 mr-1" /> Reset
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
