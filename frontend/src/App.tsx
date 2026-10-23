import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planTrip } from "./api";
import CheckpointTable from "./components/CheckpointTable";
import ForecastSlider from "./components/ForecastSlider";
import LayerSwitch from "./components/LayerSwitch";
import MapView, { type WeatherLayer } from "./components/MapView";
import RouteCards, { WhyCallout } from "./components/RouteCards";
import TripForm from "./components/TripForm";
import { Logo } from "./icons";
import { type Theme, applyTheme, initialTheme, savedTheme, saveTheme } from "./theme";
import { createTimeline } from "./timeline";
import type { Checkpoint, TripPlan, TripRequest } from "./types";

const HEATMAP_RETRY_MS = 25_000;

export default function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [places, setPlaces] = useState<{ origin: string; destination: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timeline = useMemo(createTimeline, []);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<WeatherLayer>("risk");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ checkpoint: Checkpoint; key: number } | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const refillTimer = useRef<number | undefined>(undefined);

  const submit = useCallback(async (req: TripRequest) => {
    inflight.current?.abort();
    window.clearTimeout(refillTimer.current);
    const controller = new AbortController();
    inflight.current = controller;
    setLoading(true);
    setError(null);
    setPlaying(false);
    try {
      const result = await planTrip(req, controller.signal);
      setPlan(result);
      setPlaces({ origin: req.origin.label, destination: req.destination.label });
      setSelectedId(result.recommended_route_id);
      timeline.set(0);
      // A throttled heatmap is fetched again shortly; the checkpoint forecasts are
      // cached by then, so the second request only asks for the corridor points.
      if (!result.heatmap && result.heatmap_error?.includes("busy")) {
        refillTimer.current = window.setTimeout(async () => {
          try {
            const again = await planTrip(req, controller.signal);
            if (again.heatmap) setPlan((current) => current && { ...current, heatmap: again.heatmap, heatmap_error: null });
          } catch {
            // Keep the routes; the note on the map stays.
          }
        }, HEATMAP_RETRY_MS);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (inflight.current === controller) setLoading(false);
    }
  }, [timeline]);

  useEffect(() => applyTheme(theme), [theme]);

  // Follow the system setting until the user picks a theme themselves.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => {
      if (!savedTheme()) setTheme(e.matches ? "dark" : "light");
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);

  const selected = plan?.routes.find((r) => r.id === selectedId);
  const onFocus = useCallback((checkpoint: Checkpoint) => setFocus({ checkpoint, key: Date.now() }), []);

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <Logo />
          <div className="brand-text">
            <h1>Weather-Aware Truck Routing</h1>
            <p>Compare routes by weather risk at the truck's arrival time</p>
          </div>
        </header>

        <TripForm loading={loading} onSubmit={submit} />
        {error && <div className="error" role="alert">{error}</div>}

        {plan && (
          <>
            <RouteCards routes={plan.routes} selectedId={selectedId} onSelect={setSelectedId} />
            <WhyCallout reason={plan.recommendation_reason} />
            {selected && <CheckpointTable key={selected.id} route={selected} onFocus={onFocus} />}
            <details className="notes">
              <summary>How risk is calculated</summary>
              <ul>{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          </>
        )}
        <footer>
          Routes © OSRM · Weather © Open-Meteo · Places © Photon · Map © OpenFreeMap, OpenMapTiles, OpenStreetMap
        </footer>
      </aside>

      <main className="map-area">
        <MapView plan={plan} places={places} selectedRouteId={selectedId} timeline={timeline} layer={layer}
          theme={theme} focus={focus} onSelectRoute={setSelectedId} onToggleTheme={toggleTheme} />
        <LayerSwitch value={layer} onChange={setLayer} />
        {loading && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden />
            Fetching routes and forecasts…
          </div>
        )}
        {plan?.heatmap && (
          <ForecastSlider heatmap={plan.heatmap} departure={plan.departure} route={selected} timeline={timeline}
            playing={playing} onPlaying={setPlaying} />
        )}
        {plan && !plan.heatmap && (
          <div className="map-note">
            {plan.heatmap_error?.includes("busy")
              ? "The free weather service is busy, so the corridor heatmap will load in a few seconds."
              : `Corridor forecast unavailable: ${plan.heatmap_error}`}
          </div>
        )}
      </main>
    </div>
  );
}
