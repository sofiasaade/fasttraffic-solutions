import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, MessageSquare, CheckCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/format";

/**
 * Chat messages from the coordinator — their own screen, separate from the
 * assignment alarms, so a message never gets lost between alerts. Tapping one
 * opens that job's chat to reply.
 */
export default function TechMessages() {
  const utils = trpc.useUtils();
  const query = trpc.technician.notifications.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const markRead = trpc.technician.markNotificationRead.useMutation({
    onSuccess: () => utils.technician.notifications.invalidate(),
  });

  const items = (query.data?.items ?? []).filter((n: any) => n.isChat);
  const unread = query.data?.chatUnread ?? 0;

  const markAllChat = () => {
    for (const n of items) {
      if (!n.readAt) markRead.mutate({ id: n.id });
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-extrabold tracking-tight">Messages</h1>
        {unread > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={markAllChat}
            disabled={markRead.isPending}
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
          <MessageSquare className="size-6 mx-auto mb-2 opacity-50" />
          No messages from the coordinator yet.
        </div>
      )}

      <div className="space-y-2">
        {items.map((n: any) => (
          <Link
            key={n.id}
            href={n.airtableJobId ? `/app/job/${n.airtableJobId}` : "/app"}
            onClick={() => {
              if (!n.readAt) markRead.mutate({ id: n.id });
            }}
          >
            <div
              className={cn(
                "flex items-start gap-3 p-3.5 rounded-xl border",
                n.readAt ? "bg-card" : "bg-amber-50 border-amber-300",
              )}
            >
              {!n.readAt && (
                <span className="size-2 rounded-full bg-amber-500 mt-2 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-700">
                  📣 Coordinator
                </div>
                {n.body && (
                  <div className="text-sm whitespace-pre-wrap">{n.body}</div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  {fmtDateTime(n.createdAt as any)} · tap to open the job's chat
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
