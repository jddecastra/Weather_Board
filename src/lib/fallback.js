import {
  CATEGORY,
  STATUS,
  TRIGGER_TYPE,
  evaluateFlightCategory,
  isAlertSeverity
} from "./thresholds.js";
import {
  buildHeadline,
  buildReasonText
} from "./formatters.js";

export function buildForecastCurrentObject(rawForecast) {
  const current = rawForecast?.current;
  if (!current) return null;

  const evaluation = evaluateFlightCategory({
    ceilingFt: current.ceilingFt,
    visibilitySm: current.visibilitySm
  });

  return {
    sourceType: "FORECAST_CURRENT",
    alertSource: "FORECAST",
    provider: rawForecast.provider || "OPEN_METEO",
    status: evaluation.status,
    severityRank: evaluation.severityRank,
    category: evaluation.category,
    reason: buildReasonText({
      triggerType: evaluation.triggerType,
      ceilingFt: current.ceilingFt,
      visibilitySm: current.visibilitySm,
      prefix: "EST"
    }),
    rawText: buildForecastRawText(rawForecast, current.validFrom),
    ceilingFt: current.ceilingFt,
    visibilitySm: current.visibilitySm,
    windKt: current.windKt ?? null,
    weatherCode: current.weatherCode ?? null,
    triggerType: evaluation.triggerType,
    isAlert: isAlertSeverity(evaluation.severityRank),
    hasData: true,
    validFrom: current.validFrom || null,
    validTo: current.validTo || null
  };
}

export function buildForecastTafObject(rawForecast) {
  const periods = Array.isArray(rawForecast?.periods)
    ? rawForecast.periods.map(evaluateForecastPeriod)
    : [];

  if (!periods.length) return null;

  const worstPeriod = pickWorstForecastPeriod(periods);

  return {
    sourceType: "FORECAST_TAF",
    alertSource: "FORECAST",
    provider: rawForecast.provider || "OPEN_METEO",
    status: worstPeriod.status,
    severityRank: worstPeriod.severityRank,
    category: worstPeriod.category,
    reason: worstPeriod.reason,
    rawText: buildForecastRawText(rawForecast, worstPeriod.fromUtc),
    worstPeriod,
    evaluatedPeriods: periods,
    isAlert: isAlertSeverity(worstPeriod.severityRank),
    hasData: true
  };
}

export function buildForecastCurrentExpandedDetail(airportId, weatherObj) {
  if (!weatherObj?.isAlert) return null;

  return {
    source: "FORECAST",
    severity: weatherObj.status,
    headline: buildHeadline({
      source: "FORECAST",
      category: weatherObj.category,
      reason: weatherObj.reason
    }),
    detail: `${airportId} derived forecast below ${formatThresholdLabel(weatherObj.category)} near ${formatTimePoint(weatherObj.validFrom)} due to ${formatDetailReason(weatherObj)}.`
  };
}

export function buildForecastTafExpandedDetail(airportId, tafObj) {
  if (!tafObj?.isAlert || !tafObj?.worstPeriod) return null;

  const period = tafObj.worstPeriod;

  return {
    source: "FORECAST",
    severity: tafObj.status,
    headline: buildHeadline({
      source: "FORECAST",
      category: tafObj.category,
      reason: tafObj.reason
    }),
    detail: `${airportId} derived forecast below ${formatThresholdLabel(tafObj.category)} during ${formatPeriodWindow(period.fromUtc, period.toUtc)} due to ${formatDetailReason(period)}.`
  };
}

function evaluateForecastPeriod(period) {
  const evaluation = evaluateFlightCategory({
    ceilingFt: period.ceilingFt,
    visibilitySm: period.visibilitySm
  });

  return {
    ...period,
    reason: buildReasonText({
      triggerType: evaluation.triggerType,
      ceilingFt: period.ceilingFt,
      visibilitySm: period.visibilitySm,
      prefix: "EST"
    }),
    triggerType: evaluation.triggerType,
    category: evaluation.category,
    status: evaluation.status,
    severityRank: evaluation.severityRank
  };
}

function pickWorstForecastPeriod(periods) {
  return [...periods].sort(compareForecastPeriods)[0];
}

function compareForecastPeriods(a, b) {
  if (b.severityRank !== a.severityRank) {
    return b.severityRank - a.severityRank;
  }

  const triggerCompare = compareTriggerPriority(a.triggerType, b.triggerType);
  if (triggerCompare !== 0) return triggerCompare;

  if (a.triggerType === TRIGGER_TYPE.CEILING && b.triggerType === TRIGGER_TYPE.CEILING) {
    const aCeiling = a.ceilingFt ?? Number.POSITIVE_INFINITY;
    const bCeiling = b.ceilingFt ?? Number.POSITIVE_INFINITY;
    if (aCeiling !== bCeiling) return aCeiling - bCeiling;
  }

  if (a.triggerType === TRIGGER_TYPE.VISIBILITY && b.triggerType === TRIGGER_TYPE.VISIBILITY) {
    const aVis = a.visibilitySm ?? Number.POSITIVE_INFINITY;
    const bVis = b.visibilitySm ?? Number.POSITIVE_INFINITY;
    if (aVis !== bVis) return aVis - bVis;
  }

  const aTime = a.fromUtc ? new Date(a.fromUtc).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.fromUtc ? new Date(b.fromUtc).getTime() : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

function compareTriggerPriority(triggerA, triggerB) {
  const rank = trigger => {
    if (trigger === TRIGGER_TYPE.CEILING) return 0;
    if (trigger === TRIGGER_TYPE.VISIBILITY) return 1;
    return 2;
  };

  return rank(triggerA) - rank(triggerB);
}

function formatThresholdLabel(category) {
  switch (category) {
    case CATEGORY.LIFR:
      return "LIFR threshold";
    case CATEGORY.IFR:
      return "IFR threshold";
    case CATEGORY.MARGINAL:
      return "marginal threshold";
    default:
      return "weather threshold";
  }
}

function formatDetailReason(obj) {
  if (obj.triggerType === TRIGGER_TYPE.CEILING && obj.ceilingFt !== null) {
    return `ceiling ${Math.round(obj.ceilingFt)} ft`;
  }

  if (obj.triggerType === TRIGGER_TYPE.VISIBILITY && obj.visibilitySm !== null) {
    return `visibility ${trimNumber(obj.visibilitySm)} SM`;
  }

  return obj.reason || "forecast conditions";
}

function formatPeriodWindow(fromUtc, toUtc) {
  const from = formatTimePoint(fromUtc);
  const to = formatTimePoint(toUtc);
  return `${from} to ${to}`;
}

function formatTimePoint(isoString) {
  if (!isoString) return "unknown time";

  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "unknown time";

  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  return `${day}/${hour}Z`;
}

function buildForecastRawText(rawForecast, validFrom) {
  const provider = rawForecast?.provider || "OPEN_METEO";
  const timeText = validFrom ? ` valid ${validFrom}` : "";
  return `Forecast derived from ${provider}${timeText}`;
}

function trimNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toString().replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}