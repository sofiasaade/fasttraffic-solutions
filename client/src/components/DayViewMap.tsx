import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { MapView } from "@/components/Map";
import { Loader2, AlertTriangle, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A compact map for the Dashboard Day view. Plots that day's jobs
 * (startingToday / ongoing / pickup) with color-coded markers. Reuses the
 * Google Maps proxy via the shared <MapView> component.
 */

export type DayMapJob = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  municipality?: string | null;
  startDate: string | null;
  endDate: string | null;
  status?: string | null;
  subStatus?: string | null;
  emoji?: string | null;
  permitStartTime?: string | null;
  lat: number | null;
  lon: number | null;
};

export type DayMarker = DayMapJob & {
  bucket: "starting" | "ongoing" | "pickup";
};

const BUCKET_THEME: Record<
  DayMarker["bucket"],
  { label: string; bg: string; border: string; dot: string }
> = {
  starting: { label: "Starting today", bg: "#ea580c", border: "#9a3412", dot: "#ea580c" },
  ongoing: { label: "Ongoing (daily)", bg: "#2563eb", border: "#1e40af", dot: "#2563eb" },
  pickup: { label: "Pick up today", bg: "#16a34a", border: "#166534", dot: "#16a34a" },
};

const DEFAULT_CENTER = { lat: 51.0447, lng: -114.0719 }; // Calgary

