import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * A small, read-only OpenStreetMap showing a single job's location. Used on the
 * technician Job Detail so field crews can see WHERE the project is. No API key
 * needed. Renders nothing when the job has no coordinates.
 */
export default function MiniJobMap({
  lat,
  lon,
  label,
}: {
  lat: number;
  lon: number;
  label?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [lat, lon],
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:oklch(0.69 0.2 41)"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([lat, lon], { icon }).addTo(map);
    if (label) marker.bindPopup(label);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, label]);

  return (
    <div
      ref={containerRef}
      className="w-full h-44 rounded-xl overflow-hidden border border-border"
    />
  );
}
