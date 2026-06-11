import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Receipt, Loader2, Trash2, Plus } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";

/**
 * "Novedades" (billing notes) trigger button + dialog for a single job.
 * Coordinators capture invoicing-relevant notes here (extra signage, plan
 * stamped, surcharges, scope changes). Airtable stays read-only.
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
  const [draft, setDraft] = useState("");

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
      setDraft("");
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
    if (!text) return;
    addNote.mutate({ jobId, note: text });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-amber-600" />
            Novedades — billing notes
          </DialogTitle>
          <DialogDescription>
            {jobLabel ? (
              <>Notes for invoicing on <span className="font-medium">{jobLabel}</span>.</>
            ) : (
              "Internal notes for invoicing this job."
            )}{" "}
            Visible to coordinators only.
          </DialogDescription>
        </DialogHeader>

        {/* Composer */}
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Added 6 extra signs on day 2; plan stamped; Sunday surcharge applies…"
            rows={3}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Tip: ⌘/Ctrl + Enter to save
            </span>
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
              Add note
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
              const mine = n.authorUserId != null && n.authorUserId === user?.id;
              return (
                <div
                  key={n.id}
                  className="rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <div className="whitespace-pre-wrap break-words">{n.note}</div>
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
