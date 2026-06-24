import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { subStatusColor } from "@shared/subStatusColors";
import { useInvalidateJobData } from "@/hooks/useInvalidateJobData";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Building2,
  Calendar,
  Clock,
  Phone,
  User as UserIcon,
  FileText,
  History,
  StickyNote,
  Image as ImageIcon,
  Hammer,
  Plus,
} from "lucide-react";

/** Format an ISO date (yyyy-mm-dd or full ISO) into a friendly local label. */
function prettyDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function prettyDateTime(value?: string | number | Date | null): string {
  if (value === null || value === undefined) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const PHASES = [
  { key: "techPrep", label: "Preparation", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { key: "techSetup", label: "Setup", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  { key: "techPickup", label: "Pickup", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
] as const;

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-sm text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const [, params] = useRoute("/projects/:id");
  const [, navigate] = useLocation();
  const jobId = params?.id ?? "";
  const invalidateJobData = useInvalidateJobData();

  const { data, isLoading, isError } = trpc.coordinator.jobDetail.useQuery(
    { jobId },
    { enabled: !!jobId },
  );

  const [note, setNote] = useState("");
  const addNote = trpc.coordinator.addInternalNote.useMutation({
    onSuccess: () => {
      setNote("");
      invalidateJobData();
      toast.success("Note added");
    },
    onError: (e) => toast.error(e.message || "Could not add note"),
  });

  const job = data?.job;
  const history = data?.history ?? [];
  const photos = data?.photos ?? [];
  const notes = data?.notes ?? [];

  const subColor = useMemo(() => subStatusColor(job?.subStatus), [job?.subStatus]);

  if (!jobId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No project selected.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="space-y-4 p-8 text-center">
        <p className="text-muted-foreground">
          We couldn't load this project. It may have been removed or is not
          accessible.
        </p>
        <Button variant="outline" onClick={() => history.length ? null : window.history.back()}>
          <ArrowLeft className="mr-1 size-4" /> Go back
        </Button>
      </div>
    );
  }

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate("/dashboard");
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="sm" onClick={goBack} className="shrink-0">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl leading-none">{job.emoji || "📍"}</span>
            <h1 className="truncate text-xl font-bold text-foreground">
              {job.company || job.projectTitle || "Untitled project"}
            </h1>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {job.status && (
              <Badge variant="secondary" className="text-xs">
                {job.status}
              </Badge>
            )}
            {job.subStatus && (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: subColor.bg, color: subColor.text }}
              >
                {job.subStatus}
              </span>
            )}
            {job.zone && (
              <Badge variant="outline" className="text-xs">
                Zone {job.zone}
              </Badge>
            )}
            {job.impact && (
              <Badge variant="outline" className="text-xs">
                {job.impact}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: core details */}
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Project details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              <InfoRow icon={Building2} label="Company" value={job.company || "—"} />
              <InfoRow icon={MapPin} label="Address" value={job.jobAddress || "—"} />
              <InfoRow icon={MapPin} label="Municipality" value={job.municipality || "—"} />
              <InfoRow icon={MapPin} label="Zone" value={job.zone || "—"} />
              <InfoRow icon={Calendar} label="Start date" value={prettyDate(job.startDate)} />
              <InfoRow icon={Calendar} label="End date" value={prettyDate(job.endDate)} />
              <InfoRow icon={Clock} label="Setup duration" value={job.setupDuration || "—"} />
              <InfoRow icon={FileText} label="Closure type" value={job.closureType || "—"} />
              <InfoRow icon={UserIcon} label="Requestor" value={job.requestorName || "—"} />
              <InfoRow icon={Phone} label="Site contact" value={job.siteContactPhone || "—"} />
              <InfoRow icon={FileText} label="Signs count" value={job.signsCount || "—"} />
              <InfoRow icon={FileText} label="Request ID" value={job.requestId || "—"} />
            </CardContent>
            {(job.clientMessage || job.fieldComments) && (
              <CardContent className="space-y-3 pt-0">
                {job.clientMessage && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Client message
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {job.clientMessage}
                    </p>
                  </div>
                )}
                {job.fieldComments && (
                  <div className="rounded-md border bg-muted/40 p-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Field comments
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {job.fieldComments}
                    </p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          {/* Crew by phase */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Hammer className="size-4" /> Assigned crew
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {PHASES.map((p) => {
                const names = ((job as any)[p.key] as string[] | undefined) ?? [];
                return (
                  <div key={p.key} className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex w-20 shrink-0 justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${p.cls}`}
                    >
                      {p.label}
                    </span>
                    {names.length === 0 ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      names.map((n) => (
                        <Badge key={n} variant="outline" className="text-xs">
                          {n}
                        </Badge>
                      ))
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Photos */}
          {photos.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ImageIcon className="size-4" /> Field photos ({photos.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((ph: any) => (
                  <a
                    key={ph.id}
                    href={ph.storageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-md border"
                  >
                    <img
                      src={ph.storageUrl}
                      alt={ph.filename || "Field photo"}
                      className="h-32 w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                      {ph.category ? `${ph.category} · ` : ""}
                      {ph.technicianName || ph.filename || ""}
                    </div>
                  </a>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: notes + history */}
        <div className="space-y-5">
          {/* Notes */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <StickyNote className="size-4" /> Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add an internal note…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && note.trim()) {
                      addNote.mutate({ jobId, note: note.trim() });
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() => addNote.mutate({ jobId, note: note.trim() })}
                >
                  {addNote.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ul className="space-y-2">
                  {notes.map((n: any) => (
                    <li key={n.id} className="rounded-md border bg-muted/30 p-2">
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {n.note}
                      </p>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {n.authorName || "—"} · {prettyDateTime(n.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Change history */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" /> Change history
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((h: any) => (
                    <li key={h.id} className="border-l-2 border-muted pl-3">
                      <div className="text-sm font-medium text-foreground">
                        {(h.action || "change").replace(/_/g, " ")}
                        {h.fieldName ? ` · ${h.fieldName}` : ""}
                      </div>
                      {h.details && (
                        <div className="text-xs text-muted-foreground">{h.details}</div>
                      )}
                      <Separator className="my-1" />
                      <div className="text-[11px] text-muted-foreground">
                        {h.actorName || "—"} · {prettyDateTime(h.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
