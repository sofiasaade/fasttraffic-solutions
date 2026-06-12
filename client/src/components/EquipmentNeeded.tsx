import { trpc } from "@/lib/trpc";
import { Signpost, MoveUpRight, MonitorSmartphone, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type SignTally = {
  customSigns: number;
  arrowBoards: number;
  messageBoards: number;
};

function Item({
  icon: Icon,
  label,
  value,
  accent,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div
        className="flex items-center justify-center size-9 rounded-lg shrink-0"
        style={{ background: `${accent}1a`, color: accent }}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-extrabold leading-none">
          {loading ? "…" : value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

/**
 * Equipment needed for the jobs STARTING on the selected day, aggregated from
 * the Airtable "Signs Count" field (Custom Signs / Arrow Boards / Message
 * Boards). Cancelled jobs are excluded server-side.
 */
export default function EquipmentNeeded({ date }: { date: string }) {
  const { data, isLoading } = trpc.coordinator.dashboardDay.useQuery({ date });
  const tally: SignTally =
    (data?.signTally as SignTally | undefined) ?? {
      customSigns: 0,
      arrowBoards: 0,
      messageBoards: 0,
    };
  const missing = (data?.missingPermit as number | undefined) ?? 0;

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm">Equipment needed</h3>
        <span className="text-[11px] text-muted-foreground">Starting today</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Item
          icon={Signpost}
          label="Custom signs"
          value={tally.customSigns}
          accent="#ea580c"
          loading={isLoading}
        />
        <Item
          icon={MoveUpRight}
          label="Arrow boards"
          value={tally.arrowBoards}
          accent="#2563eb"
          loading={isLoading}
        />
        <Item
          icon={MonitorSmartphone}
          label="Message boards"
          value={tally.messageBoards}
          accent="#7c3aed"
          loading={isLoading}
        />
      </div>
      {!isLoading && missing > 0 && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800",
          )}
        >
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          <span>
            {missing} starting job{missing > 1 ? "s" : ""} without a readable
            permit — verify the schedule manually.
          </span>
        </div>
      )}
    </div>
  );
}
