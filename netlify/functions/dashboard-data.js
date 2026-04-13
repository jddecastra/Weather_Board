import { getAllAirportIds, getAllAirportConfigs } from "../../src/config/airports.js";
import { buildDashboardResponse } from "../../src/lib/buildResponse.js";

const AVIATION_WEATHER_BASE_URL = "https://aviationweather.gov/api/data";
const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

export async function handler() {
  try {
    const airportIds = getAllAirportIds();
    const airportConfigs = getAllAirportConfigs();
    const idsParam = airportIds.join(",");

    const [metarRecords, tafRecords] = await Promise.all([
      fetchMetarData(idsParam),
      fetchTafData(idsParam)
    ]);

    const metarAirportSet = new Set(
      metarRecords
        .map(getRecordAirportId)
        .filter(Boolean)
    );

    const tafAirportSet = new Set(
      tafRecords
        .map(getRecordAirportId)
        .filter(Boolean)
    );

    const fallbackCurrentTargets = airportConfigs.filter(
      airport => !metarAirportSet.has(airport.airportId)
    );

    const fallbackForecastTargets = airportConfigs.filter(
      airport => !tafAirportSet.has(airport.airportId)
    );

    const [fallbackCurrentRecords, fallbackForecastRecords] = await Promise.all([
      fetchFallbackCurrentRecords(fallbackCurrentTargets),
      fetchFallbackForecastRecords(fallbackForecastTargets)
    ]);

    const responseBody = buildDashboardResponse({
      metarRecords,
      tafRecords,
      fallbackCurrentRecords,
      fallbackForecastRecords,
      lastUpdatedUtc: new Date().toISOString()
    });

    return jsonResponse(200, responseBody);
  } catch (error) {
    console.error("dashboard-data error:", error);

    return jsonResponse(500, {
      error: "Failed to build dashboard data.",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchMetarData(idsParam) {
  const url = `${AVIATION_WEATHER_BASE_URL}/metar?ids=${encodeURIComponent(idsParam)}&format=json`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "WeatherBoard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`METAR request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchTafData(idsParam) {
  const url = `${AVIATION_WEATHER_BASE_URL}/taf?ids=${encodeURIComponent(idsParam)}&format=json`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "WeatherBoard/1.0"
    }
  });

  if (response.status === 204) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`TAF request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchFallbackCurrentRecords(airports) {
  const results = await Promise.all(
    airports.map(async airport => {
      try {
        const url = buildOpenMeteoUrl(airport, "current");
        const response = await fetch(url);

        if (!response.ok) return null;

        const data = await response.json();
        return mapOpenMeteoCurrentToFallbackRecord(airport, data);
      } catch (error) {
        console.error(`Fallback current fetch failed for ${airport.airportId}:`, error);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

async function fetchFallbackForecastRecords(airports) {
  const results = await Promise.all(
    airports.map(async airport => {
      try {
        const url = buildOpenMeteoUrl(airport, "forecast");
        const response = await fetch(url);

        if (!response.ok) return null;

        const data = await response.json();
        return mapOpenMeteoForecastToFallbackRecord(airport, data);
      } catch (error) {
        console.error(`Fallback forecast fetch failed for ${airport.airportId}:`, error);
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

function buildOpenMeteoUrl(airport, mode) {
  const baseParams = new URLSearchParams({
    latitude: String(airport.lat),
    longitude: String(airport.lon),
    timezone: "UTC",
    forecast_days: "1",
    wind_speed_unit: "kn",
    precipitation_unit: "inch",
    visibility_unit: "mi"
  });

  if (mode === "current") {
    baseParams.set(
      "current",
      [
        "temperature_2m",
        "wind_speed_10m",
        "visibility",
        "cloud_cover",
        "cloud_base",
        "weather_code"
      ].join(",")
    );
  } else {
    baseParams.set(
      "hourly",
      [
        "visibility",
        "cloud_cover",
        "cloud_base",
        "wind_speed_10m",
        "weather_code"
      ].join(",")
    );
  }

  return `${OPEN_METEO_BASE_URL}?${baseParams.toString()}`;
}

function mapOpenMeteoCurrentToFallbackRecord(airport, data) {
  const current = data?.current;
  if (!current) return null;

  const visibilitySm = normalizeNumber(current.visibility);
  const ceilingFt = normalizeFeet(current.cloud_base);
  const windKt = normalizeNumber(current.wind_speed_10m);

  const classification = classifyFlightCategory({ visibilitySm, ceilingFt });

  return {
    airportId: airport.airportId,
    category: classification.category,
    status: classification.status,
    reason: buildFallbackReason(classification, visibilitySm, ceilingFt),
    visibilitySm,
    ceilingFt,
    windKt,
    triggerType: classification.triggerType,
    rawText: `Derived from forecast model current conditions`,
    summary: `Derived current weather from non-aviation source`
  };
}

function mapOpenMeteoForecastToFallbackRecord(airport, data) {
  const hourly = data?.hourly;
  if (!hourly?.time?.length) return null;

  let worst = null;

  for (let i = 0; i < hourly.time.length; i += 1) {
    const visibilitySm = normalizeNumber(hourly.visibility?.[i]);
    const ceilingFt = normalizeFeet(hourly.cloud_base?.[i]);

    const classification = classifyFlightCategory({ visibilitySm, ceilingFt });

    const period = {
      fromUtc: hourly.time[i],
      toUtc: hourly.time[i + 1] || hourly.time[i],
      category: classification.category,
      status: classification.status,
      severityRank: classification.severityRank,
      triggerType: classification.triggerType,
      visibilitySm,
      ceilingFt
    };

    if (!worst || period.severityRank > worst.severityRank) {
      worst = period;
    }
  }

  if (!worst) return null;

  return {
    airportId: airport.airportId,
    category: worst.category,
    status: worst.status,
    reason: buildFallbackReason(worst, worst.visibilitySm, worst.ceilingFt),
    visibilitySm: worst.visibilitySm,
    ceilingFt: worst.ceilingFt,
    triggerType: worst.triggerType,
    validFrom: worst.fromUtc,
    validTo: worst.toUtc,
    rawText: `Derived from forecast model hourly conditions`,
    summary: `Derived forecast weather from non-aviation source`,
    evaluatedPeriods: [worst]
  };
}

function classifyFlightCategory({ visibilitySm, ceilingFt }) {
  if (visibilitySm !== null && visibilitySm < 1) {
    return { category: "LIFR", status: "purple", severityRank: 3, triggerType: "VISIBILITY" };
  }

  if (ceilingFt !== null && ceilingFt < 500) {
    return { category: "LIFR", status: "purple", severityRank: 3, triggerType: "CEILING" };
  }

  if (visibilitySm !== null && visibilitySm < 3) {
    return { category: "IFR", status: "red", severityRank: 2, triggerType: "VISIBILITY" };
  }

  if (ceilingFt !== null && ceilingFt < 1000) {
    return { category: "IFR", status: "red", severityRank: 2, triggerType: "CEILING" };
  }

  if (visibilitySm !== null && visibilitySm <= 5) {
    return { category: "MARGINAL", status: "blue", severityRank: 1, triggerType: "VISIBILITY" };
  }

  if (ceilingFt !== null && ceilingFt <= 3000) {
    return { category: "MARGINAL", status: "blue", severityRank: 1, triggerType: "CEILING" };
  }

  return { category: "VFR", status: "green", severityRank: 0, triggerType: "NONE" };
}

function buildFallbackReason(classification, visibilitySm, ceilingFt) {
  if (classification.triggerType === "VISIBILITY" && visibilitySm !== null) {
    return `Estimated by visibility ${visibilitySm} SM`;
  }

  if (classification.triggerType === "CEILING" && ceilingFt !== null) {
    return `Estimated by cloud base ${ceilingFt} ft`;
  }

  return "Estimated from non-aviation forecast data";
}

function getRecordAirportId(record) {
  const value =
    record?.icaoId ||
    record?.icao_id ||
    record?.stationId ||
    record?.station_id ||
    record?.airportId ||
    record?.id ||
    null;

  return typeof value === "string" ? value.trim().toUpperCase() : null;
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