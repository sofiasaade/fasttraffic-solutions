import { trpc } from "@/lib/trpc";
import { Loader2, ChevronRight, ArrowLeft, Users } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";

/**
 * Coordinator view of the Technician App: pick an employee first, then browse
 * their app exactly as they see it (jobs by assigned time, hours, day session).
 * Selecting a name signs the session in as that technician via the local
 * login; the "Switch technician" button in the tech header comes back here.
 */
export default function TechRoster() {
  const rosterQuery = trpc.technician.roster.useQuery();

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-md mx-auto">
      <header className="sticky top-0 z-20 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2 font-bold">
            <BrandMark className="size-7" iconClassName="size-4" />
            Technician App
          </div>
          {/* Back to the coordinator console (before picking a technician). */}
          <a
            href="/dashboard"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-sidebar-accent"
            title="Back to coordinator console"
          >
            <ArrowLeft className="size-4" /> Coordinator
          </a>
        </div>
      </header>

      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Users className="size-4 text-primary" />
          <h1 className="text-lg font-extrabold tracking-tight">
            Choose a technician
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Open any employee to see their assigned jobs, hours and day session —
          exactly as they see it.
        </p>

        {rosterQuery.isLoading && (
          <div className="flex justify-center py-14">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="space-y-2">
          {rosterQuery.data?.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={async () => {
                const r = await fetch("/api/preview-tech", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ tech: t.airtableName }),
                });
                if (r.ok) window.location.href = "/app";
                else alert("Could not open this technician's app.");
              }}
              className="w-full text-left flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-center size-9 rounded-full bg-sidebar text-white text-xs font-bold shrink-0">
                {t.displayName
                  .split(/\s+/)
                  .map((p: string) => p[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">
                  {t.displayName}
                </div>
                <div className="text-[11px] text-muted-foreground capitalize">
                  {t.experienceLevel ?? "junior"}
                  {t.zones ? ` · ${t.zones}` : ""}
                </div>
              </div>
              <Badge variant="secondary" className="text-[10px] capitalize">
                {t.experienceLevel ?? "junior"}
              </Badge>
              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
