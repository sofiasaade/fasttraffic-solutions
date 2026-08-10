import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Small Leaflet map for the Clients screen: one pin per project of the
 * selected client, colored by the MASTER Airtable status. Popups link to the
 * project detail page.
 */

export type ClientMapJob = {
  id: string;
  jobAddress: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  lat: number | null;
  lon: number | null;
};

const DEFAULT_CENTER: [number, number] = [51.0447, -114.0719]; // Calgary

function statusColor(status: string | null): { bg: string; border: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "field") return { bg: "#16a34a", border: "#166534" };
  if (s.includes("approved")) return { bg: "#ea580c", border: "#9a3412" };
  if (s.includes("submitted")) return { bg: "#2563eb", border: "#1e40af" };
  if (s.includes("ready to bill")) return { bg: "#9333ea", border: "#6b21a8" };
  if (s.includes("picked up")) return { bg: "#e11d48", border: "#9f1239" };
  return { bg: "#64748b", border: "#334155" };
}

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

export default function ClientJobsMap({ jobs }: { jobs: ClientMapJob[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 10,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const located = jobs.filter(
      (j) => typeof j.lat === "number" && typeof j.lon === "number",
    );
    const bounds: [number, number][] = [];
    for (const j of located) {
      const c = statusColor(j.status);
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${c.bg};border:2.5px solid ${c.border};box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      const m = L.marker([j.lat as number, j.lon as number], { icon }).addTo(layer);
      m.bindPopup(
        `<div style="font-size:12px;min-width:180px">
          <div style="font-weight:700;margin-bottom:2px">${escapeHtml(j.jobAddress ?? "No address")}</div>
          <div style="color:#64748b;font-size:11px">${escapeHtml(shortDate(j.startDate))} → ${escapeHtml(shortDate(j.endDate))}</div>
          <div style="margin-top:4px"><span style="background:${c.bg};color:#fff;border-radius:99px;padding:2px 8px;font-size:10px;font-weight:700">${escapeHtml(j.status ?? "—")}</span></div>
          <div style="margin-top:6px"><a href="/projects/${j.id}" style="color:#2563eb;font-weight:600">Open project →</a></div>
        </div>`,
      );
      bounds.push([j.lat as number, j.lon as number]);
    }
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
    }
    // Leaflet needs a nudge when the container was just expanded into view.
    setTimeout(() => map.invalidateSize(), 60);
  }, [jobs]);

  const unlocated = jobs.filter(
    (j) => typeof j.lat !== "number" || typeof j.lon !== "number",
  ).length;

  return (
    <div className="relative">
      <div ref={containerRef} className="h-72 w-full z-0" />
      {unlocated > 0 && (
        <div className="absolute bottom-2 left-2 z-[500] rounded-md bg-card/90 border border-border px-2 py-1 text-[10px] text-muted-foreground">
          {unlocated} project{unlocated === 1 ? "" : "s"} without map location
        </div>
      )}
    </div>
  );
}
