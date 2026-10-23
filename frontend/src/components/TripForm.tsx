import { useState } from "react";
import type { Place, TripRequest } from "../types";
import PlaceInput from "./PlaceInput";

const EXAMPLES: { name: string; origin: Place; destination: Place }[] = [
  {
    name: "Chicago → Denver",
    origin: { label: "Chicago, Illinois, United States", lat: 41.8781, lon: -87.6298 },
    destination: { label: "Denver, Colorado, United States", lat: 39.7392, lon: -104.9903 },
  },
  {
    // I-80 across Wyoming is one of the windiest truck corridors in the US.
    name: "Denver → Salt Lake City",
    origin: { label: "Denver, Colorado, United States", lat: 39.7392, lon: -104.9903 },
    destination: { label: "Salt Lake City, Utah, United States", lat: 40.7608, lon: -111.891 },
  },
  {
    name: "Dallas → Atlanta",
    origin: { label: "Dallas, Texas, United States", lat: 32.7767, lon: -96.797 },
    destination: { label: "Atlanta, Georgia, United States", lat: 33.749, lon: -84.388 },
  },
];

const INTERVALS = [10, 25, 50] as const;

function defaultDeparture(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface Props {
  loading: boolean;
  onSubmit: (req: TripRequest) => void;
}

export default function TripForm({ loading, onSubmit }: Props) {
  const [origin, setOrigin] = useState<Place | null>(EXAMPLES[0].origin);
  const [destination, setDestination] = useState<Place | null>(EXAMPLES[0].destination);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [load, setLoad] = useState("42000");
  const [interval, setIntervalMiles] = useState<10 | 25 | 50>(25);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const loadLbs = Number(load);
    if (!origin || !destination) return setError("Pick both places from the suggestions.");
    if (!Number.isFinite(loadLbs) || loadLbs < 0) return setError("Enter the load weight in pounds.");
    if (!departure) return setError("Choose a departure time.");
    setError(null);
    onSubmit({
      origin,
      destination,
      departure: new Date(departure).toISOString(),
      load_lbs: Math.round(loadLbs),
      interval_miles: interval,
    });
  };

  return (
    <form className="trip-form" onSubmit={submit}>
      <PlaceInput label="Origin" value={origin} onChange={setOrigin} placeholder="City, address or depot" />
      <PlaceInput label="Destination" value={destination} onChange={setDestination} placeholder="City, address or depot" />

      <div className="row">
        <div className="field">
          <label htmlFor="departure">Departure</label>
          <input id="departure" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="load">Load weight (lb)</label>
          <input id="load" type="number" min={0} max={200000} step={500} inputMode="numeric" value={load}
            onChange={(e) => setLoad(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <span className="label">Weather checkpoints every</span>
        <div className="segmented" role="radiogroup" aria-label="Checkpoint interval">
          {INTERVALS.map((miles) => (
            <button key={miles} type="button" role="radio" aria-checked={interval === miles}
              className={interval === miles ? "on" : ""} onClick={() => setIntervalMiles(miles)}>
              {miles} mi
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <button className="primary" type="submit" disabled={loading}>
        {loading ? "Planning…" : "Find safest route"}
      </button>

      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.name} type="button" className="link" onClick={() => {
            setOrigin(ex.origin);
            setDestination(ex.destination);
          }}>
            {ex.name}
          </button>
        ))}
      </div>
    </form>
  );
}
