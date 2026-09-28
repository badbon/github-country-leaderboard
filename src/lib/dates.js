const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function monthsAgo(date, months) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

export function midpointDate(start, end) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return formatDate(new Date(startMs + Math.floor((endMs - startMs) / 2)));
}

export function nextDate(date) {
  return formatDate(new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS));
}

export function previousDate(date) {
  return formatDate(new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS));
}

export function canSplitDateRange(start, end) {
  return Date.parse(start) < Date.parse(end);
}

export function rollingContributionWindow(now = new Date()) {
  const to = now.toISOString();
  const from = new Date(now.getTime());
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { from: from.toISOString(), to };
}
