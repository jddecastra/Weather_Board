import { REGIONS } from "../config/airports.js";
import { buildMetarObject, buildMetarExpandedDetail, buildNoMetarObject } from "./metar.js";
import { buildTafObject, buildTafExpandedDetail, buildNoTafObject } from "./taf.js";

export function buildDashboardResponse({
  metarRecords = [],
  tafRecords = [],
  fallbackCurrentRecords = [],
  fallbackForecastRecords = [],
  lastUpdatedUtc = new Date().toISOString()
}) {
  const metarMap = indexRecordsByAirportId(metarRecords, getMetarAirportId);
  const tafMap = indexRecordsByAirportId(tafRecords, getTafAirportId);
  const fallbackCurrentMap = indexRecordsByAirportId(
    fallbackCurrentRecords,
    getFallbackAirportId
  );
  const fallbackForecastMap = indexRecordsByAirportId(
    fallbackForecastRecords,
    getFallbackAirportId
  );

  const regionResults = REGIONS.map(region => {
    const airportResults = region.airports.map(airportConfig => {
      const airportId = airportConfig.airportId;

      let metarObj;
      if (metarMap.has(airportId)) {
        metarObj = applySourceSafetyMetadata(
          buildMetarObject(metarMap.get(airportId)),
          "METAR"
        );
      } else if (fallbackCurrentMap.has(airportId)) {
        metarObj = applySourceSafetyMetadata(
          buildFallbackCurrentObject(fallbackCurrentMap.get(airportId)),
          "FORECAST_CURRENT"
        );
      } else {
        metarObj = applySourceSafetyMetadata(buildNoMetarObject(), "NO_METAR");
      }

      let tafObj;
      if (tafMap.has(airportId)) {
        tafObj = applySourceSafetyMetadata(
          buildTafObject(tafMap.get(airportId)),
          "TAF"
        );
      } else if (fallbackForecastMap.has(airportId)) {
        tafObj = applySourceSafetyMetadata(
          buildFallbackForecastObject(fallbackForecastMap.get(airportId)),
          "FORECAST"
        );
      } else {
        tafObj = applySourceSafetyMetadata(buildNoTafObject(), "NO_TAF");
      }

      // Only show expanded rows for OFFICIAL aviation alerts
      const expandedDetails = [];

      const metarDetail =
        metarObj?.isOfficial && metarObj?.sourceType === "METAR"
          ? buildMetarExpandedDetail(airportId, metarObj)
          : null;

      if (metarDetail) expandedDetails.push(metarDetail);

      const tafDetail =
        tafObj?.isOfficial && tafObj?.sourceType === "TAF"
          ? buildTafExpandedDetail(airportId, tafObj)
          : null;

      if (tafDetail) expandedDetails.push(tafDetail);

      return {
        airportId,
        sortIndex: airportConfig.sortIndex,
        metar: metarObj,
        taf: tafObj,
        showExpandedRow: expandedDetails.length > 0,
        expandedDetails
      };
    });

    airportResults.sort((a, b) => a.sortIndex - b.sortIndex);

    return {
      id: region.id,
      name: region.name,
      airports: airportResults
    };
  });

  const alerts = buildAlerts(regionResults);

  return {
    lastUpdatedUtc,
    regions: regionResults,
    alerts
  };
}

function applySourceSafetyMetadata(weatherObj, sourceType) {
  if (!weatherObj) return weatherObj;

  const isOfficial = sourceType === "METAR" || sourceType === "TAF";

  weatherObj.isOfficial = isOfficial;
  weatherObj.sourceAuthority = isOfficial
    ? "OFFICIAL_AVIATION"
    : "NON_AVIATION_DERIVED";
  weatherObj.sourceType = sourceType;

  if (sourceType === "METAR") {
    weatherObj.sourceLabel = "METAR (Official)";
    weatherObj.warningText = null;
  } else if (sourceType === "TAF") {
    weatherObj.sourceLabel = "TAF (Official)";
    weatherObj.warningText = null;
  } else if (sourceType === "FORECAST_CURRENT") {
    weatherObj.sourceLabel = "Forecast Derived (Non-Aviation)";
    weatherObj.warningText =
      "Non-aviation weather source. Not approved for operational flight decisions.";
  } else if (sourceType === "FORECAST") {
    weatherObj.sourceLabel = "Forecast Derived (Non-Aviation)";
    weatherObj.warningText =
      "Non-aviation weather source. Not approved for operational flight decisions.";
  } else if (sourceType === "NO_METAR") {
    weatherObj.sourceLabel = "No METAR Available";
    weatherObj.warningText = null;
  } else if (sourceType === "NO_TAF") {
    weatherObj.sourceLabel = "No TAF Available";
    weatherObj.warningText = null;
  } else {
    weatherObj.sourceLabel = "Non-Aviation Source";
    weatherObj.warningText =
      "Non-aviation weather source. Not approved for operational flight decisions.";
  }

  // Backend-only debug fields for validation
  weatherObj.debug = buildWeatherDebugObject(weatherObj);

  return weatherObj;
}

