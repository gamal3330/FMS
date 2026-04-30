const DEFAULT_TIMEZONE = "Asia/Qatar";

export function getSystemTimezone() {
  return localStorage.getItem("qib_timezone") || DEFAULT_TIMEZONE;
}

export function parseApiDate(value?: string | null) {
  if (!value) return null;
  const normalizedValue = /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalizedValue);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatSystemDateTime(value?: string | null, timezone?: string) {
  const date = parseApiDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ar-QA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone || getSystemTimezone()
  }).format(date);
}

export function formatSystemDate(value?: string | null, timezone?: string) {
  const date = parseApiDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("ar-QA", {
    dateStyle: "medium",
    timeZone: timezone || getSystemTimezone()
  }).format(date);
}
