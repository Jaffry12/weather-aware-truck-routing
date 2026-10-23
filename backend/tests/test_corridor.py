from routing.domain import geo
from routing.domain.corridor import LATERAL_OFFSETS_MILES, MAX_POINTS, MIN_STEP_MILES, corridor_points
from routing.domain.planner import build_route


def line(miles: float, lon: float = -90.0):
    n = 50
    return build_route([(lon, 30.0 + i * (miles / 69.09) / n) for i in range(n + 1)], None)


def test_short_trip_uses_the_minimum_step_and_covers_both_sides():
    points, step = corridor_points([line(120)])
    assert step == MIN_STEP_MILES
    # Points reach 60 miles to either side of the centreline (lon -90).
    west = min(points, key=lambda p: p[0])
    east = max(points, key=lambda p: p[0])
    widest = max(abs(o) for o in LATERAL_OFFSETS_MILES)
    assert geo.haversine_miles(west, (-90.0, west[1])) > widest - 2
    assert geo.haversine_miles(east, (-90.0, east[1])) > widest - 2


def test_long_multi_route_trip_stays_under_the_point_budget():
    points, step = corridor_points([line(2500), line(2600, lon=-92.0), line(2400, lon=-94.0)])
    assert len(points) <= MAX_POINTS
    assert step > 2600 / 30
    assert len(set(points)) == len(points)