function buildWeatherDebugObject(weatherObj) {
  return {
    sourceType: weatherObj?.sourceType || null,
    isOfficial: weatherObj?.isOfficial ?? false,
    category: weatherObj?.category || null,
    status: weatherObj?.status || null,
    triggerType: weatherObj?.triggerType || weatherObj?.worstPeriod?.triggerType || null,
    ceilingFt: weatherObj?.ceilingFt ?? weatherObj?.worstPeriod?.ceilingFt ?? null,
    visibilitySm: weatherObj?.visibilitySm ?? weatherObj?.worstPeriod?.visibilitySm ?? null,
    validFrom: weatherObj?.worstPeriod?.fromUtc || null,
    validTo: weatherObj?.worstPeriod?.toUtc || null,
    reason: weatherObj?.reason || null
  };
}

function buildFallbackCurrentObject(record) {
  const category = normalizeFallbackCategory(record?.category);
  const status = normalizeFallbackStatus(record?.status, category);
  const reason =
    record?.reason ||
    record?.summary ||
    record?.detail ||
    "Estimated current conditions from non-aviation source.";

  return {
    status,
    severityRank: getSeverityRankFromStatus(status),
    category,
    reason,
    rawText: record?.rawText || record?.summary || "",
    ceilingFt: record?.ceilingFt ?? null,
    visibilitySm: record?.visibilitySm ?? null,
    windKt: record?.windKt ?? null,
    triggerType: record?.triggerType || "NONE",
    isAlert: false,
    hasData: true,
    derived: true
  };
}

function buildFallbackForecastObject(record) {
  const category = normalizeFallbackCategory(record?.category);
  const status = normalizeFallbackStatus(record?.status, category);
  const reason =
    record?.reason ||
    record?.summary ||
    record?.detail ||
    "Estimated forecast conditions from non-aviation source.";

  return {
    status,
    severityRank: getSeverityRankFromStatus(status),
    category,
    reason,
    rawText: record?.rawText || record?.summary || "",
    worstPeriod: {
      category,
      status,
      severityRank: getSeverityRankFromStatus(status),
      reason,
      fromUtc: record?.validFrom || null,
      toUtc: record?.validTo || null,
      ceilingFt: record?.ceilingFt ?? null,
      visibilitySm: record?.visibilitySm ?? null,
      triggerType: record?.triggerType || "NONE"
    },
    evaluatedPeriods: Array.isArray(record?.evaluatedPeriods)
      ? record.evaluatedPeriods
      : [],
    isAlert: false,
    hasData: true,
    derived: true
  };
}

function buildAlerts(regions) {
  const alerts = [];

  for (const region of regions) {
    for (const airport of region.airports) {
      if (airport.metar?.isOfficial && airport.metar?.isAlert) {
        alerts.push(
          buildAlertObject({
            airportId: airport.airportId,
            regionId: region.id,
            source: "METAR",
            weatherObj: airport.metar,
            detailObj: airport.expandedDetails.find(d => d.source === "METAR") || null
          })
        );
      }

      if (airport.taf?.isOfficial && airport.taf?.isAlert) {
        alerts.push(
          buildAlertObject({
            airportId: airport.airportId,
            regionId: region.id,
            source: "TAF",
            weatherObj: airport.taf,
            detailObj: airport.expandedDetails.find(d => d.source === "TAF") || null
          })
        );
      }
    }
  }

  alerts.sort(compareAlerts);

  return alerts.map((alert, index) => ({
    ...alert,
    sortOrder: index + 1
  }));
}

