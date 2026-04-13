import { getAllAirportIds } from "../../src/config/airports.js";
import { buildDashboardResponse } from "../../src/lib/buildResponse.js";

const AVIATION_WEATHER_BASE_URL = "https://aviationweather.gov/api/data";

export async function handler() {
  try {
    const airportIds = getAllAirportIds();
    const idsParam = airportIds.join(",");

    const [metarRecords, tafRecords] = await Promise.all([
      fetchMetarData(idsParam),
      fetchTafData(idsParam)
    ]);

    const responseBody = buildDashboardResponse({
      metarRecords,
      tafRecords,
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