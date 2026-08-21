import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, ChevronRight, Send, Users } from "lucide-react";

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

  // Composer: whole crew or one technician; general or tied to a project.
  const techsQ = trpc.coordinator.technicians.useQuery();
  const jobsQ = trpc.coordinator.mapJobs.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const [toTech, setToTech] = useState<string>(""); // "" = all crew
  const [aboutJob, setAboutJob] = useState<string>(""); // "" = general
  const [aboutLabel, setAboutLabel] = useState<string>("");
  const [jobSearch, setJobSearch] = useState("");
  const [jobOpen, setJobOpen] = useState(false);
  const [text, setText] = useState("");
  const sendMessage = trpc.coordinator.sendMessage.useMutation({
    onSuccess: (r) => {
      setText("");
      utils.coordinator.messagesInbox.invalidate();
      toast.success(`Sent — ${r.notified} technician(s) notified`);
    },
    onError: (e) => toast.error(e.message || "Could not send"),
  });
  // Type-ahead over client name, address, or municipality — same source and
  // matching as the global project search in the top bar.
  const jobHits = useMemo(() => {
    const q = jobSearch.trim().toLowerCase();
    if (!q) return [];
    const jobs = (jobsQ.data ?? []) as any[];
    return jobs
      .filter(
        (j) =>
          (j.company ?? "").toLowerCase().includes(q) ||
          (j.jobAddress ?? "").toLowerCase().includes(q) ||
          (j.municipality ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((j) => ({
        id: j.id,
        label: `${j.company ?? "Job"} — ${j.jobAddress ?? j.municipality ?? ""}`,
      }));
  }, [jobsQ.data, jobSearch]);

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

      {/* Composer — whole crew or one worker; general or per project */}
      <div className="rounded-xl border bg-card p-3.5 space-y-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4 text-primary" /> New message
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">
              To
            </label>
            <select
              value={toTech}
              onChange={(e) => setToTech(e.target.value)}
              className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">👷 All crew ({(techsQ.data ?? []).filter((t: any) => t.active !== false).length})</option>
              {(techsQ.data ?? [])
                .filter((t: any) => t.active !== false)
                .map((t: any) => (
                  <option key={t.airtableName} value={t.airtableName}>
                    {t.displayName}
                  </option>
                ))}
            </select>
          </div>
          <div className="relative">
            <label className="text-[11px] font-medium text-muted-foreground">
              About
            </label>
            {aboutJob ? (
              <div className="flex items-center gap-1.5 h-9 rounded-md border border-primary/40 bg-primary/5 px-2 text-sm">
                <span className="truncate flex-1" title={aboutLabel}>
                  📌 {aboutLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAboutJob("");
                    setAboutLabel("");
                    setJobSearch("");
                  }}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Back to general (no project)"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <input
                  value={jobSearch}
                  onChange={(e) => {
                    setJobSearch(e.target.value);
                    setJobOpen(true);
                  }}
                  onFocus={() => setJobOpen(true)}
                  onBlur={() => setTimeout(() => setJobOpen(false), 150)}
                  placeholder="📢 General — type client or address to pick a project"
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                />
                {jobOpen && jobHits.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
                    {jobHits.map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setAboutJob(j.id);
                          setAboutLabel(j.label);
                          setJobOpen(false);
                        }}
                        className="block w-full text-left px-2.5 py-2 text-sm hover:bg-accent truncate"
                        title={j.label}
                      >
                        {j.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            toTech
              ? `Message to ${toTech}…`
              : "Message to the whole crew…"
          }
          rows={2}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Users className="size-3" />
            {toTech ? "Only this worker gets it" : "Every active worker gets it"}
            {aboutJob ? " · also saved in the project's chat" : ""}
          </span>
          <Button
            size="sm"
            disabled={!text.trim() || sendMessage.isPending}
            onClick={() =>
              sendMessage.mutate({
                note: text.trim(),
                technicianName: toTech || null,
                jobId: aboutJob || null,
              })
            }
          >
            {sendMessage.isPending ? (
              <Loader2 className="size-4 mr-1 animate-spin" />
            ) : (
              <Send className="size-4 mr-1" />
            )}
            Send
          </Button>
        </div>
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