// Build a circular DOM pin split into N equal color wedges (used when a job
// belongs to more than one bucket on the same day, e.g. starting + pickup).
function makeSplitPin(colors: string[]): HTMLElement {
  const el = document.createElement("div");
  const size = 26;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "50%";
  el.style.border = "2px solid #ffffff";
  el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
  if (colors.length === 2) {
    el.style.background = `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  } else {
    el.style.background = `conic-gradient(${colors[0]} 0 120deg, ${colors[1]} 120deg 240deg, ${colors[2]} 240deg 360deg)`;
  }
  return el;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function DayViewMap({
  markers,
  isLoading,
}: {
  markers: DayMarker[];
  isLoading: boolean;
}) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [unlocated, setUnlocated] = useState(0);

  // Visible bucket filters (toggles). All on by default.
  const [visible, setVisible] = useState<Record<DayMarker["bucket"], boolean>>({
    starting: true,
    ongoing: true,
    pickup: true,
  });
  const toggle = (k: DayMarker["bucket"]) =>
    setVisible((v) => ({ ...v, [k]: !v[k] }));

  const counts = useMemo(() => {
    const c = { starting: 0, ongoing: 0, pickup: 0 };
    for (const m of markers) c[m.bucket]++;
    return c;
  }, [markers]);

  const filteredMarkers = useMemo(
    () => markers.filter((m) => visible[m.bucket]),
    [markers, visible],
  );

  const infoHtml = (j: DayMarker, buckets: DayMarker["bucket"][]) => {
    const badges = buckets
      .map((b) => {
        const t = BUCKET_THEME[b];
        return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${t.bg}1a;color:${t.bg};padding:2px 8px;border-radius:999px;margin-right:4px">${t.label}</span>`;
      })
      .join("");
    return `<div style="font-family:Inter,system-ui,sans-serif;max-width:240px">
      <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(
        j.company ?? "Job",
      )}</div>
      <div style="font-size:12px;color:#475569;margin-bottom:6px">${escapeHtml(
        j.jobAddress ?? "",
      )}</div>
      <div style="font-size:11px;color:#64748b">${escapeHtml(
        shortDate(j.startDate),
      )} → ${escapeHtml(shortDate(j.endDate))}${
        j.permitStartTime ? ` · ${escapeHtml(j.permitStartTime)}` : ""
      }</div>
      <div style="margin-top:6px">${badges}</div>
    </div>`;
  };

  const placeMarkers = useCallback(
    async (map: google.maps.Map, list: DayMarker[]) => {
      const g = window.google;
      if (!g) return;
      const markerLib = (await g.maps.importLibrary(
        "marker",
      )) as google.maps.MarkerLibrary;
      const { AdvancedMarkerElement, PinElement } = markerLib;

      if (!infoRef.current) infoRef.current = new g.maps.InfoWindow();
      const bounds = new g.maps.LatLngBounds();
      let placed = 0;
      let missing = 0;

      markersRef.current.forEach((m) => (m.map = null));
      markersRef.current = [];

      // Collapse the (possibly multiple) markers for a single job id into ONE
      // map pin, while remembering EVERY bucket that job belongs to. A one-day
      // job appears in both "starting" and "pickup"; we want a split pin so the
      // coordinator can see it begins AND ends the same day.
      const grouped = new Map<
        string,
        { job: DayMarker; buckets: Set<DayMarker["bucket"]> }
      >();
      for (const j of list) {
        const entry = grouped.get(j.id);
        if (entry) {
          entry.buckets.add(j.bucket);
          // Prefer the "starting" record as the representative for info/title.
          if (entry.job.bucket === "pickup" && j.bucket === "starting") {
            entry.job = j;
          }
        } else {
          grouped.set(j.id, { job: j, buckets: new Set([j.bucket]) });
        }
      }

      for (const { job: j, buckets } of Array.from(grouped.values())) {
        if (typeof j.lat !== "number" || typeof j.lon !== "number") {
          missing++;
          continue;
        }
        const pos = { lat: j.lat, lng: j.lon };
        // Ordered list of distinct bucket colors present for this job.
        const order: DayMarker["bucket"][] = ["starting", "ongoing", "pickup"];
        const activeBuckets = order.filter((b) => buckets.has(b));
        const isSplit = activeBuckets.length > 1;

        let content: HTMLElement;
        if (isSplit) {
          content = makeSplitPin(activeBuckets.map((b) => BUCKET_THEME[b].bg));
        } else {
          const theme = BUCKET_THEME[activeBuckets[0] ?? j.bucket];
          const pin = new PinElement({
            background: theme.bg,
            borderColor: theme.border,
            glyphColor: "#ffffff",
            scale: 1.05,
          });
          content = pin.element;
        }
        const marker = new AdvancedMarkerElement({
          map,
          position: pos,
          title: j.company ?? "Job",
          content,
        });
        marker.addListener("click", () => {
          infoRef.current?.setContent(infoHtml(j, activeBuckets));
          infoRef.current?.open(map, marker);
        });
        markersRef.current.push(marker);
        bounds.extend(pos);
        placed++;
      }

      if (placed > 0) {
        map.fitBounds(bounds);
        if (placed === 1) map.setZoom(14);
      }
      setUnlocated(missing);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onMapReady = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      placeMarkers(map, filteredMarkers);
    },
    [filteredMarkers, placeMarkers],
  );

  useEffect(() => {
    if (mapRef.current) placeMarkers(mapRef.current, filteredMarkers);
  }, [filteredMarkers, placeMarkers]);

  const total = counts.starting + counts.ongoing + counts.pickup;
  const visibleTotal = filteredMarkers.length;

  return (
    <div className="rounded-2xl border border-border bg-card/50 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center size-7 rounded-lg shrink-0"
            style={{ background: "#ea580c1a", color: "#ea580c" }}
          >
            <MapPinned className="size-4" />
          </div>
          <h3 className="font-bold text-sm">Day map</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {(Object.keys(BUCKET_THEME) as DayMarker["bucket"][]).map((k) => {
            const on = visible[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all active:scale-[0.97]",
                  on
                    ? "border-border bg-card text-foreground"
                    : "border-dashed border-border bg-transparent text-muted-foreground opacity-60",
                )}
              >
                <span
                  className="size-2.5 rounded-full ring-2 ring-white shadow"
                  style={{ background: BUCKET_THEME[k].dot }}
                />
                {BUCKET_THEME[k].label}
                <span className="text-muted-foreground/70">({counts[k]})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-4 py-1 text-[11px] text-muted-foreground border-b border-border">
        <span
          className="inline-block size-3 rounded-full ring-2 ring-white shadow shrink-0"
          style={{
            background:
              "linear-gradient(90deg, #ea580c 0 50%, #16a34a 50% 100%)",
          }}
        />
        Split pin = job starts and is picked up the same day.
      </div>

      {unlocated > 0 && (
        <div className="flex items-center gap-1.5 bg-amber-50 px-4 py-1 text-[11px] text-amber-700">
          <AlertTriangle className="size-3" /> {unlocated} job
          {unlocated === 1 ? "" : "s"} without coordinates not shown on the map.
        </div>
      )}

      <div className="relative h-[320px]">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading map…
          </div>
        ) : total === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No jobs on this day.
          </div>
        ) : (
          <>
            <MapView
              className={cn("w-full h-full")}
              initialCenter={DEFAULT_CENTER}
              initialZoom={10}
              onMapReady={onMapReady}
            />
            {visibleTotal === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground pointer-events-none">
                No jobs match the selected filters.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
