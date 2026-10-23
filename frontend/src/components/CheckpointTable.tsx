import { RISK_COLORS, formatDayTime } from "../risk";
import type { Checkpoint, RouteOption } from "../types";

interface Props {
  route: RouteOption;
  onFocus: (cp: Checkpoint) => void;
}

export default function CheckpointTable({ route, onFocus }: Props) {
  return (
    <section className="checkpoints" aria-label={`${route.name} checkpoints`}>
      <h3>{route.name} checkpoints <span>({route.checkpoints.length})</span></h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mile</th>
              <th>ETA</th>
              <th>Wind</th>
              <th>Rain</th>
              <th>Snow</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {route.checkpoints.map((cp) => (
              <tr key={cp.mile} onClick={() => onFocus(cp)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onFocus(cp)}
                title={cp.drivers.length ? `Driven by ${cp.drivers.join(", ")}` : undefined}>
                <td>{cp.mile.toFixed(0)}</td>
                <td>{formatDayTime(cp.eta)}</td>
                <td>{cp.wind_mph.toFixed(0)} mph</td>
                <td>{cp.rain_in_hr.toFixed(2)}</td>
                <td>{cp.snow_in_hr.toFixed(2)}</td>
                <td>
                  <span className="chip" style={{ background: RISK_COLORS[cp.risk] }}>
                    {cp.risk}{cp.load_escalated ? " ⚖" : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Rain and snow in inches per hour. ⚖ = raised by the load-weight rules. Click a row to find it on the map.</p>
    </section>
  );
}