function buildAlertObject({ airportId, regionId, source, weatherObj, detailObj }) {
  return {
    airportId,
    regionId,
    source,
    status: weatherObj.status,
    severityRank: weatherObj.severityRank,
    category: weatherObj.category,
    headline: `${airportId} ${source} ${String(weatherObj.category).toUpperCase()}`,
    reason: weatherObj.reason,
    detail: detailObj?.detail || weatherObj.reason,
    rawText: weatherObj.rawText || ""
  };
}

function compareAlerts(a, b) {
  if (b.severityRank !== a.severityRank) {
    return b.severityRank - a.severityRank;
  }

  const regionCompare = compareRegionOrder(a.regionId, b.regionId);
  if (regionCompare !== 0) return regionCompare;

  const airportCompare = compareAirportOrder(a.airportId, b.airportId);
  if (airportCompare !== 0) return airportCompare;

  return compareSourceOrder(a.source, b.source);
}

function compareRegionOrder(regionIdA, regionIdB) {
  const indexA = REGIONS.findIndex(region => region.id === regionIdA);
  const indexB = REGIONS.findIndex(region => region.id === regionIdB);
  return indexA - indexB;
}

function compareAirportOrder(airportIdA, airportIdB) {
  const airportA = getAirportConfigSafe(airportIdA);
  const airportB = getAirportConfigSafe(airportIdB);

  if (!airportA && !airportB) return 0;
  if (!airportA) return 1;
  if (!airportB) return -1;

  if (airportA.regionId !== airportB.regionId) {
    return compareRegionOrder(airportA.regionId, airportB.regionId);
  }

  return airportA.sortIndex - airportB.sortIndex;
}

function compareSourceOrder(sourceA, sourceB) {
  const order = {
    METAR: 0,
    TAF: 1
  };

  return (order[sourceA] ?? 99) - (order[sourceB] ?? 99);
}

function getAirportConfigSafe(airportId) {
  for (const region of REGIONS) {
    const airport = region.airports.find(a => a.airportId === airportId);
    if (airport) {
      return {
        regionId: region.id,
        regionName: region.name,
        ...airport
      };
    }
  }
  return null;
}

function indexRecordsByAirportId(records, getAirportId) {
  const map = new Map();

  for (const record of records) {
    const airportId = normalizeAirportId(getAirportId(record));
    if (!airportId) continue;

    if (!map.has(airportId)) {
      map.set(airportId, record);
    }
  }

  return map;
}

function getMetarAirportId(record) {
  return (
    record?.icaoId ||
    record?.icao_id ||
    record?.stationId ||
    record?.station_id ||
    record?.id ||
    null
  );
}

function getTafAirportId(record) {
  return (
    record?.icaoId ||
    record?.icao_id ||
    record?.stationId ||
    record?.station_id ||
    record?.id ||
    null
  );
}

function getFallbackAirportId(record) {
  return (
    record?.airportId ||
    record?.icaoId ||
    record?.icao_id ||
    record?.stationId ||
    record?.station_id ||
    record?.id ||
    null
  );
}

function normalizeAirportId(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().toUpperCase();
}

function normalizeFallbackCategory(value) {
  const text = String(value || "").trim().toUpperCase();

  if (text === "LIFR") return "LIFR";
  if (text === "IFR") return "IFR";
  if (text === "MARGINAL" || text === "MVFR") return "MARGINAL";
  if (text === "VFR") return "VFR";
  return "NO_DATA";
}

function normalizeFallbackStatus(status, category) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (["green", "blue", "red", "purple", "gray"].includes(normalizedStatus)) {
    return normalizedStatus;
  }

  switch (category) {
    case "VFR":
      return "green";
    case "MARGINAL":
      return "blue";
    case "IFR":
      return "red";
    case "LIFR":
      return "purple";
    default:
      return "gray";
  }
}

function getSeverityRankFromStatus(status) {
  switch (status) {
    case "purple":
      return 3;
    case "red":
      return 2;
    case "blue":
      return 1;
    case "green":
      return 0;
    case "gray":
    default:
      return -1;
  }
}