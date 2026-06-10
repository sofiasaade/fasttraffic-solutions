import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  MapPin,
  Building2,
  Clock,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  LogIn,
  LogOut,
  FileText,
  Phone,
  Navigation,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { fmtDate, fmtDateTime } from "@/lib/format";
import HazardForm from "@/components/HazardForm";
import PhotoUpload from "@/components/PhotoUpload";
import type { MyJob } from "@/lib/jobTypes";

type Phase = "Preparation" | "Setup" | "Pickup";

export default function JobDetail() {
  const params = useParams();
  const jobId = params.id as string;
  const utils = trpc.useUtils();

  const jobsQuery = trpc.technician.myJobs.useQuery();
  const job = useMemo(
    () => ((jobsQuery.data ?? []) as MyJob[]).find((j) => j.id === jobId),
    [jobsQuery.data, jobId],
  );

  const myPhases = (job?.myPhases ?? []) as Phase[];
  const [phase, setPhase] = useState<Phase | null>(null);
  const activePhase = phase ?? myPhases[0] ?? "Setup";

  const statusQuery = trpc.technician.jobStatus.useQuery(
    { jobId, phase: activePhase },
    { enabled: !!jobId },
  );

  const [hazardOpen, setHazardOpen] = useState(false);
  const [note, setNote] = useState("");

  const checkIn = trpc.technician.checkIn.useMutation({
    onSuccess: () => {
      toast.success("Checked in");
      statusQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const checkOut = trpc.technician.checkOut.useMutation({
    onSuccess: (r) => {
      toast.success(`Checked out — ${r.hours.toFixed(2)}h logged`);
      statusQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const addNote = trpc.technician.addFieldNote.useMutation({
    onSuccess: () => {
      toast.success("Note added");
      setNote("");
      utils.technician.myJobs.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (jobsQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-4">
        <Link href="/app" className="flex items-center gap-1 text-sm text-primary mb-4">
          <ArrowLeft className="size-4" /> Back
        </Link>
        <p className="text-muted-foreground">Job not found in your assignments.</p>
      </div>
    );
  }

  const st = statusQuery.data;
  const hazardDone = st?.hazardSubmitted ?? false;
  const checkedIn = st?.checkedIn ?? false;

  const doCheckIn = () => {
    if (!hazardDone) {
      toast.error("Complete the Hazard Assessment first");
      setHazardOpen(true);
      return;
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          checkIn.mutate({
            jobId,
            phase: activePhase,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          }),
        () => checkIn.mutate({ jobId, phase: activePhase }),
        { timeout: 5000 },
      );
    } else {
      checkIn.mutate({ jobId, phase: activePhase });
    }
  };

  const mapsUrl =
    job.lat && job.lon
      ? `https://www.google.com/maps/search/?api=1&query=${job.lat},${job.lon}`
      : job.jobAddress
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.jobAddress)}`
      : null;

  return (
    <div className="p-4 space-y-4">
      <Link href="/app" className="flex items-center gap-1 text-sm text-primary">
        <ArrowLeft className="size-4" /> My Jobs
      </Link>

      {/* Header */}
      <div className="bg-card border rounded-xl p-4">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <h1 className="font-bold text-lg">{job.company ?? "—"}</h1>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
          <MapPin className="size-4" />
          {job.jobAddress ?? "No address"}
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
          <Clock className="size-4" />
          {fmtDate(job.startDate)} → {fmtDate(job.endDate)}
        </div>
        {job.setupDuration && (
          <div className="text-sm text-muted-foreground mt-1">
            {job.setupDuration}
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <Navigation className="size-4 mr-1" /> Directions
              </Button>
            </a>
          )}
          {job.siteContactPhone && (
            <a href={`tel:${job.siteContactPhone}`}>
              <Button size="sm" variant="outline">
                <Phone className="size-4 mr-1" /> Site contact
              </Button>
            </a>
          )}
          {job.planFile?.[0]?.url && (
            <a href={job.planFile[0].url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <FileText className="size-4 mr-1" /> Plan
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Phase selector */}
      {myPhases.length > 1 && (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Phase
          </span>
          <Select
            value={activePhase}
            onValueChange={(v) => setPhase(v as Phase)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {myPhases.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Hazard + Check-in card */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Safety & Time — {activePhase}</span>
        </div>

        {statusQuery.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Hazard status */}
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                hazardDone
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {hazardDone ? (
                <ShieldCheck className="size-5" />
              ) : (
                <ShieldAlert className="size-5" />
              )}
              <span className="text-sm font-medium">
                {hazardDone
                  ? "Hazard assessment completed"
                  : "Hazard assessment required"}
              </span>
            </div>

            {!hazardDone && (
              <Button
                className="w-full"
                variant="secondary"
                onClick={() => setHazardOpen(true)}
              >
                <ShieldCheck className="size-4 mr-1" />
                Complete Hazard Assessment
              </Button>
            )}

            {/* Check-in/out */}
            {!checkedIn ? (
              <Button
                className="w-full"
                size="lg"
                disabled={!hazardDone || checkIn.isPending}
                onClick={doCheckIn}
              >
                {checkIn.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-1" />
                ) : (
                  <LogIn className="size-4 mr-1" />
                )}
                Check in
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="size-4 text-emerald-600" />
                  Checked in {fmtDateTime(st?.openLog?.checkInAt as any)}
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  variant="destructive"
                  disabled={checkOut.isPending}
                  onClick={() => checkOut.mutate({ jobId })}
                >
                  {checkOut.isPending ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <LogOut className="size-4 mr-1" />
                  )}
                  Check out
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Photos */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <span className="font-semibold">Field Photos</span>
        <PhotoUpload jobId={jobId} />
        {job.fieldPhotos?.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {job.fieldPhotos.slice(0, 9).map((p, i) => (
              <a
                key={i}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="aspect-square rounded-lg overflow-hidden bg-muted"
              >
                <img
                  src={p.thumbnails?.large?.url ?? p.url}
                  alt={p.filename ?? "photo"}
                  className="w-full h-full object-cover"
                />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <span className="font-semibold">Field Notes</span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Log anything out of the ordinary…"
          rows={3}
        />
        <Button
          className="w-full"
          variant="outline"
          disabled={!note.trim() || addNote.isPending}
          onClick={() => addNote.mutate({ jobId, note })}
        >
          {addNote.isPending && <Loader2 className="size-4 animate-spin mr-1" />}
          Add note
        </Button>
        {job.fieldComments && (
          <div className="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-2 max-h-40 overflow-y-auto">
            {job.fieldComments}
          </div>
        )}
      </div>

      <HazardForm
        jobId={jobId}
        phase={activePhase}
        open={hazardOpen}
        onOpenChange={setHazardOpen}
        onSubmitted={() => statusQuery.refetch()}
      />
    </div>
  );
}
