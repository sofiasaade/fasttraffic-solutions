import { trpc } from "@/lib/trpc";
import { Loader2, History } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const ACTION_LABEL: Record<string, string> = {
  assign_technician: "Technician assignment",
  extend_end_date: "End date changed",
  change_sub_status: "Sub-status changed",
  internal_note: "Internal note",
  field_note: "Field note",
  field_photo: "Field photo",
};

export default function ChangeHistoryPage() {
  const query = trpc.coordinator.changeHistory.useQuery({});

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <History className="size-6 text-primary" />
        <h1 className="text-2xl font-extrabold tracking-tight">
          Change History
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Immutable, append-only audit log of all job changes
      </p>

      {query.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="relative border-l-2 border-border ml-3 space-y-4">
        {query.data?.length === 0 && (
          <div className="text-sm text-muted-foreground pl-6">
            No changes recorded yet.
          </div>
        )}
        {query.data?.map((h) => (
          <div key={h.id} className="relative pl-6">
            <div className="absolute -left-[7px] top-1.5 size-3 rounded-full bg-primary border-2 border-background" />
            <div className="bg-card border rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Badge variant="outline">
                  {ACTION_LABEL[h.action] ?? h.action}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {fmtDateTime(h.createdAt as unknown as string)}
                </span>
              </div>
              <div className="text-sm mt-2">
                <span className="text-muted-foreground">by </span>
                <span className="font-medium">{h.actorName ?? "—"}</span>
              </div>
              {h.fieldName && (
                <div className="text-xs text-muted-foreground mt-1">
                  Field: {h.fieldName}
                </div>
              )}
              {h.oldValue && (
                <div className="text-sm mt-1 break-words">
                  <span className="text-destructive/80 line-through">
                    {h.oldValue}
                  </span>{" "}
                  → <span>{h.newValue}</span>
                </div>
              )}
              {!h.oldValue && h.newValue && (
                <div className="text-sm mt-1 break-words">{h.newValue}</div>
              )}
              {h.details && (
                <div className="text-xs italic text-muted-foreground mt-1">
                  {h.details}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
