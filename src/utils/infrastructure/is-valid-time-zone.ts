/**
 * Whether a name is an IANA time zone ("Europe/Budapest", "UTC"), as the
 * JavaScript runtime's time zone database knows it
 */
export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
