/**
 * Convert Unix cron expression to AWS EventBridge schedule expression
 *
 * Unix cron: minute hour day month weekday (5 fields)
 * EventBridge: cron(minute hour day month weekday year) (6 fields)
 *
 * Key differences:
 * - EventBridge requires a year field (use * for any year)
 * - Day-of-month and day-of-week cannot both be * (use ? for "no specific value")
 */

export function convertCronToEventBridge(cronExpression: string): string {
  // If already in EventBridge format, return as-is
  if (
    cronExpression.startsWith('cron(') ||
    cronExpression.startsWith('rate(')
  ) {
    return cronExpression;
  }

  const parts = cronExpression.trim().split(/\s+/);

  if (parts.length !== 5) {
    // Return as-is if not standard 5-field cron
    return `cron(${cronExpression} *)`;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // EventBridge doesn't allow both day-of-month and day-of-week to be *
  // Use ? for "no specific value"
  let ebDayOfMonth = dayOfMonth;
  let ebDayOfWeek = dayOfWeek;

  if (dayOfMonth === '*' && dayOfWeek === '*') {
    // If both are wildcards, use ? for day-of-week
    ebDayOfWeek = '?';
  } else if (dayOfMonth !== '*' && dayOfWeek === '*') {
    // If day-of-month is specific, use ? for day-of-week
    ebDayOfWeek = '?';
  } else if (dayOfMonth === '*' && dayOfWeek !== '*') {
    // If day-of-week is specific, use ? for day-of-month
    ebDayOfMonth = '?';
  }

  return `cron(${minute} ${hour} ${ebDayOfMonth} ${month} ${ebDayOfWeek} *)`;
}
