import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { subStatusColor } from "@shared/subStatusColors";
import { pickPlans, pickPermits, pickOtherDocs } from "@shared/planDocs";
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
  // EVERY non-empty Airtable field, for the "All Airtable info" card.
  const allFieldsQ = trpc.coordinator.jobAllFields.useQuery(
    { jobId },
    { enabled: !!jobId, staleTime: 5 * 60 * 1000 },
  );

  // Side-by-side document viewer (plan/permit PDF next to the info).
  const [viewerOpen, setViewerOpen] = useState(true);
  const [viewerIdx, setViewerIdx] = useState(0);

  const [note, setNote] = useState("");
  // "Internal only" keeps the note in the change history — crew never sees it.
  const [internalOnly, setInternalOnly] = useState(false);
  const utils = trpc.useUtils();
  const threadQ = trpc.coordinator.jobThread.useQuery(
    { jobId },
    { enabled: !!jobId, refetchInterval: 30000 },
  );
  const addNote = trpc.coordinator.addInternalNote.useMutation({
    onSuccess: () => {
      setNote("");
      invalidateJobData();
      toast.success("Internal note added (history only)");
    },
    onError: (e) => toast.error(e.message || "Could not add note"),
  });
  const sendNote = trpc.coordinator.sendJobNote.useMutation({
    onSuccess: (r) => {
      setNote("");
      utils.coordinator.jobThread.invalidate({ jobId });
      invalidateJobData();
      toast.success(
        r.notified > 0
          ? `Sent — ${r.notified} technician(s) notified`
          : "Sent — no technicians assigned yet",
      );
    },
    onError: (e) => toast.error(e.message || "Could not send"),
  });
  const submitNote = () => {
    const text = note.trim();
    if (!text) return;
    if (internalOnly) addNote.mutate({ jobId, note: text });
    else sendNote.mutate({ jobId, note: text });
  };

  const job = data?.job;
  const history = data?.history ?? [];
  const photos = data?.photos ?? [];

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

  // Docs the side viewer can open: plans first, then permits, then the rest.
  const allFiles = (job.planFile ?? []) as any[];
  const viewerDocs = [
    ...pickPlans(allFiles),
    ...pickPermits(allFiles),
    ...pickOtherDocs(allFiles),
  ].filter((f: any) => /\.pdf$/i.test(f.filename ?? ""));
  const viewerDoc = viewerDocs[Math.min(viewerIdx, viewerDocs.length - 1)];

  return (
    <div className="flex items-start gap-5 p-4 md:p-6">
    <div className="mx-auto max-w-5xl min-w-0 flex-1 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="sm" onClick={goBack} className="shrink-0">
          <ArrowLeft className="mr-1 size-4" /> Back
        </Button>
        {viewerDocs.length > 0 && (
          <Button
            variant={viewerOpen ? "default" : "outline"}
            size="sm"
            className="shrink-0 hidden xl:inline-flex"
            onClick={() => setViewerOpen((v) => !v)}
            title="Show the plan next to the project info"
          >
            <FileText className="mr-1 size-4" />
            {viewerOpen ? "Hide plan" : "View plan"}
          </Button>
        )}
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

          {/* Documents: Traffic Management Plan + Street Use Permit (SU-…),
              split out from the Airtable "Plan File" attachments. */}
          {(() => {
            const files = (job.planFile ?? []) as any[];
            if (files.length === 0) return null;
            const plans = pickPlans(files);
            const permits = pickPermits(files);
            const others = pickOtherDocs(files);

            const FileLink = ({ f, i, label }: any) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 hover:border-primary/50 hover:shadow-sm transition-all"
              >
                {f.thumbnails?.large?.url ? (
                  <img
                    src={f.thumbnails.large.url}
                    alt=""
                    className="size-12 rounded object-cover border border-border shrink-0"
                  />
                ) : (
                  <div className="flex items-center justify-center size-12 rounded bg-primary/10 text-primary shrink-0">
                    <FileText className="size-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium group-hover:text-primary">
                    {f.filename ?? label}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Open in new tab
                  </div>
                </div>
              </a>
            );

            return (
              <Card>
                <CardContent className="pt-4 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <FileText className="size-4 text-primary" /> Traffic
                      Management Plan{plans.length !== 1 ? "s" : ""} ({plans.length})
                    </div>
                    {plans.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {plans.map((f, i) => (
                          <FileLink key={i} f={f} i={i} label={`Plan ${i + 1}`} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No plan attached yet.
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                      <FileText className="size-4 text-emerald-600" /> City
                      Permit{permits.length !== 1 ? "s" : ""} (SU / NP) (
                      {permits.length})
                    </div>
                    {permits.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {permits.map((f, i) => (
                          <FileLink key={i} f={f} i={i} label={`Permit ${i + 1}`} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No SU- permit attached yet.
                      </div>
                    )}
                  </div>

                  {others.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-muted-foreground">
                        <FileText className="size-4" /> Other documents (
                        {others.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {others.map((f, i) => (
                          <FileLink key={i} f={f} i={i} label={`Document ${i + 1}`} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

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
          {/* Notes thread — chat with the crew; everything stays on record. */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <StickyNote className="size-4" /> Notes / Chat with crew
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(threadQ.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No messages yet — what you send here reaches the assigned
                  technicians' app.
                </p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto border rounded-lg p-2 bg-muted/20">
                  {threadQ.data!.map((m: any) => {
                    const coord = m.authorRole === "coordinator";
                    const cat =
                      m.category === "stolen"
                        ? "🚨 "
                        : m.category === "lost"
                          ? "❓ "
                          : m.category === "damaged"
                            ? "🔧 "
                            : "";
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex",
                          coord ? "justify-end" : "justify-start",
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-xl px-3 py-1.5 text-sm",
                            coord
                              ? "bg-primary text-primary-foreground rounded-br-sm"
                              : "bg-background border rounded-bl-sm",
                          )}
                        >
                          <div className="text-[10px] font-semibold opacity-75">
                            {coord ? m.authorName : `🦺 ${m.authorName}`} ·{" "}
                            {prettyDateTime(m.createdAt)}
                          </div>
                          <div className="whitespace-pre-wrap">
                            {cat}
                            {m.note}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    internalOnly
                      ? "Internal note (history only)…"
                      : "Message to the crew…"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNote();
                  }}
                />
                <Button
                  size="sm"
                  disabled={
                    !note.trim() || addNote.isPending || sendNote.isPending
                  }
                  onClick={submitNote}
                >
                  {addNote.isPending || sendNote.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                </Button>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={internalOnly}
                  onChange={(e) => setInternalOnly(e.target.checked)}
                  className="size-3.5"
                />
                Internal only — goes to the change history, the crew does NOT
                see it
              </label>
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

      {/* EVERY non-empty Airtable field on this record (read-only). */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Airtable info</CardTitle>
        </CardHeader>
        <CardContent>
          {allFieldsQ.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading Airtable fields…
            </div>
          ) : (allFieldsQ.data?.length ?? 0) === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">No data.</div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border/70">
                  {(allFieldsQ.data ?? []).map((f) => (
                    <tr key={f.name} className="align-top">
                      <td className="w-[220px] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {f.name}
                      </td>
                      <td className="px-3 py-1.5 whitespace-pre-wrap break-words">
                        {f.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    {/* Side-by-side document viewer: plan/permit PDF next to the info. */}
    {viewerOpen && viewerDoc && (
      <div
        className="hidden xl:flex w-[44vw] max-w-[880px] shrink-0 sticky top-4 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        style={{ height: "calc(100vh - 5rem)" }}
      >
        <div className="flex items-center gap-1 border-b border-border p-2 overflow-x-auto">
          {viewerDocs.map((f: any, i: number) => (
            <button
              key={i}
              type="button"
              onClick={() => setViewerIdx(i)}
              className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors max-w-[220px] truncate ${
                i === Math.min(viewerIdx, viewerDocs.length - 1)
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
              title={f.filename}
            >
              {f.filename}
            </button>
          ))}
          <a
            href={viewerDoc.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 rounded px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"
          >
            Open ↗
          </a>
        </div>
        <iframe
          src={viewerDoc.url}
          title={viewerDoc.filename ?? "Document"}
          className="w-full flex-1 bg-white"
        />
      </div>
    )}
    </div>
  );
}
