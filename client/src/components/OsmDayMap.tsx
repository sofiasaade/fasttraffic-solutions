import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DayMarker } from "@/components/DayViewMap";

/**
 * OpenStreetMap (Leaflet) fallback renderer for the Dashboard "Day map".
 * Used only when the Manus Google-Maps proxy is not configured (e.g. running
 * locally). Mirrors the Google renderer exactly: one pin per job id, split
 * pins for jobs that both start and get picked up the same day, the same
 * popup content, auto fit-bounds, and the same unlocated-jobs counter.
 */

const BUCKET_COLORS: Record<DayMarker["bucket"], { bg: string; border: string; label: string }> = {
  starting: { bg: "#ea580c", border: "#9a3412", label: "Starting today" },
  ongoing: { bg: "#2563eb", border: "#1e40af", label: "Ongoing (daily)" },
  pickup: { bg: "#16a34a", border: "#166534", label: "Pick up today" },
};

const DEFAULT_CENTER: [number, number] = [51.0447, -114.0719]; // Calgary

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function popupHtml(j: DayMarker, buckets: DayMarker["bucket"][]): string {
  const badges = buckets
    .map((b) => {
      const t = BUCKET_COLORS[b];
      return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${t.bg}1a;color:${t.bg};padding:2px 8px;border-radius:999px;margin-right:4px">${t.label}</span>`;
    })
    .join("");
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:240px">
    <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(j.company ?? "Job")}</div>
    <div style="font-size:12px;color:#475569;margin-bottom:6px">${escapeHtml(j.jobAddress ?? "")}</div>
    <div style="font-size:11px;color:#64748b">${escapeHtml(shortDate(j.startDate))} → ${escapeHtml(
      shortDate(j.endDate),
    )}${j.permitStartTime ? ` · ${escapeHtml(j.permitStartTime)}` : ""}</div>
    <div style="margin-top:6px">${badges}</div>
  </div>`;
}

function pinHtml(colors: string[], borderColor: string): string {
  const size = 26;
  let background: string;
  if (colors.length === 1) {
    background = colors[0];
  } else if (colors.length === 2) {
    background = `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
  } else {
    background = `conic-gradient(${colors[0]} 0 120deg, ${colors[1]} 120deg 240deg, ${colors[2]} 240deg 360deg)`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:${background};outline:1px solid ${borderColor}"></div>`;
}

export default function OsmDayMap({
  markers,
  onUnlocated,
}: {
  markers: DayMarker[];
  onUnlocated: (n: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 10,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // (Re)place markers whenever the filtered list changes — same grouping rules
  // as the Google renderer: collapse buckets per job id, split pin when a job
  // belongs to more than one bucket that day.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const grouped = new Map<string, { job: DayMarker; buckets: Set<DayMarker["bucket"]> }>();
    for (const j of markers) {
      const entry = grouped.get(j.id);
      if (entry) {
        entry.buckets.add(j.bucket);
        if (entry.job.bucket === "pickup" && j.bucket === "starting") entry.job = j;
      } else {
        grouped.set(j.id, { job: j, buckets: new Set([j.bucket]) });
      }
    }

    const bounds = L.latLngBounds([]);
    let placed = 0;
    let missing = 0;
    const order: DayMarker["bucket"][] = ["starting", "ongoing", "pickup"];

    for (const { job: j, buckets } of Array.from(grouped.values())) {
      if (typeof j.lat !== "number" || typeof j.lon !== "number") {
        missing++;
        continue;
      }
      const activeBuckets = order.filter((b) => buckets.has(b));
      const colors = activeBuckets.map((b) => BUCKET_COLORS[b].bg);
      const border = BUCKET_COLORS[activeBuckets[0] ?? j.bucket].border;
      const icon = L.divIcon({
        className: "",
        html: pinHtml(colors, border),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -14],
      });
      L.marker([j.lat, j.lon], { icon, title: j.company ?? "Job" })
        .bindPopup(popupHtml(j, activeBuckets))
        .addTo(layer);
      bounds.extend([j.lat, j.lon]);
      placed++;
    }

    if (placed > 0) {
      map.fitBounds(bounds, { padding: [30, 30] });
      if (placed === 1) map.setZoom(14);
    }
    onUnlocated(missing);
  }, [markers, onUnlocated]);

  return <div ref={containerRef} className="w-full h-full" />;
}
