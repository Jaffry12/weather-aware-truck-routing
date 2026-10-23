"""Small geodesy helpers for working along a route polyline.

Coordinates are (lon, lat) tuples, matching GeoJSON order, throughout.
"""

from __future__ import annotations

import bisect
import math
from collections.abc import Sequence

Point = tuple[float, float]

EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(a: Point, b: Point) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(h)))


def cumulative_miles(coords: Sequence[Point]) -> list[float]:
    out = [0.0]
    for prev, cur in zip(coords, coords[1:]):
        out.append(out[-1] + haversine_miles(prev, cur))
    return out


def bearing_degrees(a: Point, b: Point) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination_point(origin: Point, bearing_deg: float, distance_miles: float) -> Point:
    lon1, lat1 = map(math.radians, origin)
    brg = math.radians(bearing_deg)
    d = distance_miles / EARTH_RADIUS_MILES
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg))
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d) * math.cos(lat1),
        math.cos(d) - math.sin(lat1) * math.sin(lat2),
    )
    return ((math.degrees(lon2) + 540) % 360 - 180, math.degrees(lat2))


def _locate(cum: Sequence[float], distance: float) -> tuple[int, float]:
    """Index of the segment containing `distance` and the fraction along it."""
    if distance <= 0:
        return 0, 0.0
    if distance >= cum[-1]:
        return len(cum) - 2, 1.0
    i = bisect.bisect_right(cum, distance) - 1
    seg = cum[i + 1] - cum[i]
    return i, 0.0 if seg == 0 else (distance - cum[i]) / seg


def point_at(coords: Sequence[Point], cum: Sequence[float], distance: float) -> Point:
    if len(coords) == 1:
        return coords[0]
    i, t = _locate(cum, distance)
    (x1, y1), (x2, y2) = coords[i], coords[i + 1]
    return (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)


def value_at(cum: Sequence[float], values: Sequence[float], distance: float) -> float:
    """Interpolate a per-vertex quantity (such as elapsed seconds) at a distance."""
    if len(values) == 1:
        return values[0]
    i, t = _locate(cum, distance)
    return values[i] + (values[i + 1] - values[i]) * t


def heading_at(coords: Sequence[Point], cum: Sequence[float], distance: float) -> float:
    if len(coords) < 2:
        return 0.0
    i, _ = _locate(cum, distance)
    return bearing_degrees(coords[i], coords[i + 1])


def sample_distances(total_miles: float, interval_miles: float) -> list[float]:
    """0, interval, 2*interval, ... and always the destination itself."""
    if total_miles <= 0:
        return [0.0]
    out = [0.0]
    d = interval_miles
    while d < total_miles - 1e-6:
        out.append(d)
        d += interval_miles
    out.append(total_miles)
    return out


def simplify(coords: Sequence[Point], tolerance_deg: float) -> list[int]:
    """Iterative Ramer-Douglas-Peucker. Returns the indices of kept vertices.

    Indices (rather than points) are returned so per-vertex data such as
    cumulative time can be carried along with the simplified line.
    """
    n = len(coords)
    if n < 3:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tolerance_deg * tolerance_deg
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = coords[start], coords[end]
        dx, dy = x2 - x1, y2 - y1
        norm = dx * dx + dy * dy
        best, best_d = -1, tol2
        for i in range(start + 1, end):
            px, py = coords[i]
            if norm == 0:
                d2 = (px - x1) ** 2 + (py - y1) ** 2
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / norm))
                d2 = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2
            if d2 > best_d:
                best, best_d = i, d2
        if best != -1:
            keep[best] = True
            stack.append((start, best))
            stack.append((best, end))
    return [i for i, k in enumerate(keep) if k]


def grid_cells(coords: Sequence[Point], cum: Sequence[float], step_miles: float, cell_deg: float) -> set[tuple[int, int]]:
    """Grid cells visited by a route, sampled every `step_miles`. Used to compare routes."""
    cells: set[tuple[int, int]] = set()
    for d in sample_distances(cum[-1], step_miles):
        lon, lat = point_at(coords, cum, d)
        cells.add((math.floor(lon / cell_deg), math.floor(lat / cell_deg)))
    return cells
