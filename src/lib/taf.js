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

export function buildTafObject(rawTafRecord) {
  if (!rawTafRecord) {
    return buildNoTafObject();
  }

  const rawText = extractTafRawText(rawTafRecord);
  if (!rawText) {
    return buildNoTafObject();
  }

  const issueTimeUtc = extractTafIssueTimeUtc(rawTafRecord, rawText);
  const validPeriod = extractTafValidPeriod(rawTafRecord, rawText);

  const parsedGroups = parseTafGroups({
    rawText,
    issueTimeUtc,
    validPeriod
  });

  const evaluatedPeriods = parsedGroups.map(evaluateTafGroup);

  if (evaluatedPeriods.length === 0) {
    return buildNoTafObject(rawText);
  }

  const worstPeriod = pickWorstTafPeriod(evaluatedPeriods);

  return {
    status: worstPeriod.status,
    severityRank: worstPeriod.severityRank,
    category: worstPeriod.category,
    reason: worstPeriod.reason,
    rawText,
    worstPeriod,
    evaluatedPeriods,
    isAlert: isAlertSeverity(worstPeriod.severityRank),
    hasData: true
  };
}

export function buildNoTafObject(rawText = "") {
  return {
    status: STATUS.GRAY,
    severityRank: -1,
    category: CATEGORY.NO_DATA,
    reason: buildNoDataReason("TAF"),
    rawText,
    worstPeriod: null,
    evaluatedPeriods: [],
    isAlert: false,
    hasData: false
  };
}

export function buildTafExpandedDetail(airportId, tafObj) {
  if (!tafObj?.isAlert || !tafObj?.worstPeriod) return null;

  const period = tafObj.worstPeriod;
  const timePart = formatPeriodWindow(period.fromUtc, period.toUtc);

  return {
    source: "TAF",
    severity: tafObj.status,
    headline: buildHeadline({
      source: "TAF",
      category: tafObj.category,
      reason: tafObj.reason
    }),
    detail: `${airportId} forecast below ${formatThresholdLabel(tafObj.category)} during ${timePart} due to ${formatDetailReason(period)}.`
  };
}

function extractTafRawText(record) {
  return (
    record.rawTAF ||
    record.raw_text ||
    record.rawText ||
    ""
  );
}

