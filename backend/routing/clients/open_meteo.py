"""Open-Meteo hourly forecast client.

Many locations are fetched per request (Open-Meteo accepts comma-separated
coordinates), and chunks run in parallel, so a whole trip corridor costs only
a handful of HTTP calls.

The free tier counts every location as one API call (600 a minute), so each
location is cached on its own: coordinates are snapped to a 0.05° grid (about
3 miles, finer than the forecast models) and forecasts are kept per location
for whole UTC days. Re-planning a trip with another load or interval, or a new
trip across the same area, only asks for locations not seen recently.
"""

from __future__ import annotations

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from django.conf import settings
from django.core.cache import cache

from .http import UpstreamError, get_json

CHUNK_SIZE = 100
FORECAST_TTL_SECONDS = 20 * 60
MAX_FORECAST_DAYS = 15
SNAP_DEGREES = 0.05
MIN_WINDOW_HOURS = 49  # every lookup covers the heatmap's window, so all callers share cache entries


@dataclass(frozen=True)
class HourlySeries:
    """Hourly values for one location. `start` is the UTC time of index 0."""

    start: datetime
    wind_mph: list[float]
    rain_in: list[float]
    snow_in: list[float]

    def at(self, when: datetime) -> tuple[float, float, float]:
        """Linearly interpolate (wind, rain, snow) at `when`, clamped to the series."""
        hours = (when - self.start).total_seconds() / 3600
        last = len(self.wind_mph) - 1
        hours = max(0.0, min(float(last), hours))
        i = min(int(hours), max(last - 1, 0))
        t = hours - i if last > 0 else 0.0

        def lerp(values: list[float]) -> float:
            if last == 0:
                return values[0]
            return values[i] + (values[i + 1] - values[i]) * t

        return lerp(self.wind_mph), lerp(self.rain_in), lerp(self.snow_in)

    def window(self, start: datetime, hours: int) -> HourlySeries:
        i = int((start - self.start).total_seconds() // 3600)
        return HourlySeries(start=start, wind_mph=self.wind_mph[i:i + hours], rain_in=self.rain_in[i:i + hours],
                            snow_in=self.snow_in[i:i + hours])


def floor_hour(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def snap(point: tuple[float, float], degrees: float = SNAP_DEGREES) -> tuple[float, float]:
    """Round a (lon, lat) point to the forecast lookup grid."""
    lon, lat = point
    return round(round(lon / degrees) * degrees, 4), round(round(lat / degrees) * degrees, 4)


def hourly(points: Sequence[tuple[float, float]], start: datetime, hours: int) -> list[HourlySeries]:
    """Forecast `hours` hourly steps from `start` (floored to the hour) for every (lon, lat) point."""
    start = floor_hour(start)
    now = floor_hour(datetime.now(timezone.utc))
    if start + timedelta(hours=hours) > now + timedelta(days=MAX_FORECAST_DAYS):
        raise UpstreamError(f"Forecasts are only available up to {MAX_FORECAST_DAYS} days ahead.")
    first_day = start.date()
    last_day = (start + timedelta(hours=max(hours, MIN_WINDOW_HOURS) - 1)).date()

    cells = [snap(p) for p in points]
    keys = {cell: _cache_key(cell, first_day, last_day) for cell in dict.fromkeys(cells)}
    found = cache.get_many(list(keys.values()))
    missing = [cell for cell, key in keys.items() if key not in found]
    if missing:
        chunks = [missing[i:i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
        with ThreadPoolExecutor(max_workers=min(6, len(chunks))) as pool:
            fetched = [s for chunk in pool.map(lambda c: _fetch_chunk(c, first_day, last_day), chunks) for s in chunk]
        fresh = {keys[cell]: series for cell, series in zip(missing, fetched)}
        cache.set_many(fresh, FORECAST_TTL_SECONDS)
        found.update(fresh)
    return [found[keys[cell]].window(start, hours) for cell in cells]


def _cache_key(cell: tuple[float, float], first_day: date, last_day: date) -> str:
    return f"openmeteo:{cell[0]},{cell[1]}:{first_day.isoformat()}:{last_day.isoformat()}"


def _fetch_chunk(points: Sequence[tuple[float, float]], first_day: date, last_day: date) -> list[HourlySeries]:
    params = {
        "latitude": ",".join(f"{lat:.4f}" for _, lat in points),
        "longitude": ",".join(f"{lon:.4f}" for lon, _ in points),
        "hourly": "wind_speed_10m,rain,snowfall",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_date": first_day.isoformat(),
        "end_date": last_day.isoformat(),
    }
    data = get_json(settings.OPEN_METEO_URL, params)
    if isinstance(data, dict) and data.get("error"):
        raise UpstreamError(f"Weather service: {data.get('reason', 'unknown error')}")
    locations = data if isinstance(data, list) else [data]
    if len(locations) != len(points):
        raise UpstreamError("Weather service returned an unexpected number of locations.")
    day_start = datetime.combine(first_day, time(), tzinfo=timezone.utc)
    series = [_series(loc, day_start) for loc in locations]
    expected = 24 * ((last_day - first_day).days + 1)
    if any(len(s.wind_mph) != expected for s in series):
        raise UpstreamError("Weather service returned an incomplete forecast.")
    return series


def _series(loc: dict, start: datetime) -> HourlySeries:
    h = loc["hourly"]

    def clean(values: list) -> list[float]:
        return [float(v) if v is not None else 0.0 for v in values]

    # Open-Meteo reports snowfall in cm. With precipitation_unit=inch it converts
    # to inches, matching the brief's snow thresholds.
    return HourlySeries(start=start, wind_mph=clean(h["wind_speed_10m"]), rain_in=clean(h["rain"]),
                        snow_in=clean(h["snowfall"]))
