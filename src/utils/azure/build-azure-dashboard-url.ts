/**
 * Portal link of an environment's workbook (its dashboard)
 */
export function buildAzureDashboardUrl(workbookId: string): string {
  return `https://portal.azure.com/#resource${workbookId}/workbook`;
}
