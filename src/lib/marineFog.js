const MARINE_ZONE_URLS = {
  ANZ255: "https://tgftp.nws.noaa.gov/data/forecasts/marine/coastal/an/anz255.txt"
};

const WEEKDAY_INDEX = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6
};

export async function fetchMarineFogAlerts() {
  const zoneId = "ANZ255";
  const text = await fetchZoneText(zoneId);
  if (!text) return [];

  const issueDate = parseIssueDate(text);
  const periods = parseForecastPeriods(text);
  if (!issueDate || periods.length === 0) return [];

  const fogPeriods = periods
    .map(period => ({
      ...period,
      resolvedDate: resolvePeriodDate(period.label, issueDate)
    }))
    .filter(period => containsFog(period.text));

  if (!fogPeriods.length) return [];

  const alerts = [];

  for (const period of fogPeriods) {
    const displayDate = formatAlertDate(period.resolvedDate);
    const detail = buildMarineDetail(period, zoneId, displayDate);

    alerts.push(
      buildMarineAlert("KACK", detail, text, displayDate),
      buildMarineAlert("KMVY", detail, text, displayDate)
    );
  }

  return dedupeMarineAlerts(alerts);
}

async function fetchZoneText(zoneId) {
  const url = MARINE_ZONE_URLS[zoneId];
  if (!url) return null;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "WeatherBoard/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Marine forecast request failed for ${zoneId}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

function parseIssueDate(text) {
  // Example:
  // 1022 PM EDT Wed Apr 15 2026
  const match = text.match(
    /\b\d{3,4}\s+(AM|PM)\s+[A-Z]{2,4}\s+\w{3}\s+\w{3}\s+(\d{1,2})\s+(\d{4})\b/
  );

  if (!match) return null;

  // Grab the entire matched date line more flexibly
  const lineMatch = text.match(
    /\b(\d{3,4})\s+(AM|PM)\s+([A-Z]{2,4})\s+(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\b/
  );

  if (!lineMatch) return null;

  const hhmm = lineMatch[1];
  const ampm = lineMatch[2];
  const monthStr = lineMatch[5];
  const day = Number(lineMatch[6]);
  const year = Number(lineMatch[7]);

  const hourPart = hhmm.length === 3 ? hhmm.slice(0, 1) : hhmm.slice(0, 2);
  const minutePart = hhmm.length === 3 ? hhmm.slice(1) : hhmm.slice(2);

  let hour = Number(hourPart);
  const minute = Number(minutePart);

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const monthIndex = monthToIndex(monthStr);
  if (monthIndex === null) return null;

  return new Date(Date.UTC(year, monthIndex, day, hour, minute, 0));
}

function parseForecastPeriods(text) {
  const lines = text.split(/\r?\n/);

  const zoneStart = lines.findIndex(line => /^ANZ255-/.test(line.trim()));
  if (zoneStart === -1) return [];

  const zoneLines = [];
  for (let i = zoneStart + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^[A-Z]{3}\d{3}-/.test(line.trim())) break;
    if (/^\$\$/.test(line.trim())) break;

    zoneLines.push(line);
  }

  const zoneText = zoneLines.join("\n");
  const matches = [...zoneText.matchAll(/^\.(.+?)\.\.\.(.*?)(?=^\.[A-Z0-9 \/]+\.{3}|\Z)/gms)];

  return matches.map(match => ({
    label: normalizeLabel(match[1]),
    text: normalizeForecastText(match[2])
  }));
}

function normalizeLabel(label) {
  return String(label || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizeForecastText(text) {
  return String(text || "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsFog(text) {
  return /\bfog\b/i.test(text);
}

function resolvePeriodDate(label, issueDate) {
  const normalized = normalizeLabel(label);

  if (
    normalized.includes("TONIGHT") ||
    normalized.includes("OVERNIGHT") ||
    normalized.includes("THIS AFTERNOON") ||
    normalized.includes("THIS EVENING") ||
    normalized.includes("TODAY")
  ) {
    return new Date(Date.UTC(
      issueDate.getUTCFullYear(),
      issueDate.getUTCMonth(),
      issueDate.getUTCDate()
    ));
  }

  const weekdayMatch = normalized.match(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/);
  if (weekdayMatch) {
    return nextWeekdayDate(issueDate, weekdayMatch[1]);
  }

  return new Date(Date.UTC(
    issueDate.getUTCFullYear(),
    issueDate.getUTCMonth(),
    issueDate.getUTCDate()
  ));
}

function nextWeekdayDate(issueDate, weekdayAbbrev) {
  const target = WEEKDAY_INDEX[weekdayAbbrev];
  const base = new Date(Date.UTC(
    issueDate.getUTCFullYear(),
    issueDate.getUTCMonth(),
    issueDate.getUTCDate()
  ));

  const current = base.getUTCDay();
  let offset = target - current;
  if (offset < 0) offset += 7;

  base.setUTCDate(base.getUTCDate() + offset);
  return base;
}

function formatAlertDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Unknown Date";

  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function buildMarineDetail(period, zoneId, displayDate) {
  return `${zoneId} marine forecast includes fog for ${displayDate} (${period.label}). Supplemental marine alert. ${period.text}`;
}

function buildMarineAlert(airportId, detail, rawText, displayDate) {
  return {
    airportId,
    regionId: "northeast",
    source: "MARINE",
    status: "blue",
    severityRank: 1,
    category: "FOG",
    headline: `${airportId} MARINE FOG ${displayDate}`,
    reason: `Forecasted fog on ${displayDate}`,
    detail,
    rawText
  };
}

function dedupeMarineAlerts(alerts) {
  const seen = new Set();

  return alerts.filter(alert => {
    const key = `${alert.airportId}|${alert.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function monthToIndex(monthStr) {
  const months = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11
  };

  return months[String(monthStr || "").toUpperCase()] ?? null;
}