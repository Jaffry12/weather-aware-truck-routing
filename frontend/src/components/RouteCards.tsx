import { ShieldCheckIcon, StarIcon } from "../icons";
import { RISK_COLORS, RISK_LEVELS, formatDayTime, formatDuration, formatMiles, riskLabel } from "../risk";
import type { RouteOption } from "../types";

interface Props {
  routes: RouteOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function RouteCards({ routes, selectedId, onSelect }: Props) {
  return (
    <section className="routes">
      <div className="section-head">
        <h2>Route options</h2>
        <span>{routes.length} {routes.length === 1 ? "route" : "routes"} found</span>
      </div>
      {routes.length < 3 && (
        <p className="routes-note">The road network offers no other reasonable route between these places.</p>
      )}
      <div className="route-list" role="radiogroup" aria-label="Route options">
        {routes.map((r) => {
          const worst = worstLevel(r);
          return (
            <button key={r.id} type="button" role="radio" aria-checked={r.id === selectedId}
              className={`route-card${r.id === selectedId ? " selected" : ""}`} onClick={() => onSelect(r.id)}>
              <span className="radio" aria-hidden />
              <span className="route-body">
                <span className="route-title">
                  <strong>{r.name}</strong>
                  {r.is_recommended && (
                    <span className="badge"><StarIcon size={12} /> Recommended</span>
                  )}
                </span>
                {r.summary && <span className="route-via">via {r.summary}</span>}
                <span className="route-meta">
                  <span>
                    {formatDuration(r.duration_minutes)} · {formatMiles(r.distance_miles)} · arrives{" "}
                    {formatDayTime(r.arrival)}
                  </span>
                  {worst && (
                    <span className="route-worst">
                      <span className={`risk-text-${RISK_LEVELS.indexOf(worst)}`}>{worst}</span>{" "}
                      {formatMiles(r.miles_by_level[worst])}
                    </span>
                  )}
                </span>
                <RiskStrip route={r} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function WhyCallout({ reason }: { reason: string }) {
  return (
    <aside className="why">
      <ShieldCheckIcon />
      <div>
        <h3>Why this route?</h3>
        <p>{reason}</p>
      </div>
    </aside>
  );
}

/** The most severe level the route reaches, if it is worse than Low. */
function worstLevel(route: RouteOption) {
  return [...RISK_LEVELS].reverse().find((level) => level !== "Low" && route.miles_by_level[level] > 0);
}

/** Risk along the route from origin to destination, so you can see where the bad stretch is. */
function RiskStrip({ route }: { route: RouteOption }) {
  const total = route.distance_miles || 1;
  const runs: { level: number; miles: number }[] = [];
  for (const cp of route.checkpoints) {
    const last = runs[runs.length - 1];
    if (last && last.level === cp.risk_level) last.miles += cp.miles_covered;
    else runs.push({ level: cp.risk_level, miles: cp.miles_covered });
  }
  return (
    <span className="risk-strip" role="img"
      aria-label={RISK_LEVELS.map((l) => `${l} ${formatMiles(route.miles_by_level[l])}`).join(", ")}>
      {runs.map((run, i) => (
        <span key={i} style={{ width: `${(run.miles / total) * 100}%`, background: RISK_COLORS[riskLabel(run.level)] }}
          title={`${riskLabel(run.level)}: ${formatMiles(run.miles)}`} />
      ))}
    </span>
  );
}
