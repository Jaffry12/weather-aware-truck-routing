import { useCallback, useEffect, useRef, useState } from "react";
import { planTrip } from "./api";
import CheckpointTable from "./components/CheckpointTable";
import ForecastSlider from "./components/ForecastSlider";
import LayerSwitch from "./components/LayerSwitch";
import MapView, { type WeatherLayer } from "./components/MapView";
import RouteCards, { WhyCallout } from "./components/RouteCards";
import TripForm from "./components/TripForm";
import { Logo, MoonIcon, SunIcon } from "./icons";
import { type Theme, applyTheme, initialTheme, savedTheme, saveTheme } from "./theme";
import type { Checkpoint, TripPlan, TripRequest } from "./types";

export default function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [places, setPlaces] = useState<{ origin: string; destination: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layer, setLayer] = useState<WeatherLayer>("risk");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ checkpoint: Checkpoint; key: number } | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const submit = useCallback(async (req: TripRequest) => {
    inflight.current?.abort();
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
      setHour(0);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (inflight.current === controller) setLoading(false);
    }
  }, []);

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

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    saveTheme(next);
    setTheme(next);
  };

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
          <button type="button" className="theme-toggle" onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}>
            {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
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
        <MapView plan={plan} places={places} selectedRouteId={selectedId} hour={hour} layer={layer} theme={theme}
          focus={focus} onSelectRoute={setSelectedId} />
        <LayerSwitch value={layer} onChange={setLayer} />
        {loading && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden />
            Fetching routes and forecasts…
          </div>
        )}
        {plan?.heatmap && (
          <ForecastSlider heatmap={plan.heatmap} departure={plan.departure} route={selected} hour={hour}
            playing={playing} onHour={setHour} onPlaying={setPlaying} />
        )}
        {plan && !plan.heatmap && (
          <div className="map-note">Corridor forecast unavailable: {plan.heatmap_error}</div>
        )}
      </main>
    </div>
  );
}
