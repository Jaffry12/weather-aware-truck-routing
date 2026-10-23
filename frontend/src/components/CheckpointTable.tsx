import { useState } from "react";
import { formatDayTime } from "../risk";
import type { Checkpoint, RouteOption } from "../types";

const PREVIEW_ROWS = 6;

interface Props {
  route: RouteOption;
  onFocus: (cp: Checkpoint) => void;
}

export default function CheckpointTable({ route, onFocus }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? route.checkpoints : route.checkpoints.slice(0, PREVIEW_ROWS);

  return (
    <section className="card checkpoints" aria-label={`${route.name} checkpoints`}>
      <div className="section-head">
        <h2>{route.name} checkpoints</h2>
        {route.checkpoints.length > PREVIEW_ROWS && (
          <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : `View all ${route.checkpoints.length}`}
          </button>
        )}
      </div>
      <div className={`table-wrap${expanded ? " expanded" : ""}`}>
        <table>
          <thead>
            <tr>
              <th>Mile</th>
              <th>ETA</th>
              <th>Wind</th>
              <th title="inches per hour">Rain</th>
              <th title="inches per hour">Snow</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cp) => (
              <tr key={cp.mile} onClick={() => onFocus(cp)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onFocus(cp)}
                title={cp.drivers.length ? `Driven by ${cp.drivers.join(", ")}. Click to show on the map.` :
                  "Click to show on the map."}>
                <td>{cp.mile.toFixed(0)}</td>
                <td>{formatDayTime(cp.eta)}</td>
                <td>{cp.wind_mph.toFixed(0)} mph</td>
                <td>{cp.rain_in_hr.toFixed(2)}</td>
                <td>{cp.snow_in_hr.toFixed(2)}</td>
                <td>
                  <span className={`chip risk-chip-${cp.risk_level}`}>
                    {cp.risk}
                    {cp.load_escalated && <span title="Raised by the load-weight rules"> ⚖</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
