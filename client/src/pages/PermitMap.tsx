import { useRef, useState, useCallback, useEffect } from "react";
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
  subStatus: string | null;
  zone: string;
  lat: number | null;
  lon: number | null;
};

// Alberta-centered default view (Calgary).
const DEFAULT_CENTER = { lat: 51.0447, lng: -114.0719 };

export default function PermitMap() {
  const { data: jobs, isLoading } = trpc.coordinator.mapJobs.useQuery();
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [unlocated, setUnlocated] = useState<MapJob[]>([]);
  const [placedCount, setPlacedCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const infoHtml = (j: MapJob) =>
    `<div style="font-family:Inter,system-ui,sans-serif;max-width:240px">
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
      <div style="margin-top:6px;display:inline-block;font-size:10px;font-weight:600;background:#fff7ed;color:#c2410c;padding:2px 8px;border-radius:999px">Permit Approved${
        j.subStatus ? ` · ${escapeHtml(j.subStatus)}` : ""
      }</div>
    </div>`;

  const placeMarkers = useCallback(
    async (map: google.maps.Map, list: MapJob[]) => {
      const g = window.google;
      if (!g) return;

      // Ensure the marker library is loaded before creating AdvancedMarkers.
      const markerLib = (await g.maps.importLibrary(
        "marker",
      )) as google.maps.MarkerLibrary;
      const { AdvancedMarkerElement, PinElement } = markerLib;

      infoRef.current = new g.maps.InfoWindow();
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

        const pin = new PinElement({
          background: "#ea580c",
          borderColor: "#9a3412",
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
      setPlacedCount(placed);
    },
    [],
  );

  const onMapReady = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map;
      if (jobs && jobs.length) {
        placeMarkers(map, jobs as MapJob[]);
      }
    },
    [jobs, placeMarkers],
  );

  // If the jobs data arrives (or changes) after the map is already initialized,
  // (re)place the markers. Guards against the data/map load race condition.
  useEffect(() => {
    if (mapRef.current && jobs && jobs.length) {
      placeMarkers(mapRef.current, jobs as MapJob[]);
    }
  }, [jobs, placeMarkers]);

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

  return (
    <div className="flex flex-col h-[calc(100vh-0px)] md:h-screen">
      <div className="px-6 pt-6 pb-3 border-b border-border">
        <h1 className="text-2xl font-extrabold tracking-tight">Permit Map</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Jobs with status <span className="font-medium text-foreground">Permit Approved</span>, plotted by location.
          {!isLoading && jobs ? (
            <span className="ml-1">
              {placedCount} mapped
              {unlocated.length > 0 ? `, ${unlocated.length} without coordinates` : ""}.
            </span>
          ) : null}
        </p>
      </div>

      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">
        {/* Side list */}
        <div className="lg:w-80 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto bg-card/40 max-h-48 lg:max-h-none">
          {isLoading ? (
            <div className="flex items-center gap-2 p-6 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading permit jobs…
            </div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No jobs with status “Permit Approved”.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(jobs as MapJob[]).map((j) => {
                const noCoords = unlocated.some((u) => u.id === j.id);
                return (
                  <li key={j.id}>
                    <button
                      onClick={() => focusJob(j)}
                      disabled={noCoords}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-accent/60 transition-colors",
                        selectedId === j.id && "bg-accent",
                        noCoords && "opacity-60 cursor-not-allowed hover:bg-transparent",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {noCoords ? (
                          <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
                        ) : (
                          <MapPin className="size-4 text-primary mt-0.5 shrink-0" />
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
                            {fmtDate(j.startDate)} · {j.zone}
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
