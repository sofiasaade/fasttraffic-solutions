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
  MapPin,
  Calendar,
  Loader2,
  Settings2,
  AlertCircle,
  Building2,
} from "lucide-react";
import { fmtDate, fmtTimeRange, dayKey } from "@/lib/format";
import AssignmentDialog from "@/components/AssignmentDialog";
import JobModifyDialog from "@/components/JobModifyDialog";
import { cn } from "@/lib/utils";

import type { DispatchJob as Job } from "@/lib/jobTypes";

function PhaseChips({ job }: { job: Job }) {
  const groups: { label: string; techs: string[] }[] = [
    { label: "Prep", techs: job.techPrep },
    { label: "Setup", techs: job.techSetup },
    { label: "Pickup", techs: job.techPickup },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <div
          key={g.label}
          className={cn(
            "text-xs px-2 py-1 rounded-md border",
            g.techs.length
              ? "border-primary/30 bg-primary/5 text-foreground"
              : "border-dashed border-muted-foreground/30 text-muted-foreground",
          )}
        >
          <span className="font-semibold">{g.label}:</span>{" "}
          {g.techs.length ? g.techs.join(", ") : "—"}
        </div>
      ))}
    </div>
  );
}

function JobCard({
  job,
  onAssign,
  onModify,
}: {
  job: Job;
  onAssign: (j: Job) => void;
  onModify: (j: Job) => void;
}) {
  return (
    <div className="bg-card border rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-muted-foreground shrink-0" />
            <h3 className="font-semibold truncate">{job.company ?? "—"}</h3>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{job.jobAddress ?? "No address"}</span>
          </div>
        </div>
        <Badge variant={job.status === "Field" ? "default" : "secondary"}>
          {job.status}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-3">
        <span className="flex items-center gap-1.5">
          <Calendar className="size-3.5" />
          {fmtDate(job.startDate)} → {fmtDate(job.endDate)}
        </span>
        {job.zone && (
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            {job.zone}
          </span>
        )}
      </div>

      {job.setupDuration && (
        <div className="text-xs text-muted-foreground mt-1">
          {job.setupDuration}
        </div>
      )}

      <div className="mt-3">
        <PhaseChips job={job} />
      </div>

      <div className="flex gap-2 mt-4">
        <Button size="sm" onClick={() => onAssign(job)}>
          <Users className="size-4 mr-1" />
          Assign
        </Button>
        <Button size="sm" variant="outline" onClick={() => onModify(job)}>
          <Settings2 className="size-4 mr-1" />
          Modify
        </Button>
      </div>
    </div>
  );
}

export default function DispatchBoard() {
  const jobsQuery = trpc.coordinator.dispatchJobs.useQuery();
  const [zone, setZone] = useState("all");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("");
  const [assignJob, setAssignJob] = useState<Job | null>(null);
  const [modifyJob, setModifyJob] = useState<Job | null>(null);

  const zones = useMemo(() => {
    const set = new Set<string>();
    jobsQuery.data?.forEach((j) => j.zone && set.add(j.zone));
    return Array.from(set).sort();
  }, [jobsQuery.data]);

  const filtered = useMemo(() => {
    let jobs = jobsQuery.data ?? [];
    if (zone !== "all") jobs = jobs.filter((j) => j.zone === zone);
    if (status !== "all") jobs = jobs.filter((j) => j.status === status);
    if (date) jobs = jobs.filter((j) => {
      const s = dayKey(j.startDate);
      const e = dayKey(j.endDate) || s;
      return date >= s && date <= e;
    });
    return jobs;
  }, [jobsQuery.data, zone, status, date]);

  const unassigned = filtered.filter(
    (j) => !j.techPrep.length && !j.techSetup.length && !j.techPickup.length,
  );
  const active = filtered.filter(
    (j) => j.techPrep.length || j.techSetup.length || j.techPickup.length,
  );

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Dispatch Board
          </h1>
          <p className="text-sm text-muted-foreground">
            Jobs in Field / Permit Approved status
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
        <div className="w-40">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Field">Field</SelectItem>
              <SelectItem value="Permit Approved">Permit Approved</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
        {(zone !== "all" || status !== "all" || date) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setZone("all");
              setStatus("all");
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Unassigned */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-bold text-lg">Unassigned</h2>
              <Badge variant="destructive">{unassigned.length}</Badge>
            </div>
            <div className="space-y-3">
              {unassigned.length === 0 && (
                <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-6 text-center">
                  All filtered jobs have technicians assigned.
                </div>
              )}
              {unassigned.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  onAssign={setAssignJob}
                  onModify={setModifyJob}
                />
              ))}
            </div>
          </section>

          {/* Active */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-bold text-lg">Active / Assigned</h2>
              <Badge>{active.length}</Badge>
            </div>
            <div className="space-y-3">
              {active.length === 0 && (
                <div className="text-sm text-muted-foreground border border-dashed rounded-xl p-6 text-center">
                  No assigned jobs match the filters.
                </div>
              )}
              {active.map((j) => (
                <JobCard
                  key={j.id}
                  job={j}
                  onAssign={setAssignJob}
                  onModify={setModifyJob}
                />
              ))}
            </div>
          </section>
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
