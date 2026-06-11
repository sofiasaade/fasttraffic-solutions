import { trpc } from "@/lib/trpc";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Sun,
  Wind,
  Loader2,
} from "lucide-react";

/** Pick an icon for a coarse weather group. */
function WeatherIcon({ group, className }: { group: string; className?: string }) {
  switch (group) {
    case "clear":
      return <Sun className={className} />;
    case "fog":
      return <CloudFog className={className} />;
    case "drizzle":
      return <CloudDrizzle className={className} />;
    case "rain":
      return <CloudRain className={className} />;
    case "snow":
      return <CloudSnow className={className} />;
    case "thunder":
      return <CloudLightning className={className} />;
    case "clouds":
    default:
      return <Cloud className={className} />;
  }
}

/**
 * "Today" weather card for the operation location (Calgary by default).
 * Sourced from Open-Meteo via the server (no API key).
 */
export default function WeatherCard() {
  const { data, isLoading } = trpc.coordinator.currentWeather.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000, // refresh every 10 min
    staleTime: 9 * 60 * 1000,
  });

  return (
    <div className="rounded-2xl bg-gradient-to-br from-sky-600 to-blue-700 text-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-white/70">
            Today
          </div>
          <div className="text-sm font-medium text-white/90 mt-0.5">
            {data?.locationName ?? "Calgary, AB"}
          </div>
        </div>
        {isLoading ? (
          <Loader2 className="size-9 animate-spin text-white/80" />
        ) : (
          <WeatherIcon group={data?.group ?? "clouds"} className="size-12 text-white/90" />
        )}
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="text-5xl font-extrabold leading-none">
          {isLoading
            ? "—"
            : data?.temperatureC != null
            ? `${Math.round(data.temperatureC)}°`
            : "—"}
          <span className="text-2xl align-top">C</span>
        </div>
        <div className="pb-1">
          <div className="text-base font-semibold">
            {isLoading ? "Loading…" : data?.label ?? "Unavailable"}
          </div>
          {data?.windKph != null && (
            <div className="flex items-center gap-1 text-xs text-white/80 mt-0.5">
              <Wind className="size-3.5" />
              {Math.round(data.windKph)} km/h wind
            </div>
          )}
        </div>
      </div>

      {data && !data.ok && (
        <div className="mt-3 text-xs text-white/70">
          Weather service is temporarily unavailable.
        </div>
      )}
    </div>
  );
}
