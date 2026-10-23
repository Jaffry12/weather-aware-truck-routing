import { useCallback, useRef, useState } from "react";
import { planTrip } from "./api";
import CheckpointTable from "./components/CheckpointTable";
import ForecastSlider from "./components/ForecastSlider";
import MapView from "./components/MapView";
import RouteCards from "./components/RouteCards";
import TripForm from "./components/TripForm";
import type { Checkpoint, TripPlan, TripRequest } from "./types";

export default function App() {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
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
      setSelectedId(result.recommended_route_id);
      setHour(0);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (inflight.current === controller) setLoading(false);
    }
  }, []);

  const selected = plan?.routes.find((r) => r.id === selectedId);
  const onFocus = useCallback((checkpoint: Checkpoint) => setFocus({ checkpoint, key: Date.now() }), []);

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>Weather-Aware Truck Routing</h1>
          <p>Compare three routes by forecast weather risk at the truck's arrival time, then pick the safest.</p>
        </header>
        <TripForm loading={loading} onSubmit={submit} />
        {error && <div className="error" role="alert">{error}</div>}
        {plan && (
          <>
            <RouteCards routes={plan.routes} selectedId={selectedId} reason={plan.recommendation_reason}
              onSelect={setSelectedId} />
            {selected && <CheckpointTable route={selected} onFocus={onFocus} />}
            <details className="notes">
              <summary>How risk is calculated</summary>
              <ul>{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          </>
        )}
        <footer>
          Routes © OSRM · Weather © Open-Meteo · Places © Photon/OpenStreetMap · Map © CARTO, OpenStreetMap
        </footer>
      </aside>

      <main className="map-area">
        <MapView plan={plan} selectedRouteId={selectedId} hour={hour} focus={focus} onSelectRoute={setSelectedId} />
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
          <div className="empty-hint">Corridor heatmap unavailable: {plan.heatmap_error}</div>
        )}
        {!plan && !loading && (
          <div className="empty-hint">Enter a trip and press <b>Find safest route</b>.</div>
        )}
      </main>
    </div>
  );
}
