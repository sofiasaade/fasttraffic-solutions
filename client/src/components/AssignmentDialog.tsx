import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";

type Phase = "Preparation" | "Setup" | "Pickup";
const PHASES: Phase[] = ["Preparation", "Setup", "Pickup"];

interface Job {
  id: string;
  company: string | null;
  jobAddress: string | null;
  startDate: string | null;
  endDate: string | null;
  techPrep: string[];
  techSetup: string[];
  techPickup: string[];
}

interface Conflict {
  technician: string;
  otherJobId: string;
  otherJobLabel: string;
}

export default function AssignmentDialog({
  job,
  open,
  onOpenChange,
}: {
  job: Job | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const techQuery = trpc.coordinator.technicians.useQuery(undefined, {
    enabled: open,
  });
  const [phase, setPhase] = useState<Phase>("Preparation");
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingConflicts, setPendingConflicts] = useState<Conflict[] | null>(
    null,
  );

  const currentForPhase = useMemo(() => {
    if (!job) return [];
    if (phase === "Preparation") return job.techPrep;
    if (phase === "Setup") return job.techSetup;
    return job.techPickup;
  }, [job, phase]);

  useEffect(() => {
    setSelected(currentForPhase);
    setPendingConflicts(null);
  }, [currentForPhase, phase, job?.id]);

  const assign = trpc.coordinator.assignTechnicians.useMutation({
    onSuccess: (res) => {
      if (!res.ok) {
        setPendingConflicts(res.conflicts);
        return;
      }
      toast.success(`${phase} assignment saved`);
      setPendingConflicts(null);
      utils.coordinator.dispatchJobs.invalidate();
      utils.coordinator.jobDetail.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!job) return null;

  const toggle = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    setPendingConflicts(null);
  };

  const save = (force = false) => {
    assign.mutate({
      jobId: job.id,
      phase,
      technicians: selected,
      force,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign Technicians</DialogTitle>
          <DialogDescription>
            {job.company ?? "Job"} — {job.jobAddress ?? ""}
            <span className="block text-xs mt-1">
              {fmtDate(job.startDate)} → {fmtDate(job.endDate)}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Phase tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {PHASES.map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                phase === p
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Technician list */}
        <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
          {techQuery.isLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {techQuery.data?.map((t) => {
            const checked = selected.includes(t.airtableName);
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.airtableName)}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2.5 rounded-lg border text-left transition-colors",
                  checked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent",
                )}
              >
                <span className="font-medium text-sm">{t.displayName}</span>
                <span
                  className={cn(
                    "size-5 rounded-md border flex items-center justify-center",
                    checked
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/40",
                  )}
                >
                  {checked && <Check className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Conflict warning */}
        {pendingConflicts && pendingConflicts.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-destructive font-semibold text-sm">
              <AlertTriangle className="size-4" />
              Double-booking detected
            </div>
            <ul className="text-xs text-foreground/80 space-y-1">
              {pendingConflicts.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{c.technician}</span> overlaps with{" "}
                  {c.otherJobLabel}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => save(true)}
                disabled={assign.isPending}
              >
                Assign anyway
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPendingConflicts(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!pendingConflicts && (
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {selected.length} selected for {phase}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => save(false)} disabled={assign.isPending}>
                {assign.isPending && (
                  <Loader2 className="size-4 animate-spin mr-1" />
                )}
                Save {phase}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
