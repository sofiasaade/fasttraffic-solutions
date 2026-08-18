import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { MapView } from "@/components/Map";
import OsmPermitMap, {
  type OsmPermitMapHandle,
} from "@/components/OsmPermitMap";
import { trpc } from "@/lib/trpc";
import { fmtDate, fmtTimeRange } from "@/lib/format";
import { Loader2, MapPin, AlertTriangle, Building2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// When the Manus Google-Maps proxy is not configured (e.g. running locally),
// fall back to a free OpenStreetMap renderer with identical pins/popups.
const USE_OSM_FALLBACK = !import.meta.env.VITE_FRONTEND_FORGE_API_KEY;

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
  const osmRef = useRef<OsmPermitMapHandle | null>(null);
  const [unlocated, setUnlocated] = useState<MapJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Free-text project search (client / address / city). Filters both the
  // side list and the map markers so the two stay in sync.
  const [search, setSearch] = useState("");
  // Date filter: show only jobs whose window covers this date ("" = all).
  const [onDate, setOnDate] = useState("");
  // "What job was here?" locator: geocode ANY address, drop a reference pin
  // and list the nearest jobs (any status, last 18 months).
  const [locQuery, setLocQuery] = useState("");
  const [refPoint, setRefPoint] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const refMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const nearbyQ = trpc.coordinator.nearbyJobs.useQuery(
    { lat: refPoint?.lat ?? 0, lon: refPoint?.lng ?? 0 },
    { enabled: !!refPoint },
  );

  const dropRefPin = async (point: { lat: number; lng: number; label: string }) => {
    setRefPoint(point);
    if (USE_OSM_FALLBACK) {
      osmRef.current?.setRefPin(point.lat, point.lng, point.label);
      return;
    }
    const g = window.google;
    const map = mapRef.current;
    if (!g || !map) return;
    const markerLib = (await g.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
    const { AdvancedMarkerElement, PinElement } = markerLib;
    if (refMarkerRef.current) refMarkerRef.current.map = null;
    const pin = new PinElement({
      background: "#9333ea",
      borderColor: "#6b21a8",
      glyphColor: "#fff",
      scale: 1.4,
    });
    refMarkerRef.current = new AdvancedMarkerElement({
      map,
      position: point,
      content: pin.element,
      title: point.label,
      zIndex: 9999,
    });
    map.panTo(point);
    map.setZoom(15);
  };

  const locateAddress = async () => {
    const q = locQuery.trim();
    if (!q) return;
    if (!USE_OSM_FALLBACK && window.google && mapRef.current) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode(
        { address: `${q}, Calgary, Alberta, Canada` },
        (results, status) => {
          if (status !== "OK" || !results?.[0]) {
            alert("Address not found — try adding the quadrant (NW/SW/NE/SE).");
            return;
          }
          const loc = results[0].geometry.location;
          void dropRefPin({ lat: loc.lat(), lng: loc.lng(), label: results[0].formatted_address });
        },
      );
      return;
    }
    // OSM mode: free Nominatim geocoding, biased to the Calgary area.
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(`${q}, Calgary, Alberta`)}`,
      );
      const hits = await r.json();
      if (!hits?.[0]) {
        alert("Address not found — try adding the quadrant (NW/SW/NE/SE).");
        return;
      }
      void dropRefPin({
        lat: Number(hits[0].lat),
        lng: Number(hits[0].lon),
        label: hits[0].display_name.split(",").slice(0, 3).join(","),
      });
    } catch {
      alert("Geocoding failed — check the connection.");
    }
  };
  const clearLocator = () => {
    setRefPoint(null);
    setLocQuery("");
    if (refMarkerRef.current) {
      refMarkerRef.current.map = null;
      refMarkerRef.current = null;
    }
    osmRef.current?.clearRefPin();
  };

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

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ((jobs as MapJob[] | undefined) ?? []).filter((j) => {
      if (!visible[statusKey(j.status)]) return false;
      if (onDate) {
        const s = (j.startDate ?? "").slice(0, 10);
        const e = (j.endDate ?? "").slice(0, 10) || s;
        if (!s || !(s <= onDate && onDate <= e)) return false;
      }
      if (!q) return true;
      return `${j.company ?? ""} ${j.jobAddress ?? ""} ${j.municipality ?? ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [jobs, visible, search, onDate]);

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
    if (USE_OSM_FALLBACK) {
      osmRef.current?.focus(j.id);
      setSelectedId(j.id);
      return;
    }
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
          {/* Project search: filters the list and the map markers together. */}
          <div className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm p-2.5">
            <div className="relative">
              <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects on map…"
                className="pl-8 h-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {/* Date filter: only jobs active ON this date */}
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                type="date"
                value={onDate}
                onChange={(e) => setOnDate(e.target.value)}
                className="h-8 text-xs flex-1"
                title="Show only jobs active on this date"
              />
              <button
                type="button"
                onClick={() => {
                  const d = new Date();
                  setOnDate(
                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                  );
                }}
                className="h-8 rounded-md border border-border px-2 text-xs font-medium hover:bg-accent"
              >
                Today
              </button>
              {onDate && (
                <button
                  type="button"
                  onClick={() => setOnDate("")}
                  aria-label="Clear date filter"
                  className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {/* "What job was here?" — locate ANY address and list nearby jobs */}
            <div className="mt-2 flex items-center gap-1.5">
              <Input
                value={locQuery}
                onChange={(e) => setLocQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && locateAddress()}
                placeholder="Locate any address (abandoned signs…)"
                className="h-8 text-xs flex-1"
              />
              <button
                type="button"
                onClick={locateAddress}
                className="h-8 rounded-md bg-purple-600 px-2.5 text-xs font-semibold text-white hover:bg-purple-700"
                title="Drop a pin at this address and list nearby jobs"
              >
                📍
              </button>
              {refPoint && (
                <button
                  type="button"
                  onClick={clearLocator}
                  className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent"
                  aria-label="Clear located address"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            {refPoint && (
              <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50/60 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-purple-800 mb-1">
                  Jobs near 📍 {refPoint.label.slice(0, 46)}
                </div>
                {nearbyQ.isLoading ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-1">
                    <Loader2 className="size-3 animate-spin" /> Searching 18 months of jobs…
                  </div>
                ) : (nearbyQ.data?.length ?? 0) === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No jobs found nearby.</div>
                ) : (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {nearbyQ.data!.map((j) => (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => {
                          if (typeof j.lat === "number" && typeof j.lon === "number") {
                            if (USE_OSM_FALLBACK) osmRef.current?.setRefPin(j.lat, j.lon, j.company ?? "job");
                            else {
                              mapRef.current?.panTo({ lat: j.lat, lng: j.lon });
                              mapRef.current?.setZoom(16);
                            }
                          }
                        }}
                        className="w-full text-left rounded-md bg-card border border-border px-2 py-1.5 hover:border-purple-300 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold truncate">{j.company ?? "—"}</span>
                          <span className="shrink-0 text-[10px] font-bold tabular-nums text-purple-700">
                            {j.distanceM < 1000 ? `${j.distanceM} m` : `${(j.distanceM / 1000).toFixed(1)} km`}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">{j.jobAddress ?? ""}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {fmtDate(j.startDate)} → {fmtDate(j.endDate)} · <span className="font-medium">{j.status ?? "—"}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading jobs…
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {search.trim()
                ? `No jobs match “${search.trim()}”.`
                : "No jobs match the selected statuses."}
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
                            <a
                              href={`/projects/${j.id}`}
                              onClick={(e) => e.stopPropagation()}
                              title="Open full project details (info, crew, plans)"
                              className="ml-1 shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-primary underline decoration-dotted"
                            >
                              details
                            </a>
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
          {USE_OSM_FALLBACK ? (
            <OsmPermitMap
              ref={osmRef}
              jobs={filteredJobs}
              themeFor={(j) => STATUS_THEME[statusKey(j.status)]}
              popupHtml={infoHtml}
              onSelect={setSelectedId}
              onUnlocated={setUnlocated}
            />
          ) : (
            <MapView
              className="w-full h-full"
              initialCenter={DEFAULT_CENTER}
              initialZoom={10}
              onMapReady={onMapReady}
            />
          )}
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
