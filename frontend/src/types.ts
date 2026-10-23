export type RiskLabel = "Low" | "Moderate" | "High" | "Severe" | "No Travel";

export interface Place {
  label: string;
  lat: number;
  lon: number;
}

export interface Checkpoint {
  mile: number;
  lon: number;
  lat: number;
  eta: string;
  wind_mph: number;
  rain_in_hr: number;
  snow_in_hr: number;
  risk: RiskLabel;
  risk_level: number;
  wind_risk: RiskLabel;
  rain_risk: RiskLabel;
  snow_risk: RiskLabel;
  load_escalated: boolean;
  drivers: string[];
  miles_covered: number;
}

export interface RouteOption {
  id: string;
  name: string;
  summary: string;
  is_recommended: boolean;
  distance_miles: number;
  duration_minutes: number;
  arrival: string;
  average_risk: number;
  max_risk: RiskLabel;
  miles_by_level: Record<RiskLabel, number>;
  geometry: [number, number][];
  geometry_seconds: number[];
  checkpoints: Checkpoint[];
}

export interface Heatmap {
  start: string;
  hours: number;
  /** Distance between neighbouring sample points; sizes the drawn risk discs. */
  spacing_miles: number;
  points: [number, number][];
  /** levels[hour][point]: overall risk level 0-4 (Low … No Travel). */
  levels: number[][];
  /** Wind risk after the load rules, same shape. */
  wind_levels: number[][];
  /** Worse of rain and snow risk, same shape. */
  precip_levels: number[][];
}

export interface TripPlan {
  departure: string;
  load_lbs: number;
  interval_miles: number;
  recommended_route_id: string;
  recommendation_reason: string;
  routes: RouteOption[];
  /** Null when the forecast service couldn't supply the corridor (see heatmap_error). */
  heatmap: Heatmap | null;
  heatmap_error: string | null;
  notes: string[];
}

export interface TripRequest {
  origin: Place;
  destination: Place;
  departure: string;
  load_lbs: number;
  interval_miles: 10 | 25 | 50;
}
