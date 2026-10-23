"""Turn routes plus forecasts into checkpoints, route summaries and a recommendation.

The planner is pure: weather arrives as a callable, so tests can feed it fixed
conditions without touching the network.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import geo
from .risk import Assessment, Conditions, Risk, assess

# Trucks rarely sustain car speeds. Each segment's travel time is at least the
# time it would take at this speed. OSRM's car profile is otherwise optimistic.
TRUCK_MAX_MPH = 65.0


@dataclass
class Route:
    coords: list[geo.Point]
    cum_miles: list[float]
    cum_seconds: list[float]
    summary: str = ""

    @property
    def distance_miles(self) -> float:
        return self.cum_miles[-1]

    @property
    def duration_seconds(self) -> float:
        return self.cum_seconds[-1]


def build_route(coords: list[geo.Point], segment_seconds: Sequence[float] | None, summary: str = "",
                max_mph: float = TRUCK_MAX_MPH) -> Route:
    """Build a Route with truck-adjusted cumulative time at every vertex.

    `segment_seconds` comes from the routing engine's per-segment annotations.
    When it is missing or misaligned, time is spread by distance at `max_mph`.
    """
    cum_miles = geo.cumulative_miles(coords)
    seg_miles = [b - a for a, b in zip(cum_miles, cum_miles[1:])]
    if segment_seconds is None or len(segment_seconds) != len(seg_miles):
        segment_seconds = [m / max_mph * 3600 for m in seg_miles]
    cum_seconds = [0.0]
    for miles, secs in zip(seg_miles, segment_seconds):
        cum_seconds.append(cum_seconds[-1] + max(secs, miles / max_mph * 3600))
    return Route(coords=list(coords), cum_miles=cum_miles, cum_seconds=cum_seconds, summary=summary)


@dataclass(frozen=True)
class Checkpoint:
    mile: float
    point: geo.Point
    eta: datetime


def checkpoints_for(route: Route, departure: datetime, interval_miles: float) -> list[Checkpoint]:
    out = []
    for d in geo.sample_distances(route.distance_miles, interval_miles):
        secs = geo.value_at(route.cum_miles, route.cum_seconds, d)
        out.append(Checkpoint(mile=d, point=geo.point_at(route.coords, route.cum_miles, d),
                              eta=departure + timedelta(seconds=secs)))
    return out


@dataclass
class AssessedCheckpoint:
    checkpoint: Checkpoint
    conditions: Conditions
    assessment: Assessment
    miles_covered: float


@dataclass
class RouteEvaluation:
    route: Route
    checkpoints: list[AssessedCheckpoint]
    miles_by_level: dict[Risk, float] = field(default_factory=dict)
    average_risk: float = 0.0
    max_risk: Risk = Risk.LOW

    def sort_key(self) -> tuple:
        """Lexicographic preference from the brief, with No Travel ranked first.

        The brief lists: fewest Severe miles, fewest High miles, lowest average
        risk, shortest time. No Travel is worse than Severe, so any No Travel
        mileage is compared before all of them. Miles are rounded to 0.1 and
        average risk to 0.01 so that rounding noise never decides the winner.
        """
        m = self.miles_by_level
        return (
            round(m.get(Risk.NO_TRAVEL, 0.0), 1),
            round(m.get(Risk.SEVERE, 0.0), 1),
            round(m.get(Risk.HIGH, 0.0), 1),
            round(self.average_risk, 2),
            self.route.duration_seconds,
        )


def attribute_miles(miles: Sequence[float]) -> list[float]:
    """Give each checkpoint the stretch of road closer to it than to its neighbours."""
    n = len(miles)
    if n == 1:
        return [0.0]
    out = []
    for i in range(n):
        left = miles[0] if i == 0 else (miles[i - 1] + miles[i]) / 2
        right = miles[-1] if i == n - 1 else (miles[i] + miles[i + 1]) / 2
        out.append(right - left)
    return out


ConditionsLookup = Callable[[Sequence[Checkpoint]], Sequence[Conditions]]


def evaluate(route: Route, checkpoints: Sequence[Checkpoint], conditions: Sequence[Conditions],
             load_lbs: float) -> RouteEvaluation:
    covered = attribute_miles([c.mile for c in checkpoints])
    assessed = [
        AssessedCheckpoint(cp, cond, assess(cond, load_lbs), miles)
        for cp, cond, miles in zip(checkpoints, conditions, covered)
    ]
    miles_by_level = {level: 0.0 for level in Risk}
    for a in assessed:
        miles_by_level[a.assessment.level] += a.miles_covered
    total = sum(covered) or 1.0
    avg = sum(int(a.assessment.level) * a.miles_covered for a in assessed) / total
    worst = max((a.assessment.level for a in assessed), default=Risk.LOW)
    return RouteEvaluation(route=route, checkpoints=assessed, miles_by_level=miles_by_level,
                           average_risk=avg, max_risk=worst)


_CRITERIA = (
    ("No Travel miles", lambda e: e.sort_key()[0], "mi"),
    ("Severe miles", lambda e: e.sort_key()[1], "mi"),
    ("High-risk miles", lambda e: e.sort_key()[2], "mi"),
    ("average risk", lambda e: e.sort_key()[3], ""),
    ("travel time", lambda e: e.sort_key()[4], "time"),
)


def recommend(evaluations: Sequence[RouteEvaluation], names: Sequence[str]) -> tuple[int, str]:
    """Index of the best route and a one-line explanation of why it won."""
    best = min(range(len(evaluations)), key=lambda i: evaluations[i].sort_key())
    if len(evaluations) == 1:
        return best, "Only one route was available."
    reasons = []
    for i, other in enumerate(evaluations):
        if i == best:
            continue
        for label, getter, unit in _CRITERIA:
            mine, theirs = getter(evaluations[best]), getter(other)
            if mine != theirs:
                if unit == "time":
                    reasons.append(f"{_fmt_duration(theirs - mine)} faster than {names[i]}")
                elif unit == "mi":
                    reasons.append(f"fewer {label} than {names[i]} ({mine:g} vs {theirs:g} mi)")
                else:
                    reasons.append(f"lower {label} than {names[i]} ({mine:.2f} vs {theirs:.2f})")
                break
        else:
            reasons.append(f"ties with {names[i]}")
    text = "; ".join(reasons)
    return best, text[:1].upper() + text[1:] + "."


def _fmt_duration(seconds: float) -> str:
    minutes = int(round(seconds / 60))
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min" if h else f"{m} min"
