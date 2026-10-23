"""Weather risk rules from the assessment brief.

Everything here is pure and side-effect free, so the rules can be unit-tested
against the brief's tables without any network or Django machinery.

Boundary handling: where the brief's ranges share an edge (for example rain
0.10-0.25 and 0.25-0.50), the value is placed in the *higher* level. For a
safety rule, the conservative reading wins. "No Travel" applies strictly above
the top Severe value for rain and snow (> 1.00, > 3.0) and from 55 mph for
wind, exactly as written.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return _LABELS[self]


_LABELS = {
    Risk.LOW: "Low",
    Risk.MODERATE: "Moderate",
    Risk.HIGH: "High",
    Risk.SEVERE: "Severe",
    Risk.NO_TRAVEL: "No Travel",
}

# Load-rule thresholds (pounds).
NO_TRAVEL_LOAD_LBS_AT_45_MPH = 30_000
SEVERE_LOAD_LBS_AT_35_MPH = 40_000


def classify_wind(mph: float) -> Risk:
    if mph >= 55:
        return Risk.NO_TRAVEL
    if mph >= 45:
        return Risk.SEVERE
    if mph >= 35:
        return Risk.HIGH
    if mph >= 25:
        return Risk.MODERATE
    return Risk.LOW


def classify_rain(inches_per_hour: float) -> Risk:
    if inches_per_hour > 1.00:
        return Risk.NO_TRAVEL
    if inches_per_hour >= 0.50:
        return Risk.SEVERE
    if inches_per_hour >= 0.25:
        return Risk.HIGH
    if inches_per_hour >= 0.10:
        return Risk.MODERATE
    return Risk.LOW


def classify_snow(inches_per_hour: float) -> Risk:
    if inches_per_hour > 3.0:
        return Risk.NO_TRAVEL
    if inches_per_hour >= 2.0:
        return Risk.SEVERE
    if inches_per_hour >= 1.0:
        return Risk.HIGH
    if inches_per_hour >= 0.5:
        return Risk.MODERATE
    return Risk.LOW


def apply_load_rules(wind_mph: float, load_lbs: float, wind_level: Risk) -> Risk:
    """Escalate the wind level for heavy loads, per the brief's load rules."""
    if wind_mph >= 55:
        return Risk.NO_TRAVEL
    if wind_mph >= 45 and load_lbs > NO_TRAVEL_LOAD_LBS_AT_45_MPH:
        return Risk.NO_TRAVEL
    if wind_mph >= 35 and load_lbs > SEVERE_LOAD_LBS_AT_35_MPH:
        return max(wind_level, Risk.SEVERE)
    return wind_level


@dataclass(frozen=True)
class Conditions:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True)
class Assessment:
    level: Risk
    wind: Risk
    rain: Risk
    snow: Risk
    load_escalated: bool = False
    drivers: tuple[str, ...] = field(default_factory=tuple)


def assess(conditions: Conditions, load_lbs: float) -> Assessment:
    """Overall risk is the worst of wind (after load rules), rain and snow."""
    base_wind = classify_wind(conditions.wind_mph)
    wind = apply_load_rules(conditions.wind_mph, load_lbs, base_wind)
    rain = classify_rain(conditions.rain_in_hr)
    snow = classify_snow(conditions.snow_in_hr)
    level = max(wind, rain, snow)

    drivers: list[str] = []
    if level > Risk.LOW:
        if wind == level:
            note = f"wind {conditions.wind_mph:.0f} mph"
            if wind > base_wind:
                note += f" with {load_lbs:,.0f} lb load"
            drivers.append(note)
        if rain == level:
            drivers.append(f"rain {conditions.rain_in_hr:.2f} in/hr")
        if snow == level:
            drivers.append(f"snow {conditions.snow_in_hr:.2f} in/hr")

    return Assessment(
        level=level,
        wind=wind,
        rain=rain,
        snow=snow,
        load_escalated=wind > base_wind,
        drivers=tuple(drivers),
    )


def risk_level(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lbs: float) -> int:
    """Fast path for the heatmap grid, where only the level is needed."""
    return factor_levels(wind_mph, rain_in_hr, snow_in_hr, load_lbs)[0]


def factor_levels(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lbs: float) -> tuple[int, int, int]:
    """(overall, wind after load rules, precipitation) levels, for the map's layer switcher."""
    wind = apply_load_rules(wind_mph, load_lbs, classify_wind(wind_mph))
    precip = max(classify_rain(rain_in_hr), classify_snow(snow_in_hr))
    return int(max(wind, precip)), int(wind), int(precip)
