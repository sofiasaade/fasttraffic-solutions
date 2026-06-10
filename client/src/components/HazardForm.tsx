import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { HAZARD_CHECKLIST } from "@shared/airtableFields";

type Phase = "Preparation" | "Setup" | "Pickup";

export default function HazardForm({
  jobId,
  phase,
  open,
  onOpenChange,
  onSubmitted,
}: {
  jobId: string;
  phase: Phase;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [hazards, setHazards] = useState("");
  const [controls, setControls] = useState("");
  const [ppe, setPpe] = useState(false);
  const [signature, setSignature] = useState("");

  const submit = trpc.technician.submitHazard.useMutation({
    onSuccess: () => {
      toast.success("Hazard assessment submitted");
      onSubmitted();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const allChecked = HAZARD_CHECKLIST.every((i) => answers[i.key]);
  const canSubmit = allChecked && ppe && signature.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            Hazard Assessment
          </DialogTitle>
          <DialogDescription>
            Required before check-in — {phase} phase
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {HAZARD_CHECKLIST.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer"
            >
              <Checkbox
                checked={!!answers[item.key]}
                onCheckedChange={(v) =>
                  setAnswers((prev) => ({ ...prev, [item.key]: !!v }))
                }
                className="mt-0.5"
              />
              <span className="text-sm">{item.label}</span>
            </label>
          ))}

          <div className="grid gap-2">
            <Label>Hazards identified (optional)</Label>
            <Textarea
              value={hazards}
              onChange={(e) => setHazards(e.target.value)}
              rows={2}
              placeholder="Describe any specific hazards"
            />
          </div>
          <div className="grid gap-2">
            <Label>Control measures (optional)</Label>
            <Textarea
              value={controls}
              onChange={(e) => setControls(e.target.value)}
              rows={2}
              placeholder="Controls put in place"
            />
          </div>

          <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer bg-primary/5">
            <Checkbox
              checked={ppe}
              onCheckedChange={(v) => setPpe(!!v)}
            />
            <span className="text-sm font-medium">
              I am wearing all required PPE
            </span>
          </label>

          <div className="grid gap-2">
            <Label>Signature (type your full name)</Label>
            <Input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Full name"
            />
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!canSubmit || submit.isPending}
            onClick={() =>
              submit.mutate({
                jobId,
                phase,
                answers,
                hazardsIdentified: hazards || undefined,
                controlMeasures: controls || undefined,
                ppeConfirmed: ppe,
                signature,
              })
            }
          >
            {submit.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
            Submit assessment
          </Button>
          {!canSubmit && (
            <p className="text-xs text-muted-foreground text-center">
              Check all items, confirm PPE, and sign to enable submit.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
