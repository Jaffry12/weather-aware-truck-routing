import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, CalendarIcon, InfoIcon, SearchIcon, SwapIcon, TruckIcon } from "../icons";
import { formatDeparture } from "../risk";
import type { Place, TripRequest } from "../types";
import PlaceInput from "./PlaceInput";

// I-80 across Wyoming is one of the windiest truck corridors in the US, so this
// default trip usually shows the risk logic at work.
const DEFAULT_ORIGIN: Place = { label: "Denver, Colorado, United States", lat: 39.7392, lon: -104.9903 };
const DEFAULT_DESTINATION: Place = { label: "Salt Lake City, Utah, United States", lat: 40.7608, lon: -111.891 };

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
  const [origin, setOrigin] = useState<Place | null>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<Place | null>(DEFAULT_DESTINATION);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [load, setLoad] = useState("42000");
  const [loadFocused, setLoadFocused] = useState(false);
  const [interval, setIntervalMiles] = useState<10 | 25 | 50>(25);
  const [error, setError] = useState<string | null>(null);

  const request = (): TripRequest | string => {
    const loadLbs = Number(load);
    if (!origin || !destination) return "Pick both places from the suggestions.";
    if (!load || !Number.isFinite(loadLbs)) return "Enter the load weight in pounds.";
    if (!departure) return "Choose a departure time.";
    return {
      origin,
      destination,
      departure: new Date(departure).toISOString(),
      load_lbs: Math.round(loadLbs),
      interval_miles: interval,
    };
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const req = request();
    if (typeof req === "string") return setError(req);
    setError(null);
    onSubmit(req);
  };

  // Plan the default trip once on arrival, so the first screen shows real results.
  const autoPlanned = useRef(false);
  useEffect(() => {
    if (autoPlanned.current) return;
    autoPlanned.current = true;
    const req = request();
    if (typeof req !== "string") onSubmit(req);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once with the defaults
  }, []);

  const swap = () => {
    setOrigin(destination);
    setDestination(origin);
  };

  return (
    <form className="card trip-form" onSubmit={submit}>
      <div className="od-row">
        <PlaceInput label="Origin" value={origin} onChange={setOrigin} placeholder="City or address" />
        <button type="button" className="swap" onClick={swap} aria-label="Swap origin and destination"
          title="Swap origin and destination">
          <SwapIcon size={18} />
        </button>
        <PlaceInput label="Destination" value={destination} onChange={setDestination} placeholder="City or address"
          align="end" />
      </div>

      <div className="two-col">
        <div className="field">
          <label htmlFor="departure">Departure</label>
          <div className="input-shell">
            <CalendarIcon className="input-icon" />
            <span className="input-text">{departure ? formatDeparture(departure) : "Choose a time"}</span>
            {/* The native picker sits invisibly on top of the formatted text. */}
            <input id="departure" type="datetime-local" className="ghost-input" value={departure}
              onChange={(e) => setDeparture(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker();
                } catch {
                  // Older browsers: the input still accepts typing.
                }
              }} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="load">Load weight</label>
          <div className="input-shell">
            <TruckIcon className="input-icon" />
            <input id="load" inputMode="numeric" autoComplete="off"
              value={loadFocused || !load ? load : `${Number(load).toLocaleString("en-US")} lb`}
              onFocus={() => setLoadFocused(true)}
              onBlur={() => setLoadFocused(false)}
              onChange={(e) => setLoad(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </div>
        </div>
      </div>

      <div className="interval-row">
        <span className="label" id="interval-label">
          Checkpoints every
          <span className="info" title="Weather is checked at each checkpoint for the moment the truck gets there.">
            <InfoIcon size={15} />
          </span>
        </span>
        <div className="segmented" role="radiogroup" aria-labelledby="interval-label">
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
        <SearchIcon size={18} />
        {loading ? "Planning…" : "Find safest route"}
        {!loading && <ArrowRightIcon size={18} />}
      </button>
    </form>
  );
}
