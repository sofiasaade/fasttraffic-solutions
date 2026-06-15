import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, Building2, MapPin, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * GlobalProjectSearch
 *
 * A single search box that lives in the coordinator shell (top bar) and is
 * therefore available from EVERY coordinator window. It searches the shared
 * job/project list (the same `coordinator.mapJobs` source every other view
 * reads from) so results stay consistent across the app.
 *
 * Selecting a result navigates to the Scheduler and focuses that project via
 * the `?project=<id>` query param, which the Scheduler reads to pre-fill its
 * search and highlight/expand the matching job.
 */
type ProjectHit = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  municipality: string | null;
  status: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

export default function GlobalProjectSearch({
  className,
}: {
  className?: string;
}) {
  const [, navigate] = useLocation();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reuse the shared project list. Kept fresh on an interval so the search
  // reflects the same data the other windows show.
  const { data } = trpc.coordinator.mapJobs.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const results = useMemo<ProjectHit[]>(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const list = (data as ProjectHit[] | undefined) ?? [];
    return list
      .filter(
        (j) =>
          norm(j.company).includes(q) ||
          norm(j.jobAddress).includes(q) ||
          norm(j.municipality).includes(q),
      )
      .slice(0, 8);
  }, [data, term]);

  // Reset highlight when the result set changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [term]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const go = (hit: ProjectHit) => {
    setOpen(false);
    setTerm("");
    navigate(`/scheduler?project=${encodeURIComponent(hit.id)}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showDropdown = open && term.trim().length > 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search projects (client, address, city)…"
          aria-label="Search projects"
          className="w-full h-10 rounded-lg border border-border bg-background pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-orange-300/60 focus:border-orange-300 transition"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setOpen(false);
            }}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              No projects match “{term.trim()}”.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((hit, i) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => go(hit)}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                      i === activeIdx
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/60",
                    )}
                  >
                    <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {hit.company || "—"}
                      </span>
                      {(hit.jobAddress || hit.municipality) && (
                        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">
                            {hit.jobAddress || hit.municipality}
                          </span>
                        </span>
                      )}
                    </span>
                    {hit.status && (
                      <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {hit.status}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
