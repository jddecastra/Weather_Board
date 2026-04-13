import { renderDashboard, renderErrorState } from "./render.js";
import { scheduleAlignedRefresh } from "./refresh.js";

const DASHBOARD_ENDPOINT = "/api/dashboard-data";

async function loadDashboard() {
  try {
    const response = await fetch(DASHBOARD_ENDPOINT, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Dashboard request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    renderDashboard(data);
  } catch (error) {
    console.error("loadDashboard error:", error);
    renderErrorState(error instanceof Error ? error.message : String(error));
  }
}

await loadDashboard();

scheduleAlignedRefresh({
  intervalMinutes: 5,
  onRefresh: loadDashboard
});