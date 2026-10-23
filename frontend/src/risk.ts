import type { RiskLabel } from "./types";

export const RISK_LEVELS: RiskLabel[] = ["Low", "Moderate", "High", "Severe", "No Travel"];

export const RISK_COLORS: Record<RiskLabel, string> = {
  Low: "#16a34a",
  Moderate: "#eab308",
  High: "#f97316",
  Severe: "#dc2626",
  "No Travel": "#7e22ce",
};

export const riskColorByLevel = (level: number): string => RISK_COLORS[RISK_LEVELS[level] ?? "Low"];

const dayTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});
const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export const formatDayTime = (iso: string | Date): string => dayTime.format(new Date(iso));
export const formatFull = (iso: string | Date): string => fullDate.format(new Date(iso));

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

export const formatMiles = (miles: number): string =>
  `${miles.toLocaleString(undefined, { maximumFractionDigits: miles < 10 ? 1 : 0 })} mi`;
