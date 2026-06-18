import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  User,
  GraduationCap,
  CalendarDays,
  FileText,
  Upload,
  Trash2,
  Loader2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Level = "apprentice" | "junior" | "medium" | "senior";

const LEVEL_META: Record<Level, { label: string; cls: string }> = {
  apprentice: { label: "Apprentice", cls: "bg-amber-100 text-amber-700" },
  junior: { label: "Junior", cls: "bg-slate-100 text-slate-600" },
  medium: { label: "Medium", cls: "bg-emerald-100 text-emerald-700" },
  senior: { label: "Senior", cls: "bg-blue-100 text-blue-700" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function levelBadge(level: string) {
  const meta = LEVEL_META[(level as Level) ?? "junior"] ?? LEVEL_META.junior;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        meta.cls,
      )}
    >
      {meta.label}
    </span>
  );
}

export function TechnicianProfileButton({
  airtableName,
  displayName,
  experienceLevel,
  trigger,
}: {
  airtableName: string;
  displayName: string;
  experienceLevel: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            title="View profile"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <User className="size-3.5" />
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {displayName}
            {levelBadge(experienceLevel)}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <ProfileBody
            airtableName={airtableName}
            currentLevel={experienceLevel as Level}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileBody({
  airtableName,
  currentLevel,
}: {
  airtableName: string;
  currentLevel: Level;
}) {
  const utils = trpc.useUtils();
  const profileQuery = trpc.coordinator.technicianProfile.useQuery({
    airtableName,
  });

  const [headline, setHeadline] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [years, setYears] = useState<string>("");

  const data = profileQuery.data;
  // Initialize local form state once data arrives.
  if (data && headline === null) {
    setHeadline(data.profile?.headline ?? "");
    setSummary(data.profile?.experienceSummary ?? "");
    setYears(
      data.profile?.yearsExperience != null
        ? String(data.profile.yearsExperience)
        : "",
    );
  }

  const setLevel = trpc.coordinator.setTechnicianLevel.useMutation({
    onSuccess: () => {
      utils.coordinator.technicians.invalidate();
      toast.success("Level updated");
    },
  });

  const saveProfile = trpc.coordinator.saveTechnicianProfile.useMutation({
    onSuccess: () => {
      utils.coordinator.technicianProfile.invalidate({ airtableName });
      toast.success("Profile saved");
    },
    onError: (e) => toast.error(e.message),
  });

  if (profileQuery.isLoading) {
    return (
      <div className="py-10 flex justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Level + experience */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-primary" /> Experience level
        </div>
        <div className="flex gap-2">
          {(["apprentice", "junior", "medium", "senior"] as Level[]).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevel.mutate({ airtableName, level: lvl })}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                currentLevel === lvl
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {LEVEL_META[lvl].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Level is informed by experience and the safety certificates on file.
        </p>
      </section>

      {/* Profile fields */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-primary" /> Professional profile
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="headline">Headline</Label>
            <Input
              id="headline"
              placeholder="e.g. Lead setup technician, TCP certified"
              value={headline ?? ""}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="years">Years of experience</Label>
            <Input
              id="years"
              type="number"
              min={0}
              max={80}
              className="w-32"
              value={years}
              onChange={(e) => setYears(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="summary">Experience summary</Label>
            <Textarea
              id="summary"
              rows={4}
              placeholder="Describe the technician's experience, skills, equipment certifications, etc."
              value={summary ?? ""}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div>
            <Button
              size="sm"
              disabled={saveProfile.isPending}
              onClick={() =>
                saveProfile.mutate({
                  airtableName,
                  headline: headline?.trim() || undefined,
                  experienceSummary: summary?.trim() || undefined,
                  yearsExperience: years ? Number(years) : undefined,
                })
              }
            >
              {saveProfile.isPending && (
                <Loader2 className="size-3.5 animate-spin mr-1" />
              )}
              Save profile
            </Button>
          </div>
        </div>
      </section>

      {/* Availability */}
      <AvailabilitySection
        airtableName={airtableName}
        availability={data?.availability ?? []}
      />

      {/* Certificates */}
      <CertificatesSection
        airtableName={airtableName}
        certificates={data?.certificates ?? []}
      />
    </div>
  );
}

function AvailabilitySection({
  airtableName,
  availability,
}: {
  airtableName: string;
  availability: Array<{
    id: number;
    kind: string;
    weekday: number | null;
    date: string | null;
    available: boolean;
    reason: string | null;
  }>;
}) {
  const utils = trpc.useUtils();
  const setWeekday = trpc.coordinator.setWeekdayAvailability.useMutation({
    onSuccess: () => utils.coordinator.technicianProfile.invalidate({ airtableName }),
    onError: (e) => toast.error(e.message),
  });

  // Build a quick lookup of weekday -> available (default true).
  const weekdayRule = new Map<number, { id: number; available: boolean }>();
  availability
    .filter((a) => a.kind === "weekday" && a.weekday != null)
    .forEach((a) => weekdayRule.set(a.weekday as number, { id: a.id, available: a.available }));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CalendarDays className="size-4 text-primary" /> Weekly availability
      </div>
      <p className="text-xs text-muted-foreground">
        Click a day to toggle whether this technician normally works it. Greyed
        days show as unavailable on the Workers calendar.
      </p>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((label, wd) => {
          const rule = weekdayRule.get(wd);
          const unavailable = rule ? !rule.available : false;
          return (
            <button
              key={wd}
              type="button"
              disabled={setWeekday.isPending}
              onClick={() =>
                setWeekday.mutate({
                  airtableName,
                  weekday: wd,
                  available: unavailable, // toggle: if currently unavailable, make available
                })
              }
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                unavailable
                  ? "border-slate-300 bg-[repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb_4px,#f3f4f6_4px,#f3f4f6_8px)] text-slate-500"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CertificatesSection({
  airtableName,
  certificates,
}: {
  airtableName: string;
  certificates: Array<{
    id: number;
    name: string;
    issuer: string | null;
    issuedDate: string | null;
    expiryDate: string | null;
    fileUrl: string | null;
    fileName: string | null;
  }>;
}) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [fileData, setFileData] = useState<{
    dataBase64: string;
    mimeType: string;
    fileName: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = trpc.coordinator.uploadCertificate.useMutation({
    onSuccess: () => {
      utils.coordinator.technicianProfile.invalidate({ airtableName });
      utils.coordinator.certificateCounts.invalidate();
      toast.success("Certificate added");
      setName("");
      setIssuer("");
      setIssuedDate("");
      setExpiryDate("");
      setFileData(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setUploading(false),
  });

  const del = trpc.coordinator.deleteCertificate.useMutation({
    onSuccess: () => {
      utils.coordinator.technicianProfile.invalidate({ airtableName });
      utils.coordinator.certificateCounts.invalidate();
      toast.success("Certificate removed");
    },
    onError: (e) => toast.error(e.message),
  });

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("File too large (max 8MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFileData({
        dataBase64: result,
        mimeType: file.type || "application/octet-stream",
        fileName: file.name,
      });
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    };
    reader.readAsDataURL(file);
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Certificate name is required");
      return;
    }
    setUploading(true);
    upload.mutate({
      airtableName,
      name: name.trim(),
      issuer: issuer.trim() || undefined,
      issuedDate: issuedDate || undefined,
      expiryDate: expiryDate || undefined,
      dataBase64: fileData?.dataBase64,
      mimeType: fileData?.mimeType,
      fileName: fileData?.fileName,
    });
  }

  function isExpired(d: string | null) {
    if (!d) return false;
    return new Date(d + "T23:59:59") < new Date();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <GraduationCap className="size-4 text-primary" /> Safety certificates
      </div>

      {certificates.length === 0 ? (
        <p className="text-xs text-muted-foreground">No certificates on file yet.</p>
      ) : (
        <ul className="space-y-2">
          {certificates.map((c) => (
            <li
              key={c.id}
              className="flex items-start gap-3 rounded-lg border border-border p-3"
            >
              <FileText className="size-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.expiryDate && (
                    <Badge
                      variant={isExpired(c.expiryDate) ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {isExpired(c.expiryDate) ? "Expired" : "Valid"} ·{" "}
                      {c.expiryDate}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.issuer ? c.issuer : "Unknown issuer"}
                  {c.issuedDate ? ` · issued ${c.issuedDate}` : ""}
                </div>
                {c.fileUrl && (
                  <a
                    href={c.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                    {c.fileName ?? "View file"}
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => del.mutate({ id: c.id })}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Delete certificate"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add new certificate */}
      <div className="rounded-lg border border-dashed border-border p-3 space-y-2.5">
        <div className="grid sm:grid-cols-2 gap-2.5">
          <div className="grid gap-1.5">
            <Label className="text-xs">Certificate name *</Label>
            <Input
              placeholder="e.g. Traffic Control Person (TCP)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Issuer</Label>
            <Input
              placeholder="e.g. Alberta Construction Safety"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Issued date</Label>
            <Input
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Expiry date</Label>
            <Input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={onPickFile}
            className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-accent file:px-2 file:py-1 file:text-xs file:font-medium"
          />
          {fileData && (
            <span className="text-xs text-emerald-600 truncate">
              {fileData.fileName}
            </span>
          )}
        </div>
        <Button size="sm" onClick={submit} disabled={uploading}>
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin mr-1" />
          ) : (
            <Upload className="size-3.5 mr-1" />
          )}
          Add certificate
        </Button>
      </div>
    </section>
  );
}
