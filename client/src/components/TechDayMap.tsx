import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Compact multi-pin map: all of the technician's jobs for today. */
export default function TechDayMap({
  points,
}: {
  points: { lat: number; lon: number; label: string }[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = L.map(ref.current, {
      center: [51.0447, -114.0719],
      zoom: 10,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    // Leaflet measures the container on init; when it mounts inside a
    // just-rendered flex/scroll layout the size can be 0 — re-measure.
    setTimeout(() => map.invalidateSize(), 150);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds([]);
    for (const p of points) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);background:oklch(0.69 0.2 41)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12],
      });
      L.marker([p.lat, p.lon], { icon }).bindPopup(p.label).addTo(layer);
      bounds.extend([p.lat, p.lon]);
    }
    if (points.length > 0) {
      map.fitBounds(bounds, { padding: [25, 25] });
      if (points.length === 1) map.setZoom(14);
    }
    return () => {
      layer.remove();
    };
  }, [points]);

  if (points.length === 0) return null;
  return (
    <div
      ref={ref}
      className="w-full h-40 rounded-xl overflow-hidden border border-border mb-4"
    />
  );
}
