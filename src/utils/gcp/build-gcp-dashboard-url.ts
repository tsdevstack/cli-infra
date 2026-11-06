/**
 * Console link of an environment's Cloud Monitoring dashboard
 */
export function buildGcpDashboardUrl(
  dashboardId: string,
  projectId: string,
): string {
  return `https://console.cloud.google.com/monitoring/dashboards/builder/${encodeURIComponent(dashboardId)}?project=${encodeURIComponent(projectId)}`;
}
