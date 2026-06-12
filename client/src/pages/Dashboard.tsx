import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/contexts/SessionContext";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import WeatherCard from "@/components/WeatherCard";
import ActiveWorks from "@/components/ActiveWorks";
import DashboardDay from "@/components/DashboardDay";
import {
  Cone,
  ClipboardCheck,
  BellRing,
  Activity,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

type MapJob = { status: string | null };

function isActive(status: string | null): boolean {
  const s = (status ?? "").toLowerCase();
  return !(s.includes("cancel") || s.includes("declin"));
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "rounded-2xl border border-border bg-card p-5 flex items-center gap-4",
        onClick && "cursor-pointer hover:border-rose-300 hover:shadow-sm transition-all",
      )}
    >
      <div
        className="flex items-center justify-center size-11 rounded-xl shrink-0"
        style={{ background: `${accent}1a`, color: accent }}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-extrabold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useSession();
  const [, navigate] = useLocation();
  const { data: jobs } = trpc.coordinator.mapJobs.useQuery();
  const badges = trpc.coordinator.changeBadges.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const pending = trpc.coordinator.pendingJobs.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const pendingCount = pending.data?.count ?? 0;

  const utils = trpc.useUtils();
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      // Re-pull everything that is backed by the live Airtable source.
      await Promise.all([
        utils.coordinator.mapJobs.invalidate(),
        utils.coordinator.pendingJobs.invalidate(),
        utils.coordinator.changeBadges.invalidate(),
      ]);
      toast.success("Refreshed from Airtable");
    } catch {
      toast.error("Could not refresh. Check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  const stats = useMemo(() => {
    const list = (jobs as MapJob[] | undefined) ?? [];
    const active = list.filter((j) => isActive(j.status));
    const field = active.filter((j) => (j.status ?? "").toLowerCase() === "field").length;
    return { total: list.length, active: active.length, field };
  }, [jobs]);

  const alertCount = badges.data
    ? Object.values(badges.data).reduce((n, arr) => n + (arr?.length ?? 0), 0)
    : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operations overview for today.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={refreshing}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Top row: weather + key stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1">
          <WeatherCard />
        </div>
        <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat
            icon={Cone}
            label="Active works"
            value={stats.active}
            accent="#ea580c"
          />
          <Stat
            icon={Activity}
            label="In the field"
            value={stats.field}
            accent="#16a34a"
          />
          <Stat
            icon={AlertTriangle}
            label="Pending jobs (no technician)"
            value={pendingCount}
            accent="#e11d48"
            onClick={() => navigate("/pending")}
          />
          <Stat
            icon={BellRing}
            label="Unseen change alerts"
            value={alertCount}
            accent="#dc2626"
          />
          <Stat
            icon={ClipboardCheck}
            label="Jobs in window"
            value={stats.total}
            accent="#2563eb"
          />
        </div>
      </div>

      {/* Day view: jobs starting / ongoing / pickup for a selectable date */}
      <DashboardDay />

      {/* Active works: map / list toggle */}
      <ActiveWorks />
    </div>
  );
}
