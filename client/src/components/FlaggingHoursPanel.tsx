import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Flag,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

function fmtMoney(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "CAD",
  });
}

/**
 * Billable flagging hours for a job. Flagging is billed PER PERSON-HOUR, so
 * each flagger/day is logged as its own line. Shows a running total and an
 * optional dollar amount when an hourly rate is entered.
 */
export function FlaggingHoursPanel({
  jobId,
  technicians,
  defaultDate,
  defaultOpen = false,
}: {
  jobId: string;
  technicians: { airtableName: string; displayName: string }[];
  defaultDate?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.coordinator.listFlaggingHours.useQuery(
    { jobId },
    { enabled: open },
  );

  const [tech, setTech] = useState("");
  const [date, setDate] = useState(
    defaultDate ?? new Date().toISOString().slice(0, 10),
  );
  const [hours, setHours] = useState("");
  const [rate, setRate] = useState("");

  const save = trpc.coordinator.setFlaggingHours.useMutation({
    onSuccess: () => {
      utils.coordinator.listFlaggingHours.invalidate({ jobId });
      utils.coordinator.flaggingSummary.invalidate();
      setHours("");
      toast.success("Flagging hours saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.coordinator.removeFlaggingHours.useMutation({
    onSuccess: () => {
      utils.coordinator.listFlaggingHours.invalidate({ jobId });
      utils.coordinator.flaggingSummary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const totalAmount = useMemo(() => {
    if (!data) return 0;
    return data.rows.reduce(
      (s, r) => s + (r.hourlyRateCents ? r.hours * r.hourlyRateCents : 0),
      0,
    );
  }, [data]);

  function submit() {
    const h = Number(hours);
    if (!tech) return toast.error("Pick a flagger");
    if (!Number.isFinite(h) || h <= 0) return toast.error("Enter valid hours");
    const rateCents = rate.trim()
      ? Math.round(Number(rate) * 100)
      : null;
    if (rate.trim() && (!Number.isFinite(Number(rate)) || Number(rate) < 0))
      return toast.error("Enter a valid rate");
    save.mutate({
      jobId,
      technicianName: tech,
      workDate: date,
      hours: h,
      hourlyRateCents: rateCents,
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Flag className="size-4 text-orange-600" />
          Flagging hours
          {data && data.totalHours > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800">
              <Clock className="size-3" />
              {data.totalHours}h billable
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Billed per person-hour — one line per flagger per day.
          </p>

          {/* Add row */}
          <div className="grid grid-cols-2 gap-1.5">
            <Select value={tech} onValueChange={setTech}>
              <SelectTrigger className="h-8 text-xs col-span-2">
                <SelectValue placeholder="Flagger" />
              </SelectTrigger>
              <SelectContent>
                {technicians.map((t) => (
                  <SelectItem key={t.airtableName} value={t.airtableName}>
                    {t.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              min="0"
              step="0.5"
              placeholder="Hours"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="$/hr (optional)"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-8 text-xs col-span-2"
            />
          </div>
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={submit}
            disabled={save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add flagging hours
          </Button>

          {/* List */}
          {isLoading ? (
            <div className="py-3 flex justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : !data || data.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              No flagging hours logged yet.
            </p>
          ) : (
            <>
              <ul className="space-y-1">
                {data.rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {r.technicianName}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.workDate} · {r.hours}h
                        {r.hourlyRateCents
                          ? ` · ${fmtMoney(r.hours * r.hourlyRateCents)}`
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove.mutate({ id: r.id })}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-border pt-1.5 text-xs font-medium">
                <span>Total</span>
                <span className="flex items-center gap-2">
                  <span>{data.totalHours}h</span>
                  {totalAmount > 0 && (
                    <span className="text-orange-700">
                      {fmtMoney(totalAmount)}
                    </span>
                  )}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
