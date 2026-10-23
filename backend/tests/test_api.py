"""End-to-end API tests with the third-party services faked by `responses`."""

import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
import responses
from django.core.cache import cache
from rest_framework.test import APIClient

CHICAGO = {"lat": 41.8781, "lon": -87.6298, "label": "Chicago"}
ST_LOUIS = {"lat": 38.627, "lon": -90.1994, "label": "St. Louis"}


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


def _line(lon1, lat1, lon2, lat2, bend=0.0, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append([lon1 + (lon2 - lon1) * t + bend * (1 - abs(2 * t - 1)), lat1 + (lat2 - lat1) * t])
    return pts


def _osrm_route(coords, seconds_each=60.0):
    return {
        "geometry": {"type": "LineString", "coordinates": coords},
        "legs": [{"summary": "I-55", "annotation": {"duration": [seconds_each] * (len(coords) - 1)}}],
        "distance": 0,
        "duration": 0,
    }


def _osrm_callback(request):
    via = request.url.count(";") == 2
    if via:  # forced detour through a via point
        routes = [_osrm_route(_line(-87.63, 41.88, -90.2, 38.63, bend=-1.2))]
    else:
        routes = [_osrm_route(_line(-87.63, 41.88, -90.2, 38.63)),
                  _osrm_route(_line(-87.63, 41.88, -90.2, 38.63, bend=0.8), 70.0)]
    return 200, {}, json.dumps({"code": "Ok", "routes": routes})


def _meteo_callback(request):
    q = parse_qs(urlparse(request.url).query)
    lats = q["latitude"][0].split(",")
    first = datetime.strptime(q["start_date"][0], "%Y-%m-%d")
    last = datetime.strptime(q["end_date"][0], "%Y-%m-%d")
    hours = 24 * ((last - first).days + 1)
    locs = []
    for lat in lats:
        # Windy south of 40N: high risk on the southern half of every route.
        wind = 40.0 if float(lat) < 40 else 10.0
        locs.append({"hourly": {"time": [], "wind_speed_10m": [wind] * hours, "rain": [0.0] * hours,
                                "snowfall": [0.0] * hours}})
    return 200, {}, json.dumps(locs if len(locs) > 1 else locs[0])


@pytest.fixture
def fake_upstreams():
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        rsps.add_callback(responses.GET, re.compile(r"https://router\.project-osrm\.org/.*"), callback=_osrm_callback)
        rsps.add_callback(responses.GET, re.compile(r"https://api\.open-meteo\.com/.*"), callback=_meteo_callback)
        yield rsps


def _plan_body(**overrides):
    body = {
        "origin": CHICAGO,
        "destination": ST_LOUIS,
        "departure": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        "load_lbs": 42_000,
        "interval_miles": 25,
    }
    body.update(overrides)
    return body


def test_plan_returns_three_routes_with_checkpoints_and_heatmap(fake_upstreams):
    resp = APIClient().post("/api/plan", _plan_body(), format="json")
    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert len(data["routes"]) == 3
    assert sum(r["is_recommended"] for r in data["routes"]) == 1
    rec = next(r for r in data["routes"] if r["is_recommended"])
    assert rec["id"] == data["recommended_route_id"]
    cps = rec["checkpoints"]
    assert cps[0]["mile"] == 0 and cps[-1]["mile"] == rec["distance_miles"]
    # 40 mph with a 42,000 lb load escalates to Severe.
    assert any(c["risk"] == "Severe" and c["load_escalated"] for c in cps)
    heat = data["heatmap"]
    assert heat["hours"] == 49  # +0 h to +48 h
    for key in ("levels", "wind_levels", "precip_levels"):
        assert len(heat[key]) == 49
        assert all(len(row) == len(heat["points"]) for row in heat[key])
    # Overall risk is the worse of the wind and precipitation layers.
    assert heat["levels"][0] == [max(w, p) for w, p in zip(heat["wind_levels"][0], heat["precip_levels"][0])]


def test_interval_changes_checkpoint_density(fake_upstreams):
    client = APIClient()
    ten = client.post("/api/plan", _plan_body(interval_miles=10), format="json").json()
    fifty = client.post("/api/plan", _plan_body(interval_miles=50), format="json").json()
    assert len(ten["routes"][0]["checkpoints"]) > 3 * len(fifty["routes"][0]["checkpoints"]) - 3


@pytest.mark.parametrize("override,field", [
    ({"interval_miles": 30}, "interval_miles"),
    ({"load_lbs": -5}, "load_lbs"),
    ({"departure": "2020-01-01T00:00:00Z"}, "departure"),
])
def test_validation_errors(override, field):
    resp = APIClient().post("/api/plan", _plan_body(**override), format="json")
    assert resp.status_code == 400 and field in resp.json()


def test_upstream_failure_is_a_502():
    with responses.RequestsMock() as rsps:
        rsps.add(responses.GET, re.compile(r"https://router\.project-osrm\.org/.*"),
                 json={"code": "NoRoute", "message": "Impossible route between points"})
        resp = APIClient().post("/api/plan", _plan_body(), format="json")
    assert resp.status_code == 502
    assert "Impossible route" in resp.json()["detail"]


def test_weather_rate_limit_is_a_503_with_retry_after():
    with responses.RequestsMock(assert_all_requests_are_fired=False) as rsps:
        rsps.add_callback(responses.GET, re.compile(r"https://router\.project-osrm\.org/.*"), callback=_osrm_callback)
        rsps.add(responses.GET, re.compile(r"https://api\.open-meteo\.com/.*"), status=429,
                 json={"error": True, "reason": "Minutely API request limit exceeded."})
        resp = APIClient().post("/api/plan", _plan_body(), format="json")
    assert resp.status_code == 503
    assert resp["Retry-After"] == "60"
    assert "try again in a minute" in resp.json()["detail"]


def test_heatmap_failure_still_returns_the_routes(fake_upstreams, monkeypatch):
    from routing import services
    from routing.clients.http import RateLimited

    def busy(*args, **kwargs):
        raise RateLimited("api.open-meteo.com is busy")

    monkeypatch.setattr(services, "_heatmap", busy)
    resp = APIClient().post("/api/plan", _plan_body(), format="json")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["routes"]) == 3 and data["heatmap"] is None
    assert "busy" in data["heatmap_error"]


def test_replanning_reuses_cached_forecasts(fake_upstreams):
    client = APIClient()
    client.post("/api/plan", _plan_body(load_lbs=42_000), format="json")
    weather_calls = sum("open-meteo" in c.request.url for c in fake_upstreams.calls)
    resp = client.post("/api/plan", _plan_body(load_lbs=20_000), format="json")
    assert resp.status_code == 200
    # Same trip, different load: every location is already cached.
    assert sum("open-meteo" in c.request.url for c in fake_upstreams.calls) == weather_calls


def test_checkpoint_lookups_stay_within_the_location_budget():
    from routing import services

    points = [(-120 + i * 0.03, 35 + i * 0.01) for i in range(900)]  # a ~2,000 mile line at 10-mile spacing
    lookups = services._lookup_points(points)
    assert len(lookups) == len(points)
    assert len(set(lookups)) <= services.MAX_CHECKPOINT_LOCATIONS
