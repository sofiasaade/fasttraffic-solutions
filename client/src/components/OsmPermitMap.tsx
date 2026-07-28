import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * OpenStreetMap (Leaflet) fallback renderer for the Permit Map page. Used only
 * when the Manus Google-Maps proxy is not configured (e.g. running locally).
 * Mirrors the Google renderer: status-colored pins, the same popup content,
 * click-to-select, auto fit-bounds, and list-click focus (pan + open popup).
 *
 * Jobs without lat/lon are reported via onUnlocated (the Google path geocodes
 * them by address; without the proxy we surface them in the "not located"
 * list instead).
 */

export type OsmPermitJob = {
  id: string;
  company: string | null;
  jobAddress: string | null;
  lat: number | null;
  lon: number | null;
};

export type OsmPermitMapHandle = {
  /** Pan/zoom to a job's pin and open its popup (list-click focus). */
  focus: (jobId: string) => void;
};

const DEFAULT_CENTER: [number, number] = [51.0447, -114.0719]; // Calgary

function pinHtml(bg: string, _border: string): string {
  // Google-style teardrop pin with a white dot — crisper than a flat circle.
  return `<div style="position:relative;width:26px;height:36px;filter:drop-shadow(0 3px 3px rgba(0,0,0,0.35))">
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 23 13 23s13-13.8 13-23C26 5.8 20.2 0 13 0z" fill="${bg}"/>
      <circle cx="13" cy="13" r="5" fill="#fff"/>
    </svg>
  </div>`;
}

type Props<J extends OsmPermitJob> = {
  jobs: J[];
  /** Status theme colors for a job's pin. */
  themeFor: (job: J) => { bg: string; border: string };
  /** Popup HTML — same builder as the Google renderer. */
  popupHtml: (job: J) => string;
  onSelect: (jobId: string) => void;
  onUnlocated: (jobs: J[]) => void;
};

function OsmPermitMapInner<J extends OsmPermitJob>(
  { jobs, themeFor, popupHtml, onSelect, onUnlocated }: Props<J>,
  ref: React.Ref<OsmPermitMapHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersById = useRef<Map<string, L.Marker>>(new Map());
  // Keep the latest callbacks in refs so the marker effect depends ONLY on
  // `jobs` — parent components may recreate these functions every render.
  const cbRef = useRef({ themeFor, popupHtml, onSelect, onUnlocated });
  cbRef.current = { themeFor, popupHtml, onSelect, onUnlocated };

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
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      markersById.current.clear();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersById.current.clear();

    const bounds = L.latLngBounds([]);
    const missing: J[] = [];
    let placed = 0;

    for (const j of jobs) {
      if (typeof j.lat !== "number" || typeof j.lon !== "number") {
        missing.push(j);
        continue;
      }
      const t = cbRef.current.themeFor(j);
      const icon = L.divIcon({
        className: "",
        html: pinHtml(t.bg, t.border),
        iconSize: [26, 36],
        iconAnchor: [13, 36],
        popupAnchor: [0, -34],
      });
      const marker = L.marker([j.lat, j.lon], {
        icon,
        title: j.company ?? "Job",
      })
        .bindPopup(cbRef.current.popupHtml(j))
        .on("click", () => cbRef.current.onSelect(j.id))
        .addTo(layer);
      markersById.current.set(j.id, marker);
      bounds.extend([j.lat, j.lon]);
      placed++;
    }

    if (placed > 0) {
      map.fitBounds(bounds, { padding: [30, 30] });
      if (placed === 1) map.setZoom(14);
    }
    cbRef.current.onUnlocated(missing);
  }, [jobs]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (jobId: string) => {
        const map = mapRef.current;
        const marker = markersById.current.get(jobId);
        if (!map || !marker) return;
        map.setView(marker.getLatLng(), 15);
        marker.openPopup();
      },
    }),
    [],
  );

  return <div ref={containerRef} className="w-full h-full" />;
}

const OsmPermitMap = forwardRef(OsmPermitMapInner) as <J extends OsmPermitJob>(
  props: Props<J> & { ref?: React.Ref<OsmPermitMapHandle> },
) => React.ReactElement;

export default OsmPermitMap;
