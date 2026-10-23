import { RISK_COLORS, RISK_LEVELS, formatDayTime, formatDuration, formatMiles } from "../risk";
import type { RouteOption } from "../types";

interface Props {
  routes: RouteOption[];
  selectedId: string | null;
  reason: string;
  onSelect: (id: string) => void;
}

export default function RouteCards({ routes, selectedId, reason, onSelect }: Props) {
  return (
    <section className="route-cards" aria-label="Route options">
      {routes.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`route-card${r.id === selectedId ? " selected" : ""}${r.is_recommended ? " recommended" : ""}`}
          onClick={() => onSelect(r.id)}
          aria-pressed={r.id === selectedId}
        >
          <div className="route-card-head">
            <strong>{r.name}</strong>
            {r.is_recommended && <span className="badge">★ Recommended</span>}
            <span className="route-via">{r.summary && `via ${r.summary}`}</span>
          </div>
          <div className="route-stats">
            <span><b>{formatDuration(r.duration_minutes)}</b></span>
            <span>{formatMiles(r.distance_miles)}</span>
            <span>arrive {formatDayTime(r.arrival)}</span>
          </div>
          <RiskBar route={r} />
          <div className="route-risk-line">
            <span>
              Severe <b>{formatMiles(r.miles_by_level.Severe + r.miles_by_level["No Travel"])}</b>
            </span>
            <span>High <b>{formatMiles(r.miles_by_level.High)}</b></span>
            <span>Avg risk <b>{r.average_risk.toFixed(2)}</b></span>
          </div>
          {r.miles_by_level["No Travel"] > 0 && (
            <div className="warning">⚠ {formatMiles(r.miles_by_level["No Travel"])} in No Travel conditions</div>
          )}
        </button>
      ))}
      <p className="reason"><strong>Why:</strong> {reason}</p>
    </section>
  );
}

function RiskBar({ route }: { route: RouteOption }) {
  const total = route.distance_miles || 1;
  return (
    <div className="risk-bar" role="img"
      aria-label={RISK_LEVELS.map((l) => `${l} ${route.miles_by_level[l]} miles`).join(", ")}>
      {RISK_LEVELS.map((level) => {
        const miles = route.miles_by_level[level];
        return miles > 0 ? (
          <span key={level} style={{ width: `${(miles / total) * 100}%`, background: RISK_COLORS[level] }}
            title={`${level}: ${formatMiles(miles)}`} />
        ) : null;
      })}
    </div>
  );
}
