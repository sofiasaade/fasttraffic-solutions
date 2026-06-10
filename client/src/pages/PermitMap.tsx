import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { MapView } from "@/components/Map";
import { trpc } from "@/lib/trpc";
import { fmtDate, fmtTimeRange } from "@/lib/format";
import { Loader2, MapPin, AlertTriangle, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MapJob = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  municipality: string | null;
  startDate: string | null;
  endDate: string | null;
  setupDuration: string | null;
  status: string | null;
  subStatus: string | null;
  zone: string;
  lat: number | null;
  lon: number | null;
};

// Status grouping + color theme. Any status not matched falls back to "other".
type StatusKey = "field" | "approved" | "submitted" | "cancelled";

const STATUS_THEME: Record<
  StatusKey,
  { label: string; bg: string; border: string; chipBg: string; chipText: string; dot: string }
> = {
  field: {
    label: "Field (ongoing)",
    bg: "#16a34a",
    border: "#166534",
    chipBg: "#f0fdf4",
    chipText: "#15803d",
    dot: "#16a34a",
  },
  approved: {
    label: "Permit Approved",
    bg: "#ea580c",
    border: "#9a3412",
    chipBg: "#fff7ed",
    chipText: "#c2410c",
    dot: "#ea580c",
  },
  submitted: {
    label: "Permit Request Submitted",
    bg: "#2563eb",
    border: "#1e40af",
    chipBg: "#eff6ff",
    chipText: "#1d4ed8",
    dot: "#2563eb",
  },
  cancelled: {
    label: "Cancelled / Declined",
    bg: "#dc2626",
    border: "#991b1b",
    chipBg: "#fef2f2",
    chipText: "#b91c1c",
    dot: "#dc2626",
  },
};

function statusKey(status: string | null): StatusKey {
  const s = (status ?? "").toLowerCase();
  if (s.includes("cancel") || s.includes("declin")) return "cancelled";
  if (s === "field") return "field";
  if (s === "permit approved") return "approved";
  if (s === "permit request submitted") return "submitted";
  // Default bucket so unexpected statuses still render (as approved theme).
  return "approved";
}

// Alberta-centered default view (Calgary).
const DEFAULT_CENTER = { lat: 51.0447, lng: -114.0719 };

