import {
  CATEGORY,
  STATUS,
  TRIGGER_TYPE,
  evaluateFlightCategory,
  isAlertSeverity,
  normalizeCeilingFt,
  normalizeVisibilitySm
} from "./thresholds.js";
import {
  buildHeadline,
  buildNoDataReason,
  buildReasonText
} from "./formatters.js";

export function buildMetarObject(rawMetarRecord) {
  if (!rawMetarRecord) {
    return buildNoMetarObject();
  }

  const rawText = extractMetarRawText(rawMetarRecord);
  const ceilingFt = extractMetarCeilingFt(rawMetarRecord);
  const visibilitySm = extractMetarVisibilitySm(rawMetarRecord);
  const flightCategory = extractMetarFlightCategory(rawMetarRecord);

  const evaluation = evaluateFlightCategory({
    ceilingFt,
    visibilitySm
  });

  const reason = buildReasonText({
    triggerType: evaluation.triggerType,
    ceilingFt,
    visibilitySm
  });

  return {
    status: evaluation.status,
    severityRank: evaluation.severityRank,
    category: evaluation.category,
    reason,
    rawText,
    ceilingFt,
    visibilitySm,
    flightCategory,
    triggerType: evaluation.triggerType,
    isAlert: isAlertSeverity(evaluation.severityRank),
    hasData: true
  };
}

export function buildNoMetarObject() {
  return {
    status: STATUS.GRAY,
    severityRank: -1,
    category: CATEGORY.NO_DATA,
    reason: buildNoDataReason("METAR"),
    rawText: "",
    ceilingFt: null,
    visibilitySm: null,
    flightCategory: null,
    triggerType: TRIGGER_TYPE.NONE,
    isAlert: false,
    hasData: false
  };
}

export function buildMetarExpandedDetail(airportId, metarObj) {
  if (!metarObj?.isAlert) return null;

  return {
    source: "METAR",
    severity: metarObj.status,
    headline: buildHeadline({
      source: "METAR",
      category: metarObj.category,
      reason: metarObj.reason
    }),
    detail: `${airportId} current observation below ${formatThresholdLabel(metarObj.category)} due to ${formatDetailReason(metarObj)}.`
  };
}

function extractMetarRawText(record) {
  return (
    record.rawOb ||
    record.raw_text ||
    record.rawText ||
    ""
  );
}

function extractMetarFlightCategory(record) {
  return (
    record.fltCat ||
    record.flight_category ||
    null
  );
}

function extractMetarVisibilitySm(record) {
  const candidates = [
    record.visib,
    record.visibility,
    record.visibility_sm,
    record.visibilityStatuteMi
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVisibilitySm(candidate);
    if (normalized !== null) return normalized;
  }

  return parseVisibilityFromRawText(extractMetarRawText(record));
}

function extractMetarCeilingFt(record) {
  const directCandidates = [
    record.ceiling,
    record.ceilingFt,
    record.ceiling_ft_agl
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeCeilingFt(candidate);
    if (normalized !== null) return normalized;
  }

  if (Array.isArray(record.clouds) && record.clouds.length > 0) {
    const brokenOrOvercast = record.clouds
      .filter(layer => {
        const cover = String(layer.cover || layer.coverage || "").toUpperCase();
        return cover === "BKN" || cover === "OVC" || cover === "VV";
      })
      .map(layer => normalizeCeilingFt(layer.base || layer.baseFt || layer.altitude))
      .filter(value => value !== null);

    if (brokenOrOvercast.length > 0) {
      return Math.min(...brokenOrOvercast);
    }
  }

  return parseCeilingFromRawText(extractMetarRawText(record));
}

function parseCeilingFromRawText(rawText) {
  if (!rawText) return null;

  const matches = [...rawText.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)];
  if (matches.length === 0) return null;

  const bases = matches
    .map(match => Number(match[2]) * 100)
    .filter(value => !Number.isNaN(value));

  return bases.length > 0 ? Math.min(...bases) : null;
}

function parseVisibilityFromRawText(rawText) {
  if (!rawText) return null;

  // CAVOK = 10km+ visibility and no significant low cloud/weather
  if (/\bCAVOK\b/.test(rawText)) {
    return 6;
  }

  // International METAR visibility in meters:
  // 9999 = 10km or more
  const meters9999 = rawText.match(/\b9999\b/);
  if (meters9999) {
    return 6;
  }

  // Explicit SM formats
  const lessThanQuarter = rawText.match(/\bM?1\/4SM\b/);
  if (lessThanQuarter) {
    return 0.25;
  }

  const mixedFraction = rawText.match(/\b(\d+)\s+(\d+)\/(\d+)SM\b/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);

    if (denominator !== 0) {
      return whole + numerator / denominator;
    }
  }

  const simpleFraction = rawText.match(/\b(\d+)\/(\d+)SM\b/);
  if (simpleFraction) {
    const numerator = Number(simpleFraction[1]);
    const denominator = Number(simpleFraction[2]);

    if (denominator !== 0) {
      return numerator / denominator;
    }
  }

  const wholeNumber = rawText.match(/\b(P?\d+(?:\.\d+)?)SM\b/);
  if (wholeNumber) {
    const text = wholeNumber[1].replace(/^P/, "");
    const value = Number(text);
    return Number.isNaN(value) ? null : value;
  }

  // International ICAO metric visibility in meters.
  // Usually appears as a 4-digit group like 0800, 3000, 5000, 8000, 9999.
  // We try to capture the visibility group after wind and before cloud/weather groups.
  const metricMatch = rawText.match(
    /\b\d{5}(?:G\d{2,3})?KT\s+(?:(\d{4})|CAVOK)\b/
  );

  if (metricMatch && metricMatch[1]) {
    const meters = Number(metricMatch[1]);
    if (!Number.isNaN(meters)) {
      return metersToStatuteMiles(meters);
    }
  }

  return null;
}

function metersToStatuteMiles(meters) {
  if (!Number.isFinite(meters)) return null;

  // 9999 already handled above; cap large values at 6 to stay consistent with P6SM
  const sm = meters / 1609.34;
  return sm >= 6 ? 6 : Number(sm.toFixed(1));
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

function formatDetailReason(metarObj) {
  if (metarObj.triggerType === TRIGGER_TYPE.CEILING && metarObj.ceilingFt !== null) {
    return `ceiling ${metarObj.ceilingFt} ft`;
  }

  if (metarObj.triggerType === TRIGGER_TYPE.VISIBILITY && metarObj.visibilitySm !== null) {
    return `visibility ${metarObj.visibilitySm} SM`;
  }

  return metarObj.reason;
}