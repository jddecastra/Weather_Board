import { getAllAirportIds, getAllAirportConfigs } from "../../src/config/airports.js";
import { buildDashboardResponse } from "../../src/lib/buildResponse.js";
import { fetchMarineFogAlerts } from "../../src/lib/marineFog.js";

const AVIATION_WEATHER_BASE_URL = "https://aviationweather.gov/api/data";
const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

export async function handler() {
  try {
    const airportIds = getAllAirportIds();
    const airportConfigs = getAllAirportConfigs();
    const idsParam = airportIds.join(",");

    const [metarRecords, tafRecords, marineFogAlerts] = await Promise.all([
      fetchMetarData(idsParam),
      fetchTafData(idsParam),
      fetchMarineFogAlerts()
    ]);

    const metarAirportSet = new Set(
      metarRecords.map(getRecordAirportId).filter(Boolean)
    );

    const tafAirportSet = new Set(
      tafRecords.map(getRecordAirportId).filter(Boolean)
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

    responseBody.alerts = mergeAlerts(responseBody.alerts || [], marineFogAlerts || []);

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
    visibility_unit: "mi"
  });

  const commonFields = [
    "visibility",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "wind_speed_10m",
    "weather_code"
  ].join(",");

  if (mode === "current") {
    baseParams.set("current", commonFields);
  } else {
    baseParams.set("hourly", commonFields);
  }

  return `${OPEN_METEO_BASE_URL}?${baseParams.toString()}`;
}

function mapOpenMeteoCurrentToFallbackRecord(airport, data) {
  const current = data?.current;
  if (!current) return null;

  const visibilitySm = normalizeNumber(current.visibility);
  const lowCloudCover = normalizeNumber(current.cloud_cover_low);
  const midCloudCover = normalizeNumber(current.cloud_cover_mid);
  const highCloudCover = normalizeNumber(current.cloud_cover_high);
  const totalCloudCover = normalizeNumber(current.cloud_cover);
  const windKt = normalizeNumber(current.wind_speed_10m);

  const classification = classifyFallbackCategory({
    visibilitySm,
    ceilingFt: null,
    lowCloudCover
  });

  return {
    airportId: airport.airportId,
    category: classification.category,
    status: classification.status,
    reason: buildFallbackReason({
      classification,
      visibilitySm,
      ceilingFt: null,
      lowCloudCover
    }),
    visibilitySm,
    ceilingFt: null,
    windKt,
    triggerType: classification.triggerType,
    rawText: "Derived from forecast model current conditions",
    summary: "Derived current weather from non-aviation source",
    rawSource: {
      provider: "Open-Meteo",
      mode: "current",
      airportLat: airport.lat,
      airportLon: airport.lon,
      current
    },
    debugFlags: {
      lowCloudCover,
      midCloudCover,
      highCloudCover,
      totalCloudCover,
      ceilingHeuristicTriggered: classification.ceilingHeuristicTriggered
    }
  };
}

function mapOpenMeteoForecastToFallbackRecord(airport, data) {
  const hourly = data?.hourly;
  if (!hourly?.time?.length) return null;

  let worst = null;
  const evaluatedPeriods = [];

  for (let i = 0; i < hourly.time.length; i += 1) {
    const visibilitySm = normalizeNumber(hourly.visibility?.[i]);
    const lowCloudCover = normalizeNumber(hourly.cloud_cover_low?.[i]);
    const midCloudCover = normalizeNumber(hourly.cloud_cover_mid?.[i]);
    const highCloudCover = normalizeNumber(hourly.cloud_cover_high?.[i]);
    const totalCloudCover = normalizeNumber(hourly.cloud_cover?.[i]);
    const windKt = normalizeNumber(hourly.wind_speed_10m?.[i]);
    const weatherCode = hourly.weather_code?.[i] ?? null;

    const classification = classifyFallbackCategory({
      visibilitySm,
      ceilingFt: null,
      lowCloudCover
    });

    const period = {
      fromUtc: hourly.time[i],
      toUtc: hourly.time[i + 1] || hourly.time[i],
      category: classification.category,
      status: classification.status,
      severityRank: classification.severityRank,
      triggerType: classification.triggerType,
      visibilitySm,
      ceilingFt: null,
      windKt,
      weatherCode,
      lowCloudCover,
      midCloudCover,
      highCloudCover,
      totalCloudCover,
      ceilingHeuristicTriggered: classification.ceilingHeuristicTriggered
    };

    evaluatedPeriods.push(period);

    if (!worst || period.severityRank > worst.severityRank) {
      worst = period;
    }
  }

  if (!worst) return null;

  return {
    airportId: airport.airportId,
    category: worst.category,
    status: worst.status,
    reason: buildFallbackReason({
      classification: worst,
      visibilitySm: worst.visibilitySm,
      ceilingFt: null,
      lowCloudCover: worst.lowCloudCover
    }),
    visibilitySm: worst.visibilitySm,
    ceilingFt: null,
    triggerType: worst.triggerType,
    validFrom: worst.fromUtc,
    validTo: worst.toUtc,
    rawText: "Derived from forecast model hourly conditions",
    summary: "Derived forecast weather from non-aviation source",
    evaluatedPeriods,
    rawSource: {
      provider: "Open-Meteo",
      mode: "forecast",
      airportLat: airport.lat,
      airportLon: airport.lon,
      hourly
    },
    debugFlags: {
      lowCloudCover: worst.lowCloudCover,
      midCloudCover: worst.midCloudCover,
      highCloudCover: worst.highCloudCover,
      totalCloudCover: worst.totalCloudCover,
      ceilingHeuristicTriggered: worst.ceilingHeuristicTriggered
    }
  };
}

