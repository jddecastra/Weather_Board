export function renderDashboard(data) {
  renderTimestamp(data.lastUpdatedUtc);
  renderRegions(data.regions || []);
  renderAlerts(data.alerts || []);
}

export function renderErrorState(message) {
  const regionsGrid = document.getElementById("regions-grid");
  const alertsPanel = document.getElementById("alerts-panel");
  const lastUpdated = document.getElementById("last-updated");

  if (lastUpdated) {
    lastUpdated.textContent = "Update failed";
  }

  if (regionsGrid) {
    regionsGrid.innerHTML = `
      <div class="error-panel">
        <div class="error-title">Dashboard Load Failed</div>
        <div class="error-message">${escapeHtml(message)}</div>
      </div>
    `;
  }

  if (alertsPanel) {
    alertsPanel.innerHTML = `
      <div class="empty-alerts">No alert data available.</div>
    `;
  }
}

function renderTimestamp(lastUpdatedUtc) {
  const el = document.getElementById("last-updated");
  if (!el) return;

  el.textContent = formatZuluTimestamp(lastUpdatedUtc);
}

function renderRegions(regions) {
  const container = document.getElementById("regions-grid");
  if (!container) return;

  if (!regions.length) {
    container.innerHTML = `<div class="loading-panel">No region data available.</div>`;
    return;
  }

  container.innerHTML = regions.map(renderRegionCard).join("");
}

function renderRegionCard(region) {
  const airportRows = (region.airports || []).map(renderAirportBlock).join("");

  return `
    <section class="region-card">
      <div class="region-header">
        <h2>${escapeHtml(region.name)}</h2>
      </div>

      <table class="region-table">
        <thead>
          <tr>
            <th>Airport / METAR</th>
            <th>TAF</th>
          </tr>
        </thead>
        <tbody>
          ${airportRows}
        </tbody>
      </table>
    </section>
  `;
}

function renderAirportBlock(airport) {
  const primaryRow = `
    <tr class="airport-row">
      <td class="airport-cell metar-cell ${statusClass(airport.metar?.status)}" title="${escapeHtml(airport.metar?.rawText || "")}">
        <div class="airport-code">${escapeHtml(airport.airportId)}</div>
        <div class="cell-reason">${escapeHtml(airport.metar?.reason || "")}</div>
      </td>
      <td class="taf-cell ${statusClass(airport.taf?.status)}" title="${escapeHtml(airport.taf?.rawText || "")}">
        <div class="taf-reason">${escapeHtml(airport.taf?.reason || "")}</div>
      </td>
    </tr>
  `;

  const expandedRow = airport.showExpandedRow
    ? `
      <tr class="expanded-row">
        <td colspan="2">
          <div class="expanded-details">
            ${(airport.expandedDetails || []).map(renderExpandedDetail).join("")}
          </div>
        </td>
      </tr>
    `
    : "";

  return primaryRow + expandedRow;
}

function renderExpandedDetail(detail) {
  return `
    <div class="expanded-detail ${statusClass(detail.severity)}">
      <div class="expanded-headline">${escapeHtml(detail.headline)}</div>
      <div class="expanded-text">${escapeHtml(detail.detail)}</div>
    </div>
  `;
}

function renderAlerts(alerts) {
  const container = document.getElementById("alerts-panel");
  if (!container) return;

  if (!alerts.length) {
    container.innerHTML = `<div class="empty-alerts">No active IFR/LIFR alerts.</div>`;
    return;
  }

  container.innerHTML = alerts.map(renderAlertCard).join("");
}

function renderAlertCard(alert) {
  return `
    <article class="alert-card ${statusClass(alert.status)}" title="${escapeHtml(alert.rawText || "")}">
      <div class="alert-top-line">
        <span class="alert-airport">${escapeHtml(alert.airportId)}</span>
        <span class="alert-source">${escapeHtml(alert.source)}</span>
        <span class="alert-category">${escapeHtml(String(alert.category || "").toUpperCase())}</span>
      </div>
      <div class="alert-reason">${escapeHtml(alert.reason || "")}</div>
      <div class="alert-detail">${escapeHtml(alert.detail || "")}</div>
    </article>
  `;
}

function statusClass(status) {
  switch (status) {
    case "green":
      return "status-green";
    case "blue":
      return "status-blue";
    case "red":
      return "status-red";
    case "purple":
      return "status-purple";
    case "gray":
    default:
      return "status-gray";
  }
}

function formatZuluTimestamp(isoString) {
  if (!isoString) return "Unknown";

  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "Unknown";

  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hour = String(d.getUTCHours()).padStart(2, "0");
  const minute = String(d.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}Z`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}