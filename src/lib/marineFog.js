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

  const airports = ["KACK", "KMVY"];

  return airports.map(airportId =>
    buildAggregatedMarineAlert({
      airportId,
      zoneId,
      rawText: text,
      fogPeriods
    })
  );
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

function buildAggregatedMarineAlert({ airportId, zoneId, rawText, fogPeriods }) {
  const uniqueDates = dedupeStrings(
    fogPeriods.map(period => formatAlertDate(period.resolvedDate))
  );

  const uniqueLabels = dedupeStrings(
    fogPeriods.map(period => period.label)
  );

  const detailLines = fogPeriods.map(period => {
    const displayDate = formatAlertDate(period.resolvedDate);
    return `${displayDate} (${period.label}): ${period.text}`;
  });

  return {
    airportId,
    regionId: "northeast",
    source: "MARINE",
    status: "blue",
    severityRank: 1,
    category: "FOG",
    headline: `${airportId} MARINE FOG`,
    reason: `Forecasted fog on ${uniqueDates.join(", ")}`,
    detail: `${zoneId} marine forecast indicates fog on ${uniqueDates.join(", ")}. Supplemental marine alert.\n\n${detailLines.join("\n")}`,
    rawText,
    fogDates: uniqueDates,
    fogPeriods: uniqueLabels
  };
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
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