function extractTafIssueTimeUtc(record, rawText) {
  const directCandidates = [
    record.issueTime,
    record.issue_time,
    record.issued_at,
    record.obsTime
  ];

  for (const candidate of directCandidates) {
    if (candidate) {
      const date = new Date(candidate);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const match = rawText.match(/\bTAF(?:\s+AMD|\s+COR)?\s+\w{4}\s+(\d{2})(\d{2})(\d{2})Z\b/);
  if (!match) return null;

  return buildIsoFromDayHourMinute(match[1], match[2], match[3]);
}

function extractTafValidPeriod(record, rawText) {
  if (record.validTimeFrom && record.validTimeTo) {
    const from = new Date(record.validTimeFrom);
    const to = new Date(record.validTimeTo);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return {
        fromUtc: from.toISOString(),
        toUtc: to.toISOString()
      };
    }
  }

  const match = rawText.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  if (!match) return null;

  const fromUtc = buildIsoFromDayHour(match[1], match[2]);
  const toUtc = buildIsoFromDayHour(match[3], match[4], fromUtc);

  return { fromUtc, toUtc };
}

function parseTafGroups({ rawText, issueTimeUtc, validPeriod }) {
  const sanitized = normalizeTafText(rawText);
  const headerMatch = sanitized.match(
    /^TAF(?:\s+AMD|\s+COR)?\s+([A-Z0-9]{4})\s+\d{6}Z\s+(\d{4}\/\d{4})\s+(.*)$/i
  );

  if (!headerMatch) return [];

  const body = headerMatch[3].trim();
  if (!body) return [];

  const tokens = body.split(/\s+/);

  const groups = [];
  let currentGroup = {
    groupType: "BASE",
    timeToken: null,
    tokens: []
  };

  for (const token of tokens) {
    if (isTafGroupStarter(token)) {
      groups.push(currentGroup);
      currentGroup = {
        groupType: getGroupType(token),
        timeToken: token,
        tokens: []
      };
    } else {
      currentGroup.tokens.push(token);
    }
  }

  groups.push(currentGroup);

  const resolvedGroups = groups
    .filter(group => group.tokens.length > 0 || group.groupType === "BASE")
    .map(group => resolveGroupTimes(group, issueTimeUtc, validPeriod));

  for (let i = 0; i < resolvedGroups.length; i += 1) {
    const current = resolvedGroups[i];
    const next = resolvedGroups[i + 1];

    if (!current.toUtc && next?.fromUtc) {
      current.toUtc = next.fromUtc;
    }
  }

  if (resolvedGroups.length > 0) {
    const last = resolvedGroups[resolvedGroups.length - 1];
    if (!last.toUtc && validPeriod?.toUtc) {
      last.toUtc = validPeriod.toUtc;
    }
  }

  return resolvedGroups;
}

function evaluateTafGroup(group) {
  const { ceilingFt, visibilitySm } = extractConditionsFromTokens(group.tokens);
  const evaluation = evaluateFlightCategory({ ceilingFt, visibilitySm });

  return {
    groupType: group.groupType,
    fromUtc: group.fromUtc,
    toUtc: group.toUtc,
    reason: buildReasonText({
      triggerType: evaluation.triggerType,
      ceilingFt,
      visibilitySm,
      prefix: group.groupType === "BASE" ? "" : group.groupType
    }),
    triggerType: evaluation.triggerType,
    ceilingFt,
    visibilitySm,
    category: evaluation.category,
    status: evaluation.status,
    severityRank: evaluation.severityRank
  };
}

function pickWorstTafPeriod(periods) {
  return [...periods].sort(compareTafPeriods)[0];
}

function compareTafPeriods(a, b) {
  if (b.severityRank !== a.severityRank) {
    return b.severityRank - a.severityRank;
  }

  const triggerCompare = compareTriggerPriority(a, b);
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

function compareTriggerPriority(a, b) {
  const rank = trigger => {
    if (trigger === TRIGGER_TYPE.CEILING) return 0;
    if (trigger === TRIGGER_TYPE.VISIBILITY) return 1;
    return 2;
  };

  return rank(a.triggerType) - rank(b.triggerType);
}

function extractConditionsFromTokens(tokens) {
  const ceilingFt = extractCeilingFromTokens(tokens);
  const visibilitySm = extractVisibilityFromTokens(tokens);

  return {
    ceilingFt: normalizeCeilingFt(ceilingFt),
    visibilitySm: normalizeVisibilitySm(visibilitySm)
  };
}

function extractCeilingFromTokens(tokens) {
  const joined = tokens.join(" ");
  const matches = [...joined.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)];

  if (matches.length === 0) return null;

  const values = matches
    .map(match => Number(match[2]) * 100)
    .filter(value => !Number.isNaN(value));

  return values.length ? Math.min(...values) : null;
}

function extractVisibilityFromTokens(tokens) {
  const joined = tokens.join(" ");

  if (/\bP6SM\b/.test(joined)) return 6;

  const lessThanQuarter = joined.match(/\bM?1\/4SM\b/);
  if (lessThanQuarter) return 0.25;

  const mixedFraction = joined.match(/\b(\d+)\s+(\d+)\/(\d+)SM\b/);
  if (mixedFraction) {
    const whole = Number(mixedFraction[1]);
    const numerator = Number(mixedFraction[2]);
    const denominator = Number(mixedFraction[3]);
    if (denominator !== 0) return whole + numerator / denominator;
  }

  const simpleFraction = joined.match(/\b(\d+)\/(\d+)SM\b/);
  if (simpleFraction) {
    const numerator = Number(simpleFraction[1]);
    const denominator = Number(simpleFraction[2]);
    if (denominator !== 0) return numerator / denominator;
  }

  const wholeNumber = joined.match(/\b(\d+(?:\.\d+)?)SM\b/);
  if (wholeNumber) {
    const value = Number(wholeNumber[1]);
    return Number.isNaN(value) ? null : value;
  }

  return null;
}

function resolveGroupTimes(group, issueTimeUtc, validPeriod) {
  if (group.groupType === "BASE") {
    return {
      ...group,
      fromUtc: validPeriod?.fromUtc || issueTimeUtc || null,
      toUtc: null
    };
  }

  if (!group.timeToken) {
    return {
      ...group,
      fromUtc: null,
      toUtc: null
    };
  }

  if (group.groupType === "FM") {
    const match = group.timeToken.match(/^FM(\d{2})(\d{2})(\d{2})$/);
    if (!match) return { ...group, fromUtc: null, toUtc: null };

    return {
      ...group,
      fromUtc: buildIsoFromDayHourMinute(match[1], match[2], match[3], validPeriod?.fromUtc),
      toUtc: null
    };
  }

  if (group.groupType === "TEMPO" || group.groupType === "BECMG") {
    const match = group.timeToken.match(/^(TEMPO|BECMG)\s*(\d{4})\/(\d{4})$/);
    if (!match) return { ...group, fromUtc: null, toUtc: null };

    const fromToken = match[2];
    const toToken = match[3];

    return {
      ...group,
      fromUtc: buildIsoFromDayHour(fromToken.slice(0, 2), fromToken.slice(2, 4), validPeriod?.fromUtc),
      toUtc: buildIsoFromDayHour(toToken.slice(0, 2), toToken.slice(2, 4), validPeriod?.fromUtc)
    };
  }

  return {
    ...group,
    fromUtc: null,
    toUtc: null
  };
}

function isTafGroupStarter(token) {
  return /^FM\d{6}$/.test(token) ||
    /^(TEMPO|BECMG)\d{4}\/\d{4}$/.test(token) ||
    /^(TEMPO|BECMG)$/.test(token);
}

function getGroupType(token) {
  if (/^FM\d{6}$/.test(token)) return "FM";
  if (token.startsWith("TEMPO")) return "TEMPO";
  if (token.startsWith("BECMG")) return "BECMG";
  return "BASE";
}

function normalizeTafText(rawText) {
  return rawText
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bTEMPO\s+(\d{4}\/\d{4})\b/g, "TEMPO$1")
    .replace(/\bBECMG\s+(\d{4}\/\d{4})\b/g, "BECMG$1")
    .trim();
}

