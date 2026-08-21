import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Loader2, MessageSquare, ChevronRight } from "lucide-react";

const CAT_EMOJI: Record<string, string> = {
  stolen: "🚨",
  lost: "❓",
  damaged: "🔧",
};

function fmt(ts: string | number | Date) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Coordinator message inbox — every technician field note across all jobs,
 * grouped by project, newest first. Opening this page marks them as seen.
 */
export default function Messages() {
  const utils = trpc.useUtils();
  const q = trpc.coordinator.messagesInbox.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const markSeen = trpc.coordinator.markMessagesSeen.useMutation({
    onSuccess: () => utils.coordinator.messagesBadge.invalidate(),
  });

  // Mark as seen once the inbox has loaded — the sidebar badge clears.
  useEffect(() => {
    if (q.data) markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data != null]);

  const groups = useMemo(() => {
    const m = new Map<
      string,
      {
        jobId: string;
        company: string | null;
        jobAddress: string | null;
        items: NonNullable<typeof q.data>["items"];
      }
    >();
    for (const it of q.data?.items ?? []) {
      const g = m.get(it.jobId) ?? {
        jobId: it.jobId,
        company: it.company,
        jobAddress: it.jobAddress,
        items: [] as NonNullable<typeof q.data>["items"],
      };
      g.items.push(it);
      m.set(it.jobId, g);
    }
    // Newest message first across groups.
    return Array.from(m.values()).sort(
      (a, b) =>
        new Date(b.items[0].createdAt).getTime() -
        new Date(a.items[0].createdAt).getTime(),
    );
  }, [q.data]);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <MessageSquare className="size-5 text-primary" /> Messages
        </h1>
        <p className="text-sm text-muted-foreground">
          Field notes and messages from technicians, grouped by project. Click
          one to open the project's chat and reply.
        </p>
      </div>

      {q.isLoading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          No messages from technicians yet.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const latest = g.items[0];
            const unread = g.items.filter((i) => i.unread).length;
            return (
              <Link
                key={g.jobId}
                href={`/projects/${g.jobId}`}
                className={cn(
                  "block rounded-xl border bg-card p-3.5 hover:border-primary/50 hover:shadow-sm transition-all",
                  unread > 0 && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">
                        {g.company ?? g.jobId}
                      </span>
                      {unread > 0 && (
                        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
                          {unread} new
                        </span>
                      )}
                    </div>
                    {g.jobAddress && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {g.jobAddress}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {fmt(latest.createdAt)}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                </div>
                <div className="mt-2 space-y-1">
                  {g.items.slice(0, 3).map((it) => (
                    <div key={it.id} className="text-sm flex gap-1.5 min-w-0">
                      <span className="font-medium shrink-0">
                        🦺 {it.authorName}:
                      </span>
                      <span className="truncate text-muted-foreground">
                        {CAT_EMOJI[it.category] ? `${CAT_EMOJI[it.category]} ` : ""}
                        {it.note}
                      </span>
                    </div>
                  ))}
                  {g.items.length > 3 && (
                    <div className="text-[11px] text-muted-foreground">
                      +{g.items.length - 3} more…
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