export default function PermitMap() {
  const { data: jobs, isLoading } = trpc.coordinator.mapJobs.useQuery();
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [unlocated, setUnlocated] = useState<MapJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Visible status filters (toggles). All on by default.
  const [visible, setVisible] = useState<Record<StatusKey, boolean>>({
    field: true,
    approved: true,
    submitted: true,
    // Cancelled/declined jobs are hidden by default to keep the map clean.
    cancelled: false,
  });

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = { field: 0, approved: 0, submitted: 0, cancelled: 0 };
    for (const j of (jobs as MapJob[] | undefined) ?? []) c[statusKey(j.status)]++;
    return c;
  }, [jobs]);

  const filteredJobs = useMemo(
    () =>
      ((jobs as MapJob[] | undefined) ?? []).filter(
        (j) => visible[statusKey(j.status)],
      ),
    [jobs, visible],
  );

  const infoHtml = (j: MapJob) => {
    const t = STATUS_THEME[statusKey(j.status)];
    return `<div style="font-family:Inter,system-ui,sans-serif;max-width:240px">
      <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(
        j.company ?? "Job",
      )}</div>
      <div style="font-size:12px;color:#475569;margin-bottom:6px">${escapeHtml(
        j.jobAddress ?? "",
      )}</div>
      <div style="font-size:11px;color:#64748b">${escapeHtml(
        fmtDate(j.startDate),
      )} → ${escapeHtml(fmtDate(j.endDate))}</div>
      ${
        j.setupDuration
          ? `<div style="font-size:11px;color:#64748b">${escapeHtml(
              fmtTimeRange(j.setupDuration),
            )}</div>`
          : ""
      }
      <div style="margin-top:6px;display:inline-block;font-size:10px;font-weight:600;background:${
        t.chipBg
      };color:${t.chipText};padding:2px 8px;border-radius:999px">${escapeHtml(
        j.status ?? t.label,
      )}${j.subStatus ? ` · ${escapeHtml(j.subStatus)}` : ""}</div>
    </div>`;
  };

  const placeMarkers = useCallback(
    async (map: google.maps.Map, list: MapJob[]) => {
      const g = window.google;
      if (!g) return;

      // Ensure the marker library is loaded before creating AdvancedMarkers.
      const markerLib = (await g.maps.importLibrary(
        "marker",
      )) as google.maps.MarkerLibrary;
      const { AdvancedMarkerElement, PinElement } = markerLib;

      if (!infoRef.current) infoRef.current = new g.maps.InfoWindow();
      const geocoder = new g.maps.Geocoder();
      const bounds = new g.maps.LatLngBounds();
      const missing: MapJob[] = [];
      let placed = 0;

      // Clear any existing markers.
      markersRef.current.forEach((m) => (m.map = null));
      markersRef.current = [];

      for (const j of list) {
        let pos: google.maps.LatLngLiteral | null = null;
        if (typeof j.lat === "number" && typeof j.lon === "number") {
          pos = { lat: j.lat, lng: j.lon };
        } else if (j.jobAddress) {
          // Geocode by address as a fallback.
          pos = await new Promise<google.maps.LatLngLiteral | null>((resolve) => {
            geocoder.geocode(
              { address: `${j.jobAddress}, ${j.municipality ?? "Alberta"}, Canada` },
              (results, status) => {
                if (status === "OK" && results && results[0]) {
                  const loc = results[0].geometry.location;
                  resolve({ lat: loc.lat(), lng: loc.lng() });
                } else {
                  resolve(null);
                }
              },
            );
          });
        }

        if (!pos) {
          missing.push(j);
          continue;
        }

        const theme = STATUS_THEME[statusKey(j.status)];
        const pin = new PinElement({
          background: theme.bg,
          borderColor: theme.border,
          glyphColor: "#ffffff",
          scale: 1.1,
        });
        const marker = new AdvancedMarkerElement({
          map,
          position: pos,
          title: j.company ?? "Job",
          content: pin.element,
        });
        marker.addListener("click", () => {
          infoRef.current?.setContent(infoHtml(j));
          infoRef.current?.open(map, marker);
          setSelectedId(j.id);
        });
        (marker as any)._jobId = j.id;
        (marker as any)._pos = pos;
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
    // infoHtml closes over nothing stateful; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onMapReady = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      placeMarkers(map, filteredJobs);
    },
    [filteredJobs, placeMarkers],
  );

  // (Re)place markers whenever the visible/filtered jobs change and the map is ready.
  useEffect(() => {
    if (mapRef.current) {
      placeMarkers(mapRef.current, filteredJobs);
    }
  }, [filteredJobs, placeMarkers]);

  // Focus a job from the side list.
  const focusJob = (j: MapJob) => {
    const map = mapRef.current;
    if (!map) return;
    const marker = markersRef.current.find((m) => (m as any)._jobId === j.id);
    if (marker && (marker as any)._pos) {
      map.panTo((marker as any)._pos);
      map.setZoom(15);
      infoRef.current?.setContent(infoHtml(j));
      infoRef.current?.open(map, marker);
      setSelectedId(j.id);
    }
  };

  const toggle = (k: StatusKey) =>
    setVisible((v) => ({ ...v, [k]: !v[k] }));

  const placedCount = filteredJobs.length - unlocated.length;

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] md:h-screen">
      <div className="px-6 pt-6 pb-3 border-b border-border">
        <h1 className="text-2xl font-extrabold tracking-tight">Permit Map</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Jobs plotted by location, color-coded by status.
          {!isLoading && jobs ? (
            <span className="ml-1">
              {Math.max(placedCount, 0)} mapped
              {unlocated.length > 0
                ? `, ${unlocated.length} without coordinates`
                : ""}
              .
            </span>
          ) : null}
        </p>

        {/* Legend + toggle filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          {(Object.keys(STATUS_THEME) as StatusKey[]).map((k) => {
            const t = STATUS_THEME[k];
            const on = visible[k];
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.97]",
                  on
                    ? "border-border bg-card text-foreground"
                    : "border-dashed border-border bg-transparent text-muted-foreground opacity-60",
                )}
                aria-pressed={on}
              >
                <span
                  className="size-2.5 rounded-full ring-2 ring-white shadow"
                  style={{ background: t.dot }}
                />
                {t.label}
                <span className="text-muted-foreground">({counts[k]})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">
        {/* Side list */}
        <div className="lg:w-80 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto bg-card/40 max-h-48 lg:max-h-none">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading jobs…
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No jobs match the selected statuses.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredJobs.map((j) => {
                const noCoords = unlocated.some((u) => u.id === j.id);
                const t = STATUS_THEME[statusKey(j.status)];
                return (
                  <li key={j.id}>
                    <button
                      onClick={() => focusJob(j)}
                      disabled={noCoords}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-accent/60 transition-colors",
                        selectedId === j.id && "bg-accent",
                        noCoords &&
                          "opacity-60 cursor-not-allowed hover:bg-transparent",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {noCoords ? (
                          <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                        ) : (
                          <span
                            className="size-3.5 rounded-full mt-1 shrink-0 ring-2 ring-white shadow"
                            style={{ background: t.dot }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate flex items-center gap-1">
                            <Building2 className="size-3.5 text-muted-foreground shrink-0" />
                            {j.company ?? "Job"}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {j.jobAddress ?? "No address"}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {j.status ?? "—"} · {fmtDate(j.startDate)} · {j.zone}
                            {noCoords ? " · not located" : ""}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 min-h-[360px]">
          <MapView
            className="w-full h-full"
            initialCenter={DEFAULT_CENTER}
            initialZoom={10}
            onMapReady={onMapReady}
          />
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
