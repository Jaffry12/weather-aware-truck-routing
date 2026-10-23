"""Open-Meteo hourly forecast client.

Many locations are fetched per request (Open-Meteo accepts comma-separated
coordinates), and chunks run in parallel, so a whole trip corridor costs only
a handful of HTTP calls.
"""

from __future__ import annotations

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from django.conf import settings

from .http import UpstreamError, cached, get_json

CHUNK_SIZE = 100
FORECAST_TTL_SECONDS = 20 * 60
MAX_FORECAST_DAYS = 15


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


def floor_hour(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def hourly(points: Sequence[tuple[float, float]], start: datetime, hours: int) -> list[HourlySeries]:
    """Forecast `hours` hourly steps from `start` (floored to the hour) for every point."""
    start = floor_hour(start)
    now = floor_hour(datetime.now(timezone.utc))
    if start + timedelta(hours=hours) > now + timedelta(days=MAX_FORECAST_DAYS):
        raise UpstreamError(f"Forecasts are only available up to {MAX_FORECAST_DAYS} days ahead.")
    chunks = [points[i:i + CHUNK_SIZE] for i in range(0, len(points), CHUNK_SIZE)]
    with ThreadPoolExecutor(max_workers=min(6, len(chunks)) or 1) as pool:
        results = list(pool.map(lambda c: _fetch_chunk(c, start, hours), chunks))
    return [series for chunk in results for series in chunk]


def _fetch_chunk(points: Sequence[tuple[float, float]], start: datetime, hours: int) -> list[HourlySeries]:
    end = start + timedelta(hours=hours - 1)
    params = {
        "latitude": ",".join(f"{lat:.3f}" for _, lat in points),
        "longitude": ",".join(f"{lon:.3f}" for lon, _ in points),
        "hourly": "wind_speed_10m,rain,snowfall",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "GMT",
        "start_hour": start.strftime("%Y-%m-%dT%H:00"),
        "end_hour": end.strftime("%Y-%m-%dT%H:00"),
    }
    url = settings.OPEN_METEO_URL
    data = cached("openmeteo", sorted(params.items()), FORECAST_TTL_SECONDS, lambda: get_json(url, params))
    if isinstance(data, dict) and data.get("error"):
        raise UpstreamError(f"Weather service: {data.get('reason', 'unknown error')}")
    locations = data if isinstance(data, list) else [data]
    if len(locations) != len(points):
        raise UpstreamError("Weather service returned an unexpected number of locations.")
    return [_series(loc, start) for loc in locations]


def _series(loc: dict, start: datetime) -> HourlySeries:
    h = loc["hourly"]

    def clean(values: list) -> list[float]:
        return [float(v) if v is not None else 0.0 for v in values]

    # Open-Meteo reports snowfall in cm. With precipitation_unit=inch it converts
    # to inches, matching the brief's snow thresholds.
    return HourlySeries(start=start, wind_mph=clean(h["wind_speed_10m"]), rain_in=clean(h["rain"]),
                        snow_in=clean(h["snowfall"]))
