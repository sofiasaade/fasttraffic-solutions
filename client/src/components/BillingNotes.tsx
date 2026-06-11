import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Receipt,
  Loader2,
  Trash2,
  Plus,
  Stamp,
  CalendarClock,
  Signpost,
  DollarSign,
} from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * "Novedades" (billing notes) trigger button + dialog for a single job.
 * Coordinators capture invoicing-relevant data here: a free note plus optional
 * structured fields (extra signage, weekend/holiday surcharge, plan stamped,
 * charge amount/category) so the info lines up with the invoicing process.
 * Airtable stays read-only.
 */
export function BillingNotesButton({
  jobId,
  jobLabel,
  count,
  className,
}: {
  jobId: string;
  jobLabel?: string;
  count?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasNotes = (count ?? 0) > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "gap-1.5 bg-background",
          hasNotes && "border-amber-400 text-amber-700 hover:text-amber-800",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Receipt className="size-4" />
        Novedades
        {hasNotes && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-amber-500 text-white text-xs font-bold">
            {count}
          </span>
        )}
      </Button>
      <BillingNotesDialog
        jobId={jobId}
        jobLabel={jobLabel}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

const PLAN_STAMPED_LABEL: Record<string, string> = {
  yes: "Plan stamped",
  no: "Plan NOT stamped",
  unknown: "Plan stamp unknown",
};

function fmtMoney(cents: number | null | undefined): string | null {
  if (cents == null || cents <= 0) return null;
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
  });
}

function BillingNotesDialog({
  jobId,
  jobLabel,
  open,
  onOpenChange,
}: {
  jobId: string;
  jobLabel?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  // Form state
  const [draft, setDraft] = useState("");
  const [extraSignage, setExtraSignage] = useState("");
  const [weekendSurcharge, setWeekendSurcharge] = useState(false);
  const [holidaySurcharge, setHolidaySurcharge] = useState(false);
  const [planStamped, setPlanStamped] = useState<"yes" | "no" | "unknown">(
    "unknown",
  );
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeCategory, setChargeCategory] = useState("");

  const resetForm = () => {
    setDraft("");
    setExtraSignage("");
    setWeekendSurcharge(false);
    setHolidaySurcharge(false);
    setPlanStamped("unknown");
    setChargeAmount("");
    setChargeCategory("");
  };

  const notesQuery = trpc.coordinator.listBillingNotes.useQuery(
    { jobId },
    { enabled: open },
  );

  const refresh = () => {
    utils.coordinator.listBillingNotes.invalidate({ jobId });
    utils.coordinator.billingNoteCounts.invalidate();
  };

  const addNote = trpc.coordinator.addBillingNote.useMutation({
    onSuccess: () => {
      resetForm();
      refresh();
    },
    onError: (e) => toast.error(e.message || "Could not save note"),
  });

  const deleteNote = trpc.coordinator.deleteBillingNote.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast.error(e.message || "Could not delete note"),
  });

  const notes = notesQuery.data ?? [];

  const submit = () => {
    const text = draft.trim();
    if (!text) {
      toast.error("Add a short note describing the novedad");
      return;
    }
    const dollars = parseFloat(chargeAmount.replace(/[^0-9.]/g, ""));
    const chargeAmountCents =
      !isNaN(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined;
    addNote.mutate({
      jobId,
      note: text,
      extraSignage: extraSignage.trim() || undefined,
      weekendSurcharge: weekendSurcharge || undefined,
      holidaySurcharge: holidaySurcharge || undefined,
      planStamped: planStamped !== "unknown" ? planStamped : undefined,
      chargeAmountCents,
      chargeCategory: chargeCategory.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-amber-600" />
            Novedades — billing notes
          </DialogTitle>
          <DialogDescription>
            {jobLabel ? (
              <>
                Invoicing notes for{" "}
                <span className="font-medium">{jobLabel}</span>.
              </>
            ) : (
              "Internal notes for invoicing this job."
            )}{" "}
            Visible to coordinators only.
          </DialogDescription>
        </DialogHeader>

        {/* Composer */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="bn-note" className="text-xs font-medium">
              Note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="bn-note"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Client extended closure 2 extra days; coordinate with crew…"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bn-signage" className="text-xs font-medium">
              Extra signage / devices
            </Label>
            <Input
              id="bn-signage"
              value={extraSignage}
              onChange={(e) => setExtraSignage(e.target.value)}
              placeholder="e.g. 6 extra cones, 2 arrow boards"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Plan stamped</Label>
              <Select
                value={planStamped}
                onValueChange={(v) =>
                  setPlanStamped(v as "yes" | "no" | "unknown")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bn-amount" className="text-xs font-medium">
                Charge amount (CAD)
              </Label>
              <Input
                id="bn-amount"
                inputMode="decimal"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bn-category" className="text-xs font-medium">
              Charge category
            </Label>
            <Input
              id="bn-category"
              value={chargeCategory}
              onChange={(e) => setChargeCategory(e.target.value)}
              placeholder="e.g. Extra signage, Standby time, Mobilization"
            />
          </div>

          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={weekendSurcharge}
                onCheckedChange={setWeekendSurcharge}
              />
              Weekend surcharge
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={holidaySurcharge}
                onCheckedChange={setHolidaySurcharge}
              />
              Holiday surcharge
            </label>
          </div>

          <div className="flex items-center justify-end">
            <Button
              size="sm"
              onClick={submit}
              disabled={!draft.trim() || addNote.isPending}
              className="gap-1.5"
            >
              {addNote.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add novedad
            </Button>
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-2">
          {notesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="size-4 animate-spin" /> Loading notes…
            </div>
          ) : notes.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-6">
              No billing notes yet. Add the first one above.
            </div>
          ) : (
            notes.map((n) => {
              const mine =
                n.authorUserId != null && n.authorUserId === user?.id;
              const money = fmtMoney(n.chargeAmountCents);
              const hasChips =
                n.weekendSurcharge ||
                n.holidaySurcharge ||
                (n.planStamped && n.planStamped !== "unknown") ||
                !!n.extraSignage ||
                !!money ||
                !!n.chargeCategory;
              return (
                <div
                  key={n.id}
                  className="rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <div className="whitespace-pre-wrap break-words">
                    {n.note}
                  </div>

                  {hasChips && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {n.extraSignage && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs">
                          <Signpost className="size-3" />
                          {n.extraSignage}
                        </span>
                      )}
                      {n.planStamped && n.planStamped !== "unknown" && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                            n.planStamped === "yes"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-rose-50 text-rose-700 border-rose-200",
                          )}
                        >
                          <Stamp className="size-3" />
                          {PLAN_STAMPED_LABEL[n.planStamped]}
                        </span>
                      )}
                      {n.weekendSurcharge && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-xs">
                          <CalendarClock className="size-3" />
                          Weekend surcharge
                        </span>
                      )}
                      {n.holidaySurcharge && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-xs">
                          <CalendarClock className="size-3" />
                          Holiday surcharge
                        </span>
                      )}
                      {(money || n.chargeCategory) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 text-xs">
                          <DollarSign className="size-3" />
                          {money}
                          {money && n.chargeCategory ? " · " : ""}
                          {n.chargeCategory}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {n.authorName} · {fmtDateTime(n.createdAt)}
                    </span>
                    {mine && (
                      <button
                        className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-50"
                        onClick={() => deleteNote.mutate({ id: n.id })}
                        disabled={deleteNote.isPending}
                      >
                        <Trash2 className="size-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
