export type WeatherErrorCode =
  | "needsLocation"
  | "forecast_unavailable"
  | "location_outside_us_fallback";

export function weatherErrorMessage(code: WeatherErrorCode): string {
  switch (code) {
    case "needsLocation":
      return "Choose a location to see the forecast.";
    case "location_outside_us_fallback":
      return "Forecast unavailable. US locations can use National Weather Service when Open-Meteo is down.";
    case "forecast_unavailable":
    default:
      return "Forecast unavailable right now. Try again in a moment.";
  }
}
