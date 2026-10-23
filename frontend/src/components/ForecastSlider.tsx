import { useEffect } from "react";
import { PauseIcon, PlayIcon } from "../icons";
import { RISK_COLORS, RISK_LEVELS, formatFull } from "../risk";
import { hourTime } from "../routeMath";
import type { Heatmap, RouteOption } from "../types";

interface Props {
  heatmap: Heatmap;
  departure: string;
  route: RouteOption | undefined;
  hour: number;
  playing: boolean;
  onHour: (hour: number) => void;
  onPlaying: (playing: boolean) => void;
}

export default function ForecastSlider({ heatmap, departure, route, hour, playing, onHour, onPlaying }: Props) {
  const max = heatmap.hours - 1;
  const ticks = Array.from({ length: Math.floor(max / 6) + 1 }, (_, i) => i * 6);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => onHour(hour >= max ? 0 : hour + 1), 450);
    return () => window.clearInterval(timer);
  }, [playing, hour, max, onHour]);

  // The part of the window when the selected truck is on the road.
  const start = new Date(heatmap.start).getTime();
  const depart = (new Date(departure).getTime() - start) / 3600_000;
  const arrive = route ? (new Date(route.arrival).getTime() - start) / 3600_000 : depart;
  // Fraction of the slider, matched to where the 20 px thumb's centre sits.
  const frac = (h: number) => Math.min(Math.max(h, 0), max) / max;
  const at = (h: number) => `calc(10px + (100% - 20px) * ${frac(h)})`;

  return (
    <div className="forecast" role="group" aria-label="Forecast time">
      <div className="forecast-top">
        <button type="button" className="play" onClick={() => onPlaying(!playing)}
          aria-label={playing ? "Pause forecast animation" : "Play forecast animation"}>
          {playing ? <PauseIcon size={22} /> : <PlayIcon size={24} />}
        </button>
        <div className="forecast-label" aria-live="polite">
          <strong>+{hour} h</strong>
          <span className="sep">•</span>
          {formatFull(hourTime(heatmap, hour))}
        </div>
        <ul className="legend" aria-label="Risk legend">
          {RISK_LEVELS.map((level) => (
            <li key={level}><span style={{ background: RISK_COLORS[level] }} />{level}</li>
          ))}
        </ul>
      </div>
      <div className="timeline">
        <div className="track">
          <span className="track-progress" style={{ width: at(hour) }} />
          <span className="trip-window" title={`${route?.name ?? "Truck"} on the road`}
            style={{ left: at(depart), width: `calc((100% - 20px) * ${frac(arrive) - frac(depart)})` }} />
          {ticks.map((h) => <span key={h} className="tick" style={{ left: at(h) }} />)}
          <input type="range" min={0} max={max} step={1} value={hour}
            onChange={(e) => onHour(Number(e.target.value))} aria-label="Hours after departure"
            aria-valuetext={`${hour} hours after departure, ${formatFull(hourTime(heatmap, hour))}`} />
        </div>
        <div className="tick-labels" aria-hidden>
          {ticks.map((h) => (
            <span key={h} className={h % 12 ? "minor" : ""} style={{ left: at(h) }}>{h} h</span>
          ))}
        </div>
      </div>
    </div>
  );
}
