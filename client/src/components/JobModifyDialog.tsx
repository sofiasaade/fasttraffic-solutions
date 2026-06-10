import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { SUB_STATUS_OPTIONS } from "@shared/airtableFields";
import { fmtDateTime } from "@/lib/format";

interface Job {
  id: string;
  company: string | null;
  jobAddress: string | null;
  endDate: string | null;
  subStatus: string | null;
}

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function JobModifyDialog({
  job,
  open,
  onOpenChange,
}: {
  job: Job | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [endDate, setEndDate] = useState("");
  const [subStatus, setSubStatus] = useState<string>("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const historyQuery = trpc.coordinator.changeHistory.useQuery(
    { jobId: job?.id ?? "" },
    { enabled: open && !!job },
  );

  useEffect(() => {
    if (job) {
      setEndDate(toDateInput(job.endDate));
      setSubStatus(job.subStatus ?? "");
      setReason("");
      setNote("");
    }
  }, [job?.id, open]);

  const modify = trpc.coordinator.modifyJob.useMutation({
    onSuccess: () => {
      toast.success("Job updated");
      utils.coordinator.dispatchJobs.invalidate();
      utils.coordinator.boardJobs.invalidate();
      utils.coordinator.jobDetail.invalidate();
      utils.coordinator.changeHistory.invalidate();
      historyQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const addNote = trpc.coordinator.addInternalNote.useMutation({
    onSuccess: () => {
      toast.success("Internal note added");
      setNote("");
      utils.coordinator.changeHistory.invalidate();
      historyQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!job) return null;

  const saveChanges = () => {
    const payload: {
      jobId: string;
      endDate?: string;
      subStatus?: string;
      reason?: string;
    } = { jobId: job.id, reason: reason || undefined };
    const origEnd = toDateInput(job.endDate);
    if (endDate && endDate !== origEnd) {
      payload.endDate = new Date(endDate + "T00:00:00").toISOString();
    }
    if (subStatus && subStatus !== (job.subStatus ?? "")) {
      payload.subStatus = subStatus;
    }
    if (!payload.endDate && !payload.subStatus) {
      toast.info("No changes to save");
      return;
    }
    modify.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modify Job</DialogTitle>
          <DialogDescription>
            {job.company ?? "Job"} — {job.jobAddress ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>End date (extend / shorten)</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Field operations sub-status</Label>
            <Select value={subStatus} onValueChange={setSubStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select sub-status" />
              </SelectTrigger>
              <SelectContent>
                {SUB_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Reason (logged in history)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Client requested 2 extra days"
            />
          </div>

          <Button
            onClick={saveChanges}
            disabled={modify.isPending}
            className="w-full"
          >
            {modify.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
            Save changes
          </Button>

          <div className="border-t pt-4 grid gap-2">
            <Label>Add internal note (coordinator only)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal note, not visible to technicians"
              rows={2}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!note.trim() || addNote.isPending}
              onClick={() => addNote.mutate({ jobId: job.id, note })}
            >
              Add note
            </Button>
          </div>

          {/* Change history */}
          <div className="border-t pt-4">
            <div className="font-semibold text-sm mb-2">Change history</div>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {historyQuery.data?.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  No changes recorded yet.
                </div>
              )}
              {historyQuery.data?.map((h) => (
                <div
                  key={h.id}
                  className="text-xs border rounded-md p-2 bg-muted/40"
                >
                  <div className="flex justify-between">
                    <span className="font-medium">{h.action}</span>
                    <span className="text-muted-foreground">
                      {fmtDateTime(h.createdAt as unknown as string)}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    by {h.actorName ?? "—"}
                  </div>
                  {h.oldValue && (
                    <div className="mt-1">
                      <span className="text-destructive/80 line-through">
                        {h.oldValue}
                      </span>{" "}
                      → <span className="text-foreground">{h.newValue}</span>
                    </div>
                  )}
                  {!h.oldValue && h.newValue && (
                    <div className="mt-1">{h.newValue}</div>
                  )}
                  {h.details && (
                    <div className="mt-1 italic text-muted-foreground">
                      {h.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
