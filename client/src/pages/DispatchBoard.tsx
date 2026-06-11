import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Loader2,
  Settings2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { fmtDate, dayKey } from "@/lib/format";
import AssignmentDialog from "@/components/AssignmentDialog";
import JobModifyDialog from "@/components/JobModifyDialog";
import { cn } from "@/lib/utils";
import { ChangeBadge, type JobChangeRow } from "@/components/ChangeBadge";

import type { DispatchJob as Job } from "@/lib/jobTypes";

// Section definitions in display order. Status values match exact Airtable names.
type SectionKey = "submitted" | "approved" | "field";

const SECTIONS: {
  key: SectionKey;
  status: string;
  title: string;
  caption: string;
  dot: string;
}[] = [
  {
    key: "submitted",
    status: "Permit Request Submitted",
    title: "Permit Request Submitted",
    caption: "Submitted — prepare for upcoming days",
    dot: "#2563eb",
  },
  {
    key: "approved",
    status: "Permit Approved",
    title: "Permit Approved",
    caption: "Approved — ready to schedule",
    dot: "#ea580c",
  },
  {
    key: "field",
    status: "Field",
    title: "Field",
    caption: "Ongoing — equipment deployed until pickup is ordered",
    dot: "#16a34a",
  },
];

function isAssigned(j: Job): boolean {
  return Boolean(j.techPrep.length || j.techSetup.length || j.techPickup.length);
}

function JobRow({
  job,
  onAssign,
  onModify,
  changes,
}: {
  job: Job;
  onAssign: (j: Job) => void;
  onModify: (j: Job) => void;
  changes: JobChangeRow[];
}) {
  const assigned = isAssigned(job);
  return (
    <tr className="border-t border-border hover:bg-accent/40 transition-colors">
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{job.company ?? "—"}</span>
          <ChangeBadge changes={changes} />
        </div>
        {job.zone && (
          <div className="text-xs text-muted-foreground mt-0.5">{job.zone}</div>
        )}
      </td>
      <td className="px-4 py-3 align-top text-sm text-muted-foreground max-w-[280px]">
        {job.jobAddress ?? "No address"}
      </td>
      <td className="px-4 py-3 align-top text-sm whitespace-nowrap">
        {fmtDate(job.startDate)}
      </td>
      <td className="px-4 py-3 align-top">
        {assigned ? (
          <Badge variant="secondary" className="font-normal">
            Assigned
          </Badge>
        ) : (
          <Badge variant="destructive" className="font-normal">
            Unassigned
          </Badge>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex gap-2 justify-end">
          <Button size="sm" onClick={() => onAssign(job)}>
            <Users className="size-4 mr-1" />
            Assign
          </Button>
          <Button size="sm" variant="outline" onClick={() => onModify(job)}>
            <Settings2 className="size-4 mr-1" />
            Modify
          </Button>
        </div>
      </td>
    </tr>
  );
}

function SectionTable({
  title,
  caption,
  dot,
  jobs,
  onAssign,
  onModify,
  badges,
}: {
  title: string;
  caption: string;
  dot: string;
  jobs: Job[];
  onAssign: (j: Job) => void;
  onModify: (j: Job) => void;
  badges: Record<string, JobChangeRow[]>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="bg-card border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
      >
        <span
          className="size-3 rounded-full ring-2 ring-white shadow shrink-0"
          style={{ background: dot }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold">{title}</h2>
            <Badge variant="outline">{jobs.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
        <ChevronDown
          className={cn(
            "size-5 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="overflow-x-auto">
          {jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground px-4 py-6 border-t border-border">
              No jobs in this section match the filters.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Address</th>
                  <th className="px-4 py-2 font-medium">Start date</th>
                  <th className="px-4 py-2 font-medium">Assignment</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <JobRow
                    key={j.id}
                    job={j}
                    onAssign={onAssign}
                    onModify={onModify}
                    changes={badges[j.id] ?? []}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

export default function DispatchBoard() {
  const jobsQuery = trpc.coordinator.boardJobs.useQuery();
  const changeBadgesQuery = trpc.coordinator.changeBadges.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const badges = (changeBadgesQuery.data ?? {}) as Record<
    string,
    JobChangeRow[]
  >;
  const [zone, setZone] = useState("all");
  const [date, setDate] = useState("");
  const [assignJob, setAssignJob] = useState<Job | null>(null);
  const [modifyJob, setModifyJob] = useState<Job | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    jobsQuery.data?.forEach((j) => j.zone && set.add(j.zone));
    return Array.from(set).sort();
  }, [jobsQuery.data]);

  const filtered = useMemo(() => {
    let jobs = (jobsQuery.data ?? []) as Job[];
    if (zone !== "all") jobs = jobs.filter((j) => j.zone === zone);
    if (date)
      jobs = jobs.filter((j) => {
        const s = dayKey(j.startDate);
        const e = dayKey(j.endDate) || s;
        return date >= s && date <= e;
      });
    return jobs;
  }, [jobsQuery.data, zone, date]);

  // Group jobs by section status. Sort each section by start date ascending.
  const grouped = useMemo(() => {
    const map: Record<SectionKey, Job[]> = {
      submitted: [],
      approved: [],
      field: [],
    };
    for (const j of filtered) {
      const section = SECTIONS.find((s) => s.status === j.status);
      if (section) map[section.key].push(j);
    }
    (Object.keys(map) as SectionKey[]).forEach((k) =>
      map[k].sort((a, b) => dayKey(a.startDate).localeCompare(dayKey(b.startDate))),
    );
    return map;
  }, [filtered]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Dispatch Board
          </h1>
          <p className="text-sm text-muted-foreground">
            Jobs grouped by status — Submitted, Approved, and Field
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => jobsQuery.refetch()}
          disabled={jobsQuery.isFetching}
        >
          {jobsQuery.isFetching ? (
            <Loader2 className="size-4 animate-spin mr-1" />
          ) : null}
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="w-44">
          <Select value={zone} onValueChange={setZone}>
            <SelectTrigger>
              <SelectValue placeholder="Zone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All zones</SelectItem>
              {zones.map((z) => (
                <SelectItem key={z} value={z}>
                  {z}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {(zone !== "all" || date) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setZone("all");
              setDate("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {jobsQuery.isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {jobsQuery.error && (
        <div className="flex items-center gap-2 text-destructive p-4 border border-destructive/30 rounded-lg">
          <AlertCircle className="size-5" />
          {jobsQuery.error.message}
        </div>
      )}

      {jobsQuery.data && (
        <div className="space-y-5">
          {SECTIONS.map((s) => (
            <SectionTable
              key={s.key}
              title={s.title}
              caption={s.caption}
              dot={s.dot}
              jobs={grouped[s.key]}
              onAssign={setAssignJob}
              onModify={setModifyJob}
              badges={badges}
            />
          ))}
        </div>
      )}

      <AssignmentDialog
        job={assignJob}
        open={!!assignJob}
        onOpenChange={(v) => !v && setAssignJob(null)}
      />
      <JobModifyDialog
        job={modifyJob}
        open={!!modifyJob}
        onOpenChange={(v) => !v && setModifyJob(null)}
      />
    </div>
  );
}
