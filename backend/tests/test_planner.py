from datetime import datetime, timedelta, timezone

import pytest

from routing.domain import geo
from routing.domain.planner import attribute_miles, build_route, checkpoints_for, evaluate, recommend
from routing.domain.risk import Conditions, Risk

DEPART = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)


def straight_route(miles: float, seconds_per_segment: float | None = None):
    # A due-north line: 1 degree of latitude is about 69.09 miles.
    n = 20
    coords = [(-90.0, 30.0 + i * (miles / 69.09) / n) for i in range(n + 1)]
    secs = None if seconds_per_segment is None else [seconds_per_segment] * n
    return build_route(coords, secs)


def test_sample_distances_always_include_both_ends():
    assert geo.sample_distances(60, 25) == [0, 25, 50, 60]
    assert geo.sample_distances(50, 25) == [0, 25, 50]


def test_truck_time_is_capped_at_65_mph():
    fast = straight_route(130, seconds_per_segment=1)  # absurdly fast car estimate
    assert fast.duration_seconds == pytest.approx(130 / 65 * 3600, rel=0.01)
    slow = straight_route(130, seconds_per_segment=900)  # slower than 65 mph: kept as is
    assert slow.duration_seconds == pytest.approx(20 * 900, rel=0.01)


def test_checkpoint_etas_follow_truck_time():
    route = straight_route(130)
    cps = checkpoints_for(route, DEPART, 25)
    assert [round(c.mile) for c in cps] == [0, 25, 50, 75, 100, 125, 130]
    assert cps[2].eta - DEPART == pytest.approx(timedelta(hours=50 / 65), abs=timedelta(minutes=2))


def test_each_checkpoint_covers_the_road_nearest_to_it():
    assert attribute_miles([0, 25, 50, 60]) == [12.5, 25, 17.5, 5]
    assert sum(attribute_miles([0, 10, 20, 30, 37])) == 37


def _eval(miles_profile, levels, duration_scale=1.0):
    """Build an evaluation whose checkpoints have the given risk levels."""
    route = straight_route(miles_profile)
    route.cum_seconds = [s * duration_scale for s in route.cum_seconds]
    cps = checkpoints_for(route, DEPART, 25)
    weather = {Risk.LOW: Conditions(5, 0, 0), Risk.HIGH: Conditions(40, 0, 0), Risk.SEVERE: Conditions(50, 0, 0),
               Risk.NO_TRAVEL: Conditions(60, 0, 0)}
    conds = [weather[levels[min(i, len(levels) - 1)]] for i in range(len(cps))]
    return evaluate(route, cps, conds, load_lbs=20_000)


def test_recommendation_order_follows_the_brief():
    calm_slow = _eval(100, [Risk.LOW], duration_scale=1.3)
    one_severe_fast = _eval(100, [Risk.LOW, Risk.SEVERE, Risk.LOW])
    best, reason = recommend([one_severe_fast, calm_slow], ["Route A", "Route B"])
    assert best == 1  # fewest Severe miles beats travel time
    assert "Severe miles" in reason


def test_no_travel_outranks_everything():
    no_travel = _eval(100, [Risk.LOW, Risk.NO_TRAVEL, Risk.LOW])
    severe = _eval(100, [Risk.SEVERE])
    best, _ = recommend([no_travel, severe], ["Route A", "Route B"])
    assert best == 1


def test_ties_fall_through_to_travel_time():
    a = _eval(100, [Risk.LOW], duration_scale=1.2)
    b = _eval(100, [Risk.LOW])
    best, reason = recommend([a, b], ["Route A", "Route B"])
    assert best == 1 and "faster than Route A" in reason


def test_miles_by_level_add_up_to_route_length():
    ev = _eval(130, [Risk.LOW, Risk.HIGH, Risk.LOW])
    assert sum(ev.miles_by_level.values()) == pytest.approx(ev.route.distance_miles, rel=1e-6)
    assert ev.max_risk == Risk.HIGH


def test_simplify_keeps_endpoints_and_drops_collinear_points():
    line = [(0.0, float(i)) for i in range(50)]
    assert geo.simplify(line, 0.001) == [0, 49]
