"""OSRM routing client (the public demo server by default; set OSRM_URL to self-host)."""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

from .http import UpstreamError, cached, get_json

ROUTE_TTL_SECONDS = 6 * 3600


@dataclass(frozen=True)
class RawRoute:
    coords: list[tuple[float, float]]
    segment_seconds: list[float] | None
    roads: tuple[str, ...]  # named roads, most-driven first


def route(waypoints: list[tuple[float, float]], alternatives: int = 0) -> list[RawRoute]:
    """Driving route(s) through `waypoints` given as (lon, lat)."""
    path = ";".join(f"{lon:.5f},{lat:.5f}" for lon, lat in waypoints)
    url = f"{settings.OSRM_URL.rstrip('/')}/route/v1/driving/{path}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "annotations": "duration",
        # Steps are only used to name each route after its main highways.
        "steps": "true",
        "alternatives": str(alternatives) if alternatives else "false",
    }
    data = cached("osrm", (url, sorted(params.items())), ROUTE_TTL_SECONDS, lambda: get_json(url, params))
    if not isinstance(data, dict) or data.get("code") != "Ok" or not data.get("routes"):
        message = data.get("message") if isinstance(data, dict) else None
        raise UpstreamError(message or "No drivable route found between these places.")
    return [_parse(r) for r in data["routes"]]


def _parse(r: dict) -> RawRoute:
    coords = [(float(x), float(y)) for x, y in r["geometry"]["coordinates"]]
    seconds: list[float] = []
    for leg in r.get("legs", []):
        seconds.extend(leg.get("annotation", {}).get("duration", []))
    # Annotations should line up with geometry segments. Anything else is ignored,
    # and the planner falls back to distance-based timing.
    return RawRoute(coords=coords, segment_seconds=seconds if len(seconds) == len(coords) - 1 else None,
                    roads=_ranked_roads(r.get("legs", [])))


def _ranked_roads(legs: list[dict]) -> tuple[str, ...]:
    """Roads ordered by distance driven on them, preferring route numbers ("I-80") over names."""
    by_road: dict[str, float] = {}
    for leg in legs:
        for step in leg.get("steps", []):
            road = (step.get("ref") or step.get("name") or "").split(";")[0].strip()
            road = road.removesuffix(" Express").removesuffix(" Business")
            if road:
                by_road[road] = by_road.get(road, 0.0) + float(step.get("distance", 0.0))
    if not by_road:
        # No steps: fall back to OSRM's own leg summaries ("I 80, I 76").
        ranked = [road.strip() for leg in legs for road in leg.get("summary", "").split(",") if road.strip()]
    else:
        ranked = sorted(by_road, key=by_road.get, reverse=True)
    return tuple(dict.fromkeys(r.replace("I ", "I-").replace("US ", "US-") for r in ranked))
