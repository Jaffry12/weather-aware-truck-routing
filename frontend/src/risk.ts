import type { RiskLabel } from "./types";

export const RISK_LEVELS: RiskLabel[] = ["Low", "Moderate", "High", "Severe", "No Travel"];

/** Fill colours for map marks, bars and legend dots. */
export const RISK_COLORS: Record<RiskLabel, string> = {
  Low: "#16a34a",
  Moderate: "#eab308",
  High: "#f97316",
  Severe: "#dc2626",
  "No Travel": "#7e22ce",
};

/** Darker shades of the same hues, readable as text on white. */
export const RISK_TEXT: Record<RiskLabel, string> = {
  Low: "#15803d",
  Moderate: "#ca8a04",
  High: "#ea580c",
  Severe: "#dc2626",
  "No Travel": "#7e22ce",
};

/** Pale backgrounds for risk chips. */
export const RISK_TINTS: Record<RiskLabel, string> = {
  Low: "#dcfce7",
  Moderate: "#fef9c3",
  High: "#ffedd5",
  Severe: "#fee2e2",
  "No Travel": "#f3e8ff",
};

export const riskLabel = (level: number): RiskLabel => RISK_LEVELS[level] ?? "Low";

// US English throughout, matching the US road network the app plans on.
const dayTime = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
const fullDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dayDate = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** "Sat 4:10 AM" */
export const formatDayTime = (iso: string | Date): string => dayTime.format(new Date(iso));
/** "Sat, Oct 24, 12:00 PM" */
export const formatFull = (iso: string | Date): string => fullDate.format(new Date(iso));
/** "Fri, Oct 24 · 6:00 AM" */
export const formatDeparture = (iso: string | Date): string =>
  `${dayDate.format(new Date(iso))} · ${clock.format(new Date(iso))}`;

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export const formatMiles = (miles: number): string =>
  `${miles.toLocaleString("en-US", { maximumFractionDigits: miles < 10 ? 1 : 0 })} mi`;

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
  Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
  Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
  Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
};

/** "Denver, Colorado, United States" → "Denver, CO"; other labels are left as they are. */
export function shortPlace(label: string): string {
  const parts = label.split(",").map((p) => p.trim());
  if (parts[parts.length - 1] !== "United States" || parts.length < 3) return label;
  const state = US_STATES[parts[parts.length - 2]];
  return state ? `${parts.slice(0, -2).join(", ")}, ${state}` : parts.slice(0, -1).join(", ");
}

/** "Denver, Colorado, United States" → "Denver" (for map pins). */
export const placeName = (label: string): string => label.split(",")[0].trim();
