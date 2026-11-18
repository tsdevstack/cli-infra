/**
 * The time of a Container Apps log stream line. Azure writes it in UTC,
 * sometimes without a zone ("2026-11-10T12:00:00.12345") and sometimes in
 * Go's format ("2026-11-10 12:00:00 +0000 UTC"). Falls back to `now` when
 * the text isn't a time.
 */

export function parseAzureStreamTime(value: unknown, now: Date): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    return now;
  }
  let text = value.trim();

  // Go's time format: "2026-11-10 12:00:00.123 +0000 UTC"
  const go =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?) ([+-]\d{2})(\d{2})(?: \w+)?$/.exec(
      text,
    );
  if (go) {
    text = `${go[1]}T${go[2]}${go[3]}:${go[4]}`;
  } else if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(text)) {
    // No zone: Azure's times are UTC
    text = `${text}Z`;
  }

  // Date reads at most milliseconds
  text = text.replace(/(\.\d{3})\d+/, '$1');
  const time = new Date(text);
  return Number.isNaN(time.getTime()) ? now : time;
}
