import pytest

from routing.domain.risk import Conditions, Risk, assess, classify_rain, classify_snow, classify_wind, risk_level

L, M, H, S, NT = Risk.LOW, Risk.MODERATE, Risk.HIGH, Risk.SEVERE, Risk.NO_TRAVEL


@pytest.mark.parametrize("mph,expected", [
    (0, L), (24.9, L), (25, M), (34, M), (34.9, M), (35, H), (44, H), (45, S), (54, S), (54.9, S), (55, NT), (80, NT),
])
def test_wind_thresholds(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize("inches,expected", [
    (0, L), (0.099, L), (0.10, M), (0.249, M), (0.25, H), (0.499, H), (0.50, S), (1.00, S), (1.001, NT),
])
def test_rain_thresholds(inches, expected):
    assert classify_rain(inches) == expected


@pytest.mark.parametrize("inches,expected", [
    (0, L), (0.49, L), (0.5, M), (0.99, M), (1.0, H), (1.99, H), (2.0, S), (3.0, S), (3.01, NT),
])
def test_snow_thresholds(inches, expected):
    assert classify_snow(inches) == expected


@pytest.mark.parametrize("mph,load,expected", [
    (55, 0, NT),            # >=55 mph is No Travel for any load
    (50, 30_000, S),        # exactly 30,000 lb is not "> 30,000"
    (50, 30_001, NT),       # 45-54 mph + >30,000 lb
    (40, 40_000, H),        # exactly 40,000 lb is not "> 40,000"
    (40, 40_001, S),        # 35-44 mph + >40,000 lb
    (30, 80_000, M),        # load rules don't touch lower winds
])
def test_load_rules(mph, load, expected):
    assert assess(Conditions(mph, 0, 0), load).level == expected


def test_overall_risk_is_worst_factor_and_explains_itself():
    a = assess(Conditions(wind_mph=20, rain_in_hr=0.3, snow_in_hr=1.2), load_lbs=10_000)
    assert a.level == H
    assert (a.wind, a.rain, a.snow) == (L, H, H)
    assert a.drivers == ("rain 0.30 in/hr", "snow 1.20 in/hr")


def test_load_escalation_is_flagged():
    a = assess(Conditions(wind_mph=47, rain_in_hr=0, snow_in_hr=0), load_lbs=35_000)
    assert a.level == NT and a.load_escalated
    assert "35,000 lb load" in a.drivers[0]


def test_fast_path_matches_full_assessment():
    for wind in (10, 30, 40, 50, 60):
        for rain in (0, 0.2, 0.6):
            for load in (20_000, 45_000):
                assert risk_level(wind, rain, 0, load) == int(assess(Conditions(wind, rain, 0), load).level)
