import { REGIONS, getAirportConfig } from "../config/airports.js";
import { buildMetarObject, buildMetarExpandedDetail, buildNoMetarObject } from "./metar.js";
import { buildTafObject, buildTafExpandedDetail, buildNoTafObject } from "./taf.js";

export function buildDashboardResponse({
  metarRecords = [],
  tafRecords = [],
  lastUpdatedUtc = new Date().toISOString()
}) {
  const metarMap = indexRecordsByAirportId(metarRecords, getMetarAirportId);
  const tafMap = indexRecordsByAirportId(tafRecords, getTafAirportId);

  const regionResults = REGIONS.map(region => {
    const airportResults = region.airports.map(airportConfig => {
      const airportId = airportConfig.airportId;

      const metarObj = metarMap.has(airportId)
        ? buildMetarObject(metarMap.get(airportId))
        : buildNoMetarObject();

      const tafObj = tafMap.has(airportId)
        ? buildTafObject(tafMap.get(airportId))
        : buildNoTafObject();

      const expandedDetails = [];

      const metarDetail = buildMetarExpandedDetail(airportId, metarObj);
      if (metarDetail) expandedDetails.push(metarDetail);

      const tafDetail = buildTafExpandedDetail(airportId, tafObj);
      if (tafDetail) expandedDetails.push(tafDetail);

      const airportResult = {
        airportId,
        sortIndex: airportConfig.sortIndex,
        metar: metarObj,
        taf: tafObj,
        showExpandedRow: expandedDetails.length > 0,
        expandedDetails
      };

      return airportResult;
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

function buildAlerts(regions) {
  const alerts = [];

  for (const region of regions) {
    for (const airport of region.airports) {
      if (airport.metar?.isAlert) {
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

      if (airport.taf?.isAlert) {
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
  const airportA = getAirportConfig(airportIdA);
  const airportB = getAirportConfig(airportIdB);

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

function normalizeAirportId(value) {
  if (!value || typeof value !== "string") return null;
  return value.trim().toUpperCase();
}