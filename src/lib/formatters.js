import { CATEGORY, STATUS, TRIGGER_TYPE } from "./thresholds.js";

export function formatCeilingReason(ceilingFt) {
  if (ceilingFt === null || ceilingFt === undefined || Number.isNaN(Number(ceilingFt))) {
    return "NO CIG";
  }

  const hundreds = Math.floor(Number(ceilingFt) / 100);
  return `CIG ${String(hundreds).padStart(3, "0")}`;
}

export function formatVisibilityReason(visibilitySm) {
  if (visibilitySm === null || visibilitySm === undefined || Number.isNaN(Number(visibilitySm))) {
    return "NO VIS";
  }

  const vis = Number(visibilitySm);

  if (Number.isInteger(vis)) {
    return `VIS ${vis}SM`;
  }

  return `VIS ${trimTrailingZeros(vis)}SM`;
}

export function buildReasonText({ triggerType, ceilingFt, visibilitySm, prefix = "" }) {
  let reason = "VFR";

  if (triggerType === TRIGGER_TYPE.CEILING) {
    reason = formatCeilingReason(ceilingFt);
  } else if (triggerType === TRIGGER_TYPE.VISIBILITY) {
    reason = formatVisibilityReason(visibilitySm);
  }

  return prefix ? `${prefix} ${reason}` : reason;
}

export function buildNoDataReason(kind = "DATA") {
  return `NO ${kind}`;
}

export function buildHeadline({ source, category, reason }) {
  const sourceText = source?.toUpperCase() || "WX";
  const categoryText = formatCategoryLabel(category);
  return `${sourceText} ${categoryText} - ${reason}`;
}

export function formatCategoryLabel(category) {
  switch (category) {
    case CATEGORY.VFR:
      return "VFR";
    case CATEGORY.MARGINAL:
      return "MARGINAL";
    case CATEGORY.IFR:
      return "IFR";
    case CATEGORY.LIFR:
      return "LIFR";
    case CATEGORY.NO_DATA:
      return "NO DATA";
    default:
      return "UNKNOWN";
  }
}

export function formatStatusLabel(status) {
  switch (status) {
    case STATUS.GREEN:
      return "Green";
    case STATUS.BLUE:
      return "Blue";
    case STATUS.RED:
      return "Red";
    case STATUS.PURPLE:
      return "Purple";
    case STATUS.GRAY:
      return "Gray";
    default:
      return "Unknown";
  }
}

export function formatUtcTimestamp(isoString) {
  if (!isoString) return "Unknown";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");

  return `${yy}${mm}${dd} ${hh}${min}Z`;
}

export function trimTrailingZeros(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);

  return num.toString().replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}