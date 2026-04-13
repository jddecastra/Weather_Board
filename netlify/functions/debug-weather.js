const { getAllAirportConfigs } = require("../../src/config/airports.js");

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

exports.handler = async function () {
  try {
    const airports = getAllAirportConfigs();

    const results = await Promise.all(
      airports.map(async airport => {
        const current = await fetchCurrent(airport);
        const forecast = await fetchForecast(airport);

        return {
          airportId: airport.airportId,
          lat: airport.lat,
          lon: airport.lon,
          current,
          forecast
        };
      })
    );

    return jsonResponse(200, results);
  } catch (error) {
    console.error("debug-weather error:", error);

    return jsonResponse(500, {
      error: "Debug weather failed",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
};

async function fetchCurrent(airport) {
  const url = buildUrl(airport, "current");

  const res = await fetch(url);
  if (!res.ok) {
    return {
      error: `Current fetch failed: ${res.status} ${res.statusText}`
    };
  }

  const data = await res.json();

  return {
    raw: data.current || null,
    interpreted: interpretCurrent(data.current || null)
  };
}

async function fetchForecast(airport) {
  const url = buildUrl(airport, "forecast");

  const res = await fetch(url);
  if (!res.ok) {
    return {
      error: `Forecast fetch failed: ${res.status} ${res.statusText}`
    };
  }

  const data = await res.json();

  return {
    raw: data.hourly || null,
    interpreted: interpretForecast(data.hourly || null)
  };
}

function buildUrl(airport, mode) {
  const params = new URLSearchParams({
    latitude: String(airport.lat),
    longitude: String(airport.lon),
    timezone: "UTC",
    forecast_days: "1",
    wind_speed_unit: "kn",
    visibility_unit: "mi"
  });

  if (mode === "current") {
    params.set(
      "current",
      "visibility,cloud_base,wind_speed_10m,weather_code"
    );
  } else {
    params.set(
      "hourly",
      "visibility,cloud_base,wind_speed_10m,weather_code"
    );
  }

  return `${OPEN_METEO_BASE_URL}?${params.toString()}`;
}

function interpretCurrent(current) {
  if (!current) return null;

  const visibility = normalizeNumber(current.visibility);
  const ceiling = normalizeFeet(current.cloud_base);

  return {
    visibilitySm: visibility,
    ceilingFt: ceiling,
    classification: classify(visibility, ceiling),
    weatherCode: current.weather_code ?? null,
    windKt: normalizeNumber(current.wind_speed_10m)
  };
}

function interpretForecast(hourly) {
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    return null;
  }

  return hourly.time.map((time, i) => {
    const visibility = normalizeNumber(hourly.visibility?.[i]);
    const ceiling = normalizeFeet(hourly.cloud_base?.[i]);

    return {
      time,
      visibilitySm: visibility,
      ceilingFt: ceiling,
      windKt: normalizeNumber(hourly.wind_speed_10m?.[i]),
      weatherCode: hourly.weather_code?.[i] ?? null,
      classification: classify(visibility, ceiling)
    };
  });
}

function classify(visibility, ceiling) {
  if (visibility !== null && visibility < 1) return "LIFR";
  if (ceiling !== null && ceiling < 500) return "LIFR";

  if (visibility !== null && visibility < 3) return "IFR";
  if (ceiling !== null && ceiling < 1000) return "IFR";

  if (visibility !== null && visibility <= 5) return "MARGINAL";
  if (ceiling !== null && ceiling <= 3000) return "MARGINAL";

  return "VFR";
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeet(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 3.28084);
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}