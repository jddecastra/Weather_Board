export const STATUS = {
  GRAY: "gray",
  GREEN: "green",
  BLUE: "blue",
  RED: "red",
  PURPLE: "purple"
};

export const CATEGORY = {
  NO_DATA: "no_data",
  VFR: "vfr",
  MARGINAL: "marginal",
  IFR: "ifr",
  LIFR: "lifr"
};

export const TRIGGER_TYPE = {
  NONE: "none",
  CEILING: "ceiling",
  VISIBILITY: "visibility"
};

export const SEVERITY_RANK = {
  gray: -1,
  green: 0,
  blue: 1,
  red: 2,
  purple: 3
};

export const THRESHOLDS = {
  lifr: {
    ceilingFt: 500,
    visibilitySm: 1
  },
  ifr: {
    ceilingFt: 1000,
    visibilitySm: 3
  },
  marginal: {
    ceilingFt: 2000,
    visibilitySm: 6
  }
};

export function normalizeVisibilitySm(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value);
}

export function normalizeCeilingFt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }
  return Number(value);
}

export function evaluateFlightCategory({ ceilingFt, visibilitySm }) {
  const ceiling = normalizeCeilingFt(ceilingFt);
  const visibility = normalizeVisibilitySm(visibilitySm);

  if (ceiling === null && visibility === null) {
    return {
      status: STATUS.GRAY,
      severityRank: SEVERITY_RANK[STATUS.GRAY],
      category: CATEGORY.NO_DATA,
      triggerType: TRIGGER_TYPE.NONE
    };
  }

  if (
    (ceiling !== null && ceiling < THRESHOLDS.lifr.ceilingFt) ||
    (visibility !== null && visibility < THRESHOLDS.lifr.visibilitySm)
  ) {
    return {
      status: STATUS.PURPLE,
      severityRank: SEVERITY_RANK[STATUS.PURPLE],
      category: CATEGORY.LIFR,
      triggerType: pickTriggerType({
        ceiling,
        visibility,
        category: CATEGORY.LIFR
      })
    };
  }

  if (
    (ceiling !== null && ceiling < THRESHOLDS.ifr.ceilingFt) ||
    (visibility !== null && visibility < THRESHOLDS.ifr.visibilitySm)
  ) {
    return {
      status: STATUS.RED,
      severityRank: SEVERITY_RANK[STATUS.RED],
      category: CATEGORY.IFR,
      triggerType: pickTriggerType({
        ceiling,
        visibility,
        category: CATEGORY.IFR
      })
    };
  }

  if (
    (ceiling !== null && ceiling < THRESHOLDS.marginal.ceilingFt) ||
    (visibility !== null && visibility < THRESHOLDS.marginal.visibilitySm)
  ) {
    return {
      status: STATUS.BLUE,
      severityRank: SEVERITY_RANK[STATUS.BLUE],
      category: CATEGORY.MARGINAL,
      triggerType: pickTriggerType({
        ceiling,
        visibility,
        category: CATEGORY.MARGINAL
      })
    };
  }

  return {
    status: STATUS.GREEN,
    severityRank: SEVERITY_RANK[STATUS.GREEN],
    category: CATEGORY.VFR,
    triggerType: TRIGGER_TYPE.NONE
  };
}

function pickTriggerType({ ceiling, visibility, category }) {
  const limits = THRESHOLDS[category];
  if (!limits) return TRIGGER_TYPE.NONE;

  const ceilingTriggered =
    ceiling !== null && ceiling < limits.ceilingFt;

  const visibilityTriggered =
    visibility !== null && visibility < limits.visibilitySm;

  if (ceilingTriggered) return TRIGGER_TYPE.CEILING;
  if (visibilityTriggered) return TRIGGER_TYPE.VISIBILITY;
  return TRIGGER_TYPE.NONE;
}

export function isAlertSeverity(severityRank) {
  return severityRank >= SEVERITY_RANK[STATUS.RED];
}