function classifyFallbackCategory({ visibilitySm, ceilingFt, lowCloudCover }) {
  if (visibilitySm !== null && visibilitySm < 1) {
    return {
      category: "LIFR",
      status: "purple",
      severityRank: 3,
      triggerType: "VISIBILITY",
      ceilingHeuristicTriggered: false
    };
  }

  if (ceilingFt !== null && ceilingFt < 500) {
    return {
      category: "LIFR",
      status: "purple",
      severityRank: 3,
      triggerType: "CEILING",
      ceilingHeuristicTriggered: false
    };
  }

  if (visibilitySm !== null && visibilitySm < 3) {
    return {
      category: "IFR",
      status: "red",
      severityRank: 2,
      triggerType: "VISIBILITY",
      ceilingHeuristicTriggered: false
    };
  }

  if (ceilingFt !== null && ceilingFt < 1000) {
    return {
      category: "IFR",
      status: "red",
      severityRank: 2,
      triggerType: "CEILING",
      ceilingHeuristicTriggered: false
    };
  }

  if (ceilingFt === null && lowCloudCover !== null && lowCloudCover >= 85) {
    return {
      category: "IFR",
      status: "red",
      severityRank: 2,
      triggerType: "LOW_CLOUD_HEURISTIC",
      ceilingHeuristicTriggered: true
    };
  }

  if (visibilitySm !== null && visibilitySm <= 5) {
    return {
      category: "MARGINAL",
      status: "blue",
      severityRank: 1,
      triggerType: "VISIBILITY",
      ceilingHeuristicTriggered: false
    };
  }

  if (ceilingFt !== null && ceilingFt <= 3000) {
    return {
      category: "MARGINAL",
      status: "blue",
      severityRank: 1,
      triggerType: "CEILING",
      ceilingHeuristicTriggered: false
    };
  }

  return {
    category: "VFR",
    status: "green",
    severityRank: 0,
    triggerType: "NONE",
    ceilingHeuristicTriggered: false
  };
}

function buildFallbackReason({ classification, visibilitySm, ceilingFt, lowCloudCover }) {
  if (classification.triggerType === "VISIBILITY" && visibilitySm !== null) {
    return `Estimated by visibility ${visibilitySm} SM`;
  }

  if (classification.triggerType === "CEILING" && ceilingFt !== null) {
    return `Estimated by cloud base ${ceilingFt} ft`;
  }

  if (classification.triggerType === "LOW_CLOUD_HEURISTIC" && lowCloudCover !== null) {
    return `Estimated IFR due to high low-cloud coverage (${lowCloudCover}%) - investigate official weather`;
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

function mergeAlerts(existingAlerts, marineAlerts) {
  const merged = [...existingAlerts, ...marineAlerts];

  merged.sort((a, b) => {
    if ((b.severityRank ?? -1) !== (a.severityRank ?? -1)) {
      return (b.severityRank ?? -1) - (a.severityRank ?? -1);
    }

    if ((a.airportId || "") !== (b.airportId || "")) {
      return String(a.airportId || "").localeCompare(String(b.airportId || ""));
    }

    return String(a.source || "").localeCompare(String(b.source || ""));
  });

  return merged.map((alert, index) => ({
    ...alert,
    sortOrder: index + 1
  }));
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