function buildIsoFromDayHour(dayStr, hourStr, referenceIso = null) {
  return buildIsoFromParts({
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: 0,
    referenceIso
  });
}

function buildIsoFromDayHourMinute(dayStr, hourStr, minuteStr, referenceIso = null) {
  return buildIsoFromParts({
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    referenceIso
  });
}

function buildIsoFromParts({ day, hour, minute, referenceIso = null }) {
  const reference = referenceIso ? new Date(referenceIso) : new Date();

  if (Number.isNaN(reference.getTime())) return null;

  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();

  let date = new Date(Date.UTC(year, month, day, hour, minute, 0));

  if (referenceIso) {
    const ref = new Date(referenceIso);

    if (date.getTime() < ref.getTime() - 36 * 60 * 60 * 1000) {
      date = new Date(Date.UTC(year, month + 1, day, hour, minute, 0));
    } else if (date.getTime() > ref.getTime() + 20 * 24 * 60 * 60 * 1000) {
      date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    }
  }

  return date.toISOString();
}

function formatPeriodWindow(fromUtc, toUtc) {
  if (!fromUtc && !toUtc) return "forecast period";

  const start = fromUtc ? formatShortZulu(fromUtc) : "start";
  const end = toUtc ? formatShortZulu(toUtc) : "end";

  return `${start}-${end}`;
}

function formatShortZulu(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "UNK";

  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  return `${day}${hour}Z`;
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
      return "forecast threshold";
  }
}

function formatDetailReason(period) {
  if (period.triggerType === TRIGGER_TYPE.CEILING && period.ceilingFt !== null) {
    return `ceiling ${period.ceilingFt} ft`;
  }

  if (period.triggerType === TRIGGER_TYPE.VISIBILITY && period.visibilitySm !== null) {
    return `visibility ${period.visibilitySm} SM`;
  }

  return period.reason;
}