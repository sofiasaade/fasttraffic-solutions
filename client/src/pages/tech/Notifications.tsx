import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, Bell, CheckCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";

const TYPE_LABEL: Record<string, string> = {
  assigned: "New assignment",
  modified: "Job updated",
  cancelled: "Assignment removed",
};

export default function Notifications() {
  const utils = trpc.useUtils();
  const query = trpc.technician.notifications.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const markRead = trpc.technician.markNotificationRead.useMutation({
    onSuccess: () => utils.technician.notifications.invalidate(),
  });
  const markAll = trpc.technician.markAllRead.useMutation({
    onSuccess: () => utils.technician.notifications.invalidate(),
  });

  const items = query.data?.items ?? [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold tracking-tight">Alerts</h1>
        {(query.data?.unread ?? 0) > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            <CheckCheck className="size-4 mr-1" /> Mark all read
          </Button>
        )}
      </div>

      {query.isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {query.data && items.length === 0 && (
        <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-8 text-center">
          <Bell className="size-6 mx-auto mb-2 opacity-50" />
          No notifications yet.
        </div>
      )}

      <div className="space-y-2">
        {items.map((n) => {
          const inner = (
            <div
              className={cn(
                "flex items-start gap-3 p-3.5 rounded-xl border",
                n.readAt ? "bg-card" : "bg-primary/5 border-primary/30",
              )}
            >
              {!n.readAt && (
                <span className="size-2 rounded-full bg-primary mt-2 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-primary">
                    {TYPE_LABEL[n.type] ?? n.type}
                  </span>
                </div>
                <div className="font-medium text-sm">{n.title}</div>
                {n.body && (
                  <div className="text-sm text-muted-foreground truncate">
                    {n.body}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  {fmtDateTime(n.createdAt as any)}
                </div>
              </div>
              {n.airtableJobId && (
                <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" />
              )}
            </div>
          );

          const handleClick = () => {
            if (!n.readAt) markRead.mutate({ id: n.id });
          };

          return n.airtableJobId ? (
            <Link
              key={n.id}
              href={`/app/job/${n.airtableJobId}`}
              onClick={handleClick}
            >
              {inner}
            </Link>
          ) : (
            <button key={n.id} onClick={handleClick} className="w-full text-left">
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}
