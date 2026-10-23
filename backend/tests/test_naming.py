from routing.clients.osrm import _ranked_roads
from routing.domain.planner import build_route
from routing.services import route_summaries

LINE = [(-90.0, 30.0), (-90.0, 31.0)]


def step(ref: str, metres: float, name: str = "") -> dict:
    return {"ref": ref, "name": name, "distance": metres}


def test_roads_are_ranked_by_distance_and_normalised():
    legs = [{"steps": [
        step("I 80", 500_000),
        step("I 80 Express", 20_000),
        step("US 30", 80_000),
        step("", 5_000, name="Main Street"),
        step("I 76;US 6", 120_000),
    ]}]
    assert _ranked_roads(legs) == ("I-80", "I-76", "US-30", "Main Street")


def test_roads_fall_back_to_leg_summaries_without_steps():
    assert _ranked_roads([{"summary": "I 55, I 44"}]) == ("I-55", "I-44")


def test_distinct_routes_keep_their_two_main_roads():
    a = build_route(LINE, None, ("I-80", "I-76", "US-6"))
    b = build_route(LINE, None, ("I-70", "I-55"))
    assert route_summaries([a, b]) == ["I-80 / I-76", "I-70 / I-55"]


def test_routes_with_the_same_main_roads_get_a_distinguishing_road():
    b = build_route(LINE, None, ("I-84", "US-95", "US-20", "OR-201"))
    c = build_route(LINE, None, ("I-84", "US-95", "US-20", "US-93"))
    assert route_summaries([b, c]) == ["I-84 / US-95 / OR-201", "I-84 / US-95 / US-93"]
