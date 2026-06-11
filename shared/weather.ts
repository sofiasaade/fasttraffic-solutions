/**
 * Open-Meteo WMO weather-code mapping -> human label + a coarse condition
 * group used to pick an icon on the client. No API key required.
 * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
 */

export type WeatherGroup =
  | "clear"
  | "clouds"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export interface WeatherInfo {
  label: string;
  group: WeatherGroup;
}

export function describeWeatherCode(code: number): WeatherInfo {
  switch (code) {
    case 0:
      return { label: "Clear sky", group: "clear" };
    case 1:
      return { label: "Mainly clear", group: "clear" };
    case 2:
      return { label: "Partly cloudy", group: "clouds" };
    case 3:
      return { label: "Overcast", group: "clouds" };
    case 45:
    case 48:
      return { label: "Fog", group: "fog" };
    case 51:
    case 53:
    case 55:
      return { label: "Drizzle", group: "drizzle" };
    case 56:
    case 57:
      return { label: "Freezing drizzle", group: "drizzle" };
    case 61:
      return { label: "Light rain", group: "rain" };
    case 63:
      return { label: "Rain", group: "rain" };
    case 65:
      return { label: "Heavy rain", group: "rain" };
    case 66:
    case 67:
      return { label: "Freezing rain", group: "rain" };
    case 71:
      return { label: "Light snow", group: "snow" };
    case 73:
      return { label: "Snow", group: "snow" };
    case 75:
      return { label: "Heavy snow", group: "snow" };
    case 77:
      return { label: "Snow grains", group: "snow" };
    case 80:
    case 81:
    case 82:
      return { label: "Rain showers", group: "rain" };
    case 85:
    case 86:
      return { label: "Snow showers", group: "snow" };
    case 95:
      return { label: "Thunderstorm", group: "thunder" };
    case 96:
    case 99:
      return { label: "Thunderstorm w/ hail", group: "thunder" };
    default:
      return { label: "Unknown", group: "clouds" };
  }
}

/** Default operation location: Calgary, Alberta. */
export const DEFAULT_WEATHER_LOCATION = {
  name: "Calgary, AB",
  lat: 51.0447,
  lon: -114.0719,
};
