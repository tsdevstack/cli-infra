/**
 * Console link of an environment's CloudWatch dashboard
 */
export function buildAwsDashboardUrl(
  dashboardName: string,
  region: string,
): string {
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards/dashboard/${encodeURIComponent(dashboardName)}`;
}
