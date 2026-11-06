/**
 * Link to the same query in the Logs Explorer:
 * https://console.cloud.google.com/logs/query;query=...;timeRange=START%2FEND?project=...
 *
 * Escaping and time format follow what the console reads (as in the
 * gcplogurl library): letters, digits and -_.~$&+,:@ stay as they are,
 * everything else is percent-encoded; times are UTC to the second.
 */

export function buildGcpLogsExplorerUrl(
  projectId: string,
  filter: string,
  since: Date,
  until: Date,
): string {
  const encode = (value: string): string =>
    encodeURIComponent(value)
      .replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      )
      .replace(/%(24|26|2B|2C|3A|40)/g, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );

  // Whole seconds; the end rounds up so the last lines stay in the window
  const toSeconds = (date: Date): string =>
    date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const start = toSeconds(since);
  const end = toSeconds(new Date(Math.ceil(until.getTime() / 1000) * 1000));

  return (
    'https://console.cloud.google.com/logs/query' +
    `;query=${encode(filter)}` +
    `;timeRange=${encode(`${start}/${end}`)}` +
    `?project=${encode(projectId)}`
  );
}
