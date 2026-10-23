"""Orchestration: routing + forecasts + risk rules into one trip plan."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from .clients import open_meteo, osrm
from .clients.http import UpstreamError
from .domain import corridor, geo
from .domain.planner import Checkpoint, Route, build_route, checkpoints_for, evaluate, recommend
from .domain.risk import Conditions, Risk, risk_level

ROUTE_COUNT = 3
HEATMAP_HOURS = 48
MAX_DETOUR_RATIO = 1.6          # skip alternatives this much longer than the fastest
SIMILARITY_THRESHOLD = 0.85     # share of grid cells two routes may share before one is a duplicate
SIMPLIFY_TOLERANCE_DEG = 0.0005  # about 50 m, plenty for drawing

ROUTE_LETTERS = "ABCDE"

NOTES = [
    "Travel times use OSRM driving estimates, capped at 65 mph to reflect truck speeds.",
    "Weather at each checkpoint is the hourly forecast interpolated to the truck's ETA there.",
    "Each checkpoint stands for the road closer to it than to its neighbours when counting risk miles.",
    "No Travel miles are ranked before Severe miles when choosing the recommended route.",
    "On shared range edges (e.g. rain 0.25 in/hr) the higher risk level is used.",
]


def find_routes(origin: geo.Point, destination: geo.Point) -> list[Route]:
    """Three distinct candidate routes, fastest first.

    OSRM's own alternatives are used first. When it offers fewer than three, a
    detour is forced through a point offset from the fastest route's midpoint,
    on each side. Near-duplicates and unreasonably long detours are dropped.
    """
    raws = osrm.route([origin, destination], alternatives=ROUTE_COUNT)
    routes: list[Route] = []
    for raw in raws:
        _add_if_distinct(routes, build_route(raw.coords, raw.segment_seconds, raw.summary))

    if len(routes) < ROUTE_COUNT:
        base = routes[0]
        mid = base.distance_miles / 2
        centre = geo.point_at(base.coords, base.cum_miles, mid)
        heading = geo.heading_at(base.coords, base.cum_miles, mid)
        straight = geo.haversine_miles(origin, destination)
        for fraction in (0.15, 0.3):
            offset = min(150.0, max(8.0, straight * fraction))
            for side in (90, -90):
                if len(routes) >= ROUTE_COUNT:
                    break
                via = geo.destination_point(centre, heading + side, offset)
                try:
                    raw = osrm.route([origin, via, destination])[0]
                except UpstreamError:
                    continue
                _add_if_distinct(routes, build_route(raw.coords, raw.segment_seconds, raw.summary))

    routes.sort(key=lambda r: r.duration_seconds)
    return routes[:ROUTE_COUNT]


def _add_if_distinct(routes: list[Route], candidate: Route) -> None:
    if routes and candidate.distance_miles > MAX_DETOUR_RATIO * min(r.distance_miles for r in routes):
        return
    step = max(1.0, candidate.distance_miles / 200)
    cells = geo.grid_cells(candidate.coords, candidate.cum_miles, step, cell_deg=0.02)
    for existing in routes:
        other = geo.grid_cells(existing.coords, existing.cum_miles, step, cell_deg=0.02)
        if len(cells & other) / max(1, len(cells)) > SIMILARITY_THRESHOLD:
            return
    routes.append(candidate)


def plan_trip(origin: geo.Point, destination: geo.Point, departure: datetime, load_lbs: float,
              interval_miles: float) -> dict:
    departure = departure.astimezone(timezone.utc)
    routes = find_routes(origin, destination)
    plans = [checkpoints_for(r, departure, interval_miles) for r in routes]

    with ThreadPoolExecutor(max_workers=2) as pool:
        checkpoint_job = pool.submit(_conditions_for, plans, departure)
        heatmap_job = pool.submit(_heatmap, routes, departure, load_lbs)
        conditions = checkpoint_job.result()
        heatmap = heatmap_job.result()

    evaluations = [evaluate(r, cps, conds, load_lbs) for r, cps, conds in zip(routes, plans, conditions)]
    names = [f"Route {ROUTE_LETTERS[i]}" for i in range(len(routes))]
    best, reason = recommend(evaluations, names)

    return {
        "departure": departure.isoformat(),
        "load_lbs": load_lbs,
        "interval_miles": interval_miles,
        "recommended_route_id": ROUTE_LETTERS[best],
        "recommendation_reason": reason,
        "routes": [
            _route_json(ROUTE_LETTERS[i], names[i], ev, departure, i == best)
            for i, ev in enumerate(evaluations)
        ],
        "heatmap": heatmap,
        "notes": NOTES,
    }


def _conditions_for(plans: list[list[Checkpoint]], departure: datetime) -> list[list[Conditions]]:
    """Forecast every checkpoint of every route in one batched lookup."""
    flat = [cp for plan in plans for cp in plan]
    latest = max(cp.eta for cp in flat)
    hours = int((open_meteo.floor_hour(latest) - open_meteo.floor_hour(departure)).total_seconds() // 3600) + 2
    series = open_meteo.hourly([cp.point for cp in flat], departure, hours)
    out, k = [], 0
    for plan in plans:
        row = []
        for cp in plan:
            wind, rain, snow = series[k].at(cp.eta)
            row.append(Conditions(wind_mph=wind, rain_in_hr=rain, snow_in_hr=snow))
            k += 1
        out.append(row)
    return out


def _heatmap(routes: list[Route], departure: datetime, load_lbs: float) -> dict:
    points = corridor.corridor_points(routes)
    series = open_meteo.hourly(points, departure, HEATMAP_HOURS)
    start = open_meteo.floor_hour(departure)
    levels = [
        [risk_level(s.wind_mph[h], s.rain_in[h], s.snow_in[h], load_lbs) for s in series]
        for h in range(HEATMAP_HOURS)
    ]
    return {
        "start": start.isoformat(),
        "hours": HEATMAP_HOURS,
        "points": [list(p) for p in points],
        "levels": levels,
    }


def _route_json(route_id: str, name: str, ev, departure: datetime, recommended: bool) -> dict:
    route = ev.route
    keep = geo.simplify(route.coords, SIMPLIFY_TOLERANCE_DEG)
    m = ev.miles_by_level
    return {
        "id": route_id,
        "name": name,
        "summary": route.summary,
        "is_recommended": recommended,
        "distance_miles": round(route.distance_miles, 1),
        "duration_minutes": round(route.duration_seconds / 60),
        "arrival": (departure + timedelta(seconds=route.duration_seconds)).isoformat(),
        "average_risk": round(ev.average_risk, 2),
        "max_risk": ev.max_risk.label,
        "miles_by_level": {level.label: round(m[level], 1) for level in Risk},
        "geometry": [[round(route.coords[i][0], 5), round(route.coords[i][1], 5)] for i in keep],
        "geometry_seconds": [round(route.cum_seconds[i]) for i in keep],
        "checkpoints": [
            {
                "mile": round(a.checkpoint.mile, 1),
                "lon": round(a.checkpoint.point[0], 5),
                "lat": round(a.checkpoint.point[1], 5),
                "eta": a.checkpoint.eta.isoformat(),
                "wind_mph": round(a.conditions.wind_mph, 1),
                "rain_in_hr": round(a.conditions.rain_in_hr, 3),
                "snow_in_hr": round(a.conditions.snow_in_hr, 3),
                "risk": a.assessment.level.label,
                "risk_level": int(a.assessment.level),
                "wind_risk": a.assessment.wind.label,
                "rain_risk": a.assessment.rain.label,
                "snow_risk": a.assessment.snow.label,
                "load_escalated": a.assessment.load_escalated,
                "drivers": list(a.assessment.drivers),
                "miles_covered": round(a.miles_covered, 1),
            }
            for a in ev.checkpoints
        ],
    }
