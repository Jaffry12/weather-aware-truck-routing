"""Orchestration: routing + forecasts + risk rules into one trip plan."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from .clients import open_meteo, osrm
from .clients.http import UpstreamError
from .domain import corridor, geo
from .domain.planner import Checkpoint, Route, build_route, checkpoints_for, evaluate, recommend
from .domain.risk import Conditions, Risk, factor_levels

ROUTE_COUNT = 3
HEATMAP_HOURS = 49  # hourly frames for +0 h to +48 h inclusive
MAX_DETOUR_RATIO = 1.6          # skip alternatives this much longer than the fastest
SIMILARITY_THRESHOLD = 0.85     # share of grid cells two routes may share before one is a duplicate
RELAXED_DETOUR_RATIO = 2.0      # second pass, used only if the strict rules leave fewer than three
RELAXED_SIMILARITY = 0.97
MAX_VIA_ATTEMPTS = 8
# Where forced detours go: (share of the way along the fastest route, offset as a
# share of the straight-line distance), each tried on both sides.
VIA_PLACEMENTS = ((0.5, 0.15), (0.5, 0.3), (0.33, 0.2), (0.67, 0.2), (0.5, 0.5))
SIMPLIFY_TOLERANCE_DEG = 0.0005  # about 50 m, plenty for drawing

# Open-Meteo's free tier counts every location as an API call (600 a minute), so
# one plan stays well inside that. Checkpoints come first: each gets its own
# lookup up to MAX_CHECKPOINT_LOCATIONS; the corridor heatmap gets what is left.
MAX_PLAN_LOCATIONS = 450
MAX_CHECKPOINT_LOCATIONS = 360
MIN_HEATMAP_POINTS = 80

ROUTE_LETTERS = "ABCDE"

NOTES = [
    "Travel times use OSRM driving estimates, capped at 65 mph to reflect truck speeds.",
    "Weather at each checkpoint is the hourly forecast interpolated to the truck's ETA there.",
    "Each checkpoint stands for the road closer to it than to its neighbours when counting risk miles.",
    "No Travel miles are ranked before Severe miles when choosing the recommended route.",
    "On shared range edges (e.g. rain 0.25 in/hr) the higher risk level is used.",
    "The heatmap colours each forecast point by its rule-based level, not by point density.",
]


def find_routes(origin: geo.Point, destination: geo.Point) -> list[Route]:
    """Three distinct candidate routes, fastest first.

    OSRM's own alternatives are used first. When it offers fewer than three,
    detours are forced through points offset to either side of the fastest
    route. Near-duplicates and unreasonably long detours are dropped; if those
    strict rules leave fewer than three (say, a coast road with no parallel),
    they are relaxed once, so a usable third option is shown whenever one exists.
    """
    candidates = [build_route(raw.coords, raw.segment_seconds, raw.roads)
                  for raw in osrm.route([origin, destination], alternatives=ROUTE_COUNT)]
    routes = _distinct(candidates, MAX_DETOUR_RATIO, SIMILARITY_THRESHOLD)

    base = routes[0]
    straight = geo.haversine_miles(origin, destination)
    attempts = 0
    for share, fraction in VIA_PLACEMENTS:
        if len(routes) >= ROUTE_COUNT or attempts >= MAX_VIA_ATTEMPTS:
            break
        along = base.distance_miles * share
        centre = geo.point_at(base.coords, base.cum_miles, along)
        heading = geo.heading_at(base.coords, base.cum_miles, along)
        offset = min(150.0, max(8.0, straight * fraction))
        for side in (90, -90):
            if len(routes) >= ROUTE_COUNT or attempts >= MAX_VIA_ATTEMPTS:
                break
            attempts += 1
            via = geo.destination_point(centre, heading + side, offset)
            try:
                raw = osrm.route([origin, via, destination])[0]
            except UpstreamError:
                continue
            candidates.append(build_route(raw.coords, raw.segment_seconds, raw.roads))
            routes = _distinct(candidates, MAX_DETOUR_RATIO, SIMILARITY_THRESHOLD)

    if len(routes) < ROUTE_COUNT:
        routes = _distinct(candidates, RELAXED_DETOUR_RATIO, RELAXED_SIMILARITY)
    return routes


def route_summaries(routes: list[Route]) -> list[str]:
    """Name each route after its two busiest roads.

    When two routes would get the same name, each also gets the busiest road
    that the others don't use, so the cards can be told apart.
    """
    names = []
    for i, route in enumerate(routes):
        name = list(route.roads[:2])
        twins = [other for j, other in enumerate(routes) if j != i and other.roads[:2] == route.roads[:2]]
        if twins and name:
            shared = {road for twin in twins for road in twin.roads}
            extra = next((road for road in route.roads[2:] if road not in shared), None)
            if extra:
                name.append(extra)
        names.append(" / ".join(name))
    return names


def _distinct(candidates: list[Route], max_ratio: float, max_shared: float) -> list[Route]:
    """Fastest first, up to three routes that are neither too long nor near-copies of one already chosen."""
    shortest = min(r.distance_miles for r in candidates)
    step = max(1.0, shortest / 200)
    chosen: list[Route] = []
    chosen_cells: list[set] = []
    for route in sorted(candidates, key=lambda r: r.duration_seconds):
        if route.distance_miles > max_ratio * shortest:
            continue
        cells = geo.grid_cells(route.coords, route.cum_miles, step, cell_deg=0.02)
        if any(len(cells & other) / max(1, len(cells)) > max_shared for other in chosen_cells):
            continue
        chosen.append(route)
        chosen_cells.append(cells)
        if len(chosen) == ROUTE_COUNT:
            break
    return chosen


def plan_trip(origin: geo.Point, destination: geo.Point, departure: datetime, load_lbs: float,
              interval_miles: float) -> dict:
    departure = departure.astimezone(timezone.utc)
    routes = find_routes(origin, destination)
    plans = [checkpoints_for(r, departure, interval_miles) for r in routes]
    lookups = _lookup_points([cp.point for plan in plans for cp in plan])
    heatmap_budget = max(MIN_HEATMAP_POINTS, min(corridor.MAX_POINTS, MAX_PLAN_LOCATIONS - len(set(lookups))))

    with ThreadPoolExecutor(max_workers=2) as pool:
        checkpoint_job = pool.submit(_conditions_for, plans, lookups, departure)
        heatmap_job = pool.submit(_heatmap, routes, departure, load_lbs, heatmap_budget)
        conditions = checkpoint_job.result()
        # The heatmap is context; if only it fails, the routes are still worth returning.
        heatmap, heatmap_error = None, None
        try:
            heatmap = heatmap_job.result()
        except UpstreamError as exc:
            heatmap_error = str(exc)

    evaluations = [evaluate(r, cps, conds, load_lbs) for r, cps, conds in zip(routes, plans, conditions)]
    names = [f"Route {ROUTE_LETTERS[i]}" for i in range(len(routes))]
    summaries = route_summaries(routes)
    best, reason = recommend(evaluations, names)

    return {
        "departure": departure.isoformat(),
        "load_lbs": load_lbs,
        "interval_miles": interval_miles,
        "recommended_route_id": ROUTE_LETTERS[best],
        "recommendation_reason": reason,
        "routes": [
            _route_json(ROUTE_LETTERS[i], names[i], summaries[i], ev, departure, i == best)
            for i, ev in enumerate(evaluations)
        ],
        "heatmap": heatmap,
        "heatmap_error": heatmap_error,
        "notes": NOTES,
    }


def _conditions_for(plans: list[list[Checkpoint]], lookups: list[geo.Point],
                    departure: datetime) -> list[list[Conditions]]:
    """Forecast every checkpoint of every route in one batched lookup (`lookups` lines up with them)."""
    latest = max(cp.eta for plan in plans for cp in plan)
    hours = int((open_meteo.floor_hour(latest) - open_meteo.floor_hour(departure)).total_seconds() // 3600) + 2
    series = open_meteo.hourly(lookups, departure, hours)
    out, k = [], 0
    for plan in plans:
        row = []
        for cp in plan:
            wind, rain, snow = series[k].at(cp.eta)
            row.append(Conditions(wind_mph=wind, rain_in_hr=rain, snow_in_hr=snow))
            k += 1
        out.append(row)
    return out


def _lookup_points(points: list[geo.Point]) -> list[geo.Point]:
    """Where each checkpoint's forecast is looked up.

    Each checkpoint gets its own lookup on the 0.05° grid (about 3 miles, finer
    than the forecast models). Only coast-to-coast trips at 10-mile spacing
    exceed the budget; then the grid is coarsened in small steps until they
    fit. ETAs and risk are still worked out per checkpoint.
    """
    degrees = open_meteo.SNAP_DEGREES
    while len({open_meteo.snap(p, degrees) for p in points}) > MAX_CHECKPOINT_LOCATIONS:
        degrees *= 1.5
    return [open_meteo.snap(p, degrees) for p in points]


def _heatmap(routes: list[Route], departure: datetime, load_lbs: float, max_points: int) -> dict:
    points, spacing = corridor.corridor_points(routes, max_points)
    series = open_meteo.hourly(points, departure, HEATMAP_HOURS)
    start = open_meteo.floor_hour(departure)
    # levels[h][i] is (overall, wind, precipitation) for point i at hour h.
    levels = [
        [factor_levels(s.wind_mph[h], s.rain_in[h], s.snow_in[h], load_lbs) for s in series]
        for h in range(HEATMAP_HOURS)
    ]
    return {
        "start": start.isoformat(),
        "hours": HEATMAP_HOURS,
        "spacing_miles": round(max(spacing, max(abs(o) for o in corridor.LATERAL_OFFSETS_MILES) / 2), 1),
        "points": [list(p) for p in points],
        "levels": [[cell[0] for cell in row] for row in levels],
        "wind_levels": [[cell[1] for cell in row] for row in levels],
        "precip_levels": [[cell[2] for cell in row] for row in levels],
    }


def _route_json(route_id: str, name: str, summary: str, ev, departure: datetime, recommended: bool) -> dict:
    route = ev.route
    keep = geo.simplify(route.coords, SIMPLIFY_TOLERANCE_DEG)
    m = ev.miles_by_level
    return {
        "id": route_id,
        "name": name,
        "summary": summary,
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
