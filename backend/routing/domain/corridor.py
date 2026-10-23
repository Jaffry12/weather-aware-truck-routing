"""Sample points across the trip corridor for the weather heatmap.

Points are laid out along every route, at the centreline and at fixed offsets
to either side, so the heatmap shows the weather a driver might detour into,
not just a thin line. The step grows on long trips to keep the forecast
request bounded (Open-Meteo is queried for every point).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from . import geo
from .planner import Route

LATERAL_OFFSETS_MILES = (0.0, -30.0, 30.0, -60.0, 60.0)
MAX_POINTS = 180  # each point is one call against the weather API's free-tier budget
MIN_STEP_MILES = 12.0


def corridor_points(routes: Sequence[Route]) -> tuple[list[geo.Point], float]:
    """Sample points for the corridor, and the spacing in miles they were laid out at."""
    longest = max(r.distance_miles for r in routes)
    step = max(MIN_STEP_MILES, longest / 30)
    while True:
        points = _sample(routes, step)
        if len(points) <= MAX_POINTS:
            return points, step
        step *= 1.25


def _sample(routes: Sequence[Route], step: float) -> list[geo.Point]:
    # De-duplicate on a grid roughly `step` miles wide, so overlapping routes
    # don't stack points (and forecast calls) on the same patch of map.
    cell_deg = step / 69.0
    seen: set[tuple[int, int]] = set()
    points: list[geo.Point] = []
    for route in routes:
        for d in geo.sample_distances(route.distance_miles, step):
            centre = geo.point_at(route.coords, route.cum_miles, d)
            heading = geo.heading_at(route.coords, route.cum_miles, d)
            for offset in LATERAL_OFFSETS_MILES:
                p = centre if offset == 0 else geo.destination_point(centre, heading + 90, offset)
                key = (math.floor(p[0] / cell_deg), math.floor(p[1] / cell_deg))
                if key not in seen:
                    seen.add(key)
                    points.append((round(p[0], 4), round(p[1], 4)))
    return points
