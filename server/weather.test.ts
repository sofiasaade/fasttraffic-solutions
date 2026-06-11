import { describe, it, expect } from "vitest";
import { describeWeatherCode, DEFAULT_WEATHER_LOCATION } from "../shared/weather";

describe("describeWeatherCode", () => {
  it("maps clear sky", () => {
    expect(describeWeatherCode(0)).toEqual({ label: "Clear sky", group: "clear" });
  });

  it("maps overcast to clouds group", () => {
    expect(describeWeatherCode(3).group).toBe("clouds");
  });

  it("maps fog codes", () => {
    expect(describeWeatherCode(45).group).toBe("fog");
    expect(describeWeatherCode(48).group).toBe("fog");
  });

  it("maps rain codes", () => {
    expect(describeWeatherCode(61).group).toBe("rain");
    expect(describeWeatherCode(80).group).toBe("rain");
  });

  it("maps snow codes", () => {
    expect(describeWeatherCode(71).group).toBe("snow");
    expect(describeWeatherCode(86).group).toBe("snow");
  });

  it("maps thunderstorm codes", () => {
    expect(describeWeatherCode(95).group).toBe("thunder");
    expect(describeWeatherCode(99).group).toBe("thunder");
  });

  it("falls back to clouds for unknown codes", () => {
    expect(describeWeatherCode(123).group).toBe("clouds");
    expect(describeWeatherCode(123).label).toBe("Unknown");
  });

  it("has a Calgary default location", () => {
    expect(DEFAULT_WEATHER_LOCATION.name).toContain("Calgary");
    expect(Math.round(DEFAULT_WEATHER_LOCATION.lat)).toBe(51);
  });
});
