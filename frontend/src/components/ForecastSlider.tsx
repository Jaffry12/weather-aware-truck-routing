import { useEffect } from "react";
import { PauseIcon, PlayIcon } from "../icons";
import { RISK_COLORS, RISK_LEVELS, formatFull } from "../risk";
import { hourTime } from "../routeMath";
import { type Timeline, useTimeline } from "../timeline";
import type { Heatmap, RouteOption } from "../types";

const HOURS_PER_SECOND = 2.4; // the full 48 hours plays in about 20 seconds

interface Props {
  heatmap: Heatmap;
  departure: string;
  route: RouteOption | undefined;
  timeline: Timeline;
  playing: boolean;
  onPlaying: (playing: boolean) => void;
}

export default function ForecastSlider({ heatmap, departure, route, timeline, playing, onPlaying }: Props) {
  const max = heatmap.hours - 1;
  const t = useTimeline(timeline);
  const hour = Math.floor(t);
  const ticks = Array.from({ length: Math.floor(max / 6) + 1 }, (_, i) => i * 6);

  // Playback runs on animation frames, so the trucks and the slider glide
  // instead of jumping an hour at a time. It stops at the end of the window.
  useEffect(() => {
    if (!playing) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (timeline.get() >= max) timeline.set(0);
    let clock = timeline.get();
    let shown = clock;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      if (timeline.get() !== shown) clock = timeline.get(); // the slider was dragged mid-play
      clock = Math.min(max, clock + ((now - last) / 1000) * HOURS_PER_SECOND);
      last = now;
      // With reduced motion, step a whole hour at a time instead of gliding.
      shown = reduceMotion ? Math.floor(clock) : clock;
      timeline.set(shown);
      if (clock >= max) {
        onPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, max, timeline, onPlaying]);

  // The part of the window when the selected truck is on the road.
  const start = new Date(heatmap.start).getTime();
  const depart = (new Date(departure).getTime() - start) / 3600_000;
  const arrive = route ? (new Date(route.arrival).getTime() - start) / 3600_000 : depart;
  // Fraction of the slider, matched to where the 20 px thumb's centre sits.
  const frac = (h: number) => Math.min(Math.max(h, 0), max) / max;
  const at = (h: number) => `calc(10px + (100% - 20px) * ${frac(h)})`;

  const step = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = { ArrowRight: hour + 1, ArrowUp: hour + 1, ArrowLeft: Math.ceil(t) - 1, ArrowDown: Math.ceil(t) - 1,
      Home: 0, End: max }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    timeline.set(Math.min(max, Math.max(0, next)));
  };

  return (
    <div className="forecast" role="group" aria-label="Forecast time">
      <div className="forecast-top">
        <button type="button" className="play" onClick={() => onPlaying(!playing)}
          aria-label={playing ? "Pause forecast animation" : "Play forecast animation"}>
          {playing ? <PauseIcon size={22} /> : <PlayIcon size={24} />}
        </button>
        <div className="forecast-label" aria-live="off">
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
          <span className="track-progress" style={{ width: at(t) }} />
          <span className="trip-window" title={`${route?.name ?? "Truck"} on the road`}
            style={{ left: at(depart), width: `calc((100% - 20px) * ${frac(arrive) - frac(depart)})` }} />
          {ticks.map((h) => <span key={h} className="tick" style={{ left: at(h) }} />)}
          <input type="range" min={0} max={max} step="any" value={t}
            onChange={(e) => timeline.set(Number(e.target.value))} onKeyDown={step}
            aria-label="Hours after departure"
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
