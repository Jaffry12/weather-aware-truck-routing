"""Fallback place search: Open-Meteo's geocoding API (cities only, ranked by population, no key).

Used when Photon, the primary search, is unavailable: its public server throttles
bursts of requests, and a hosted app shares its IP with other users.
"""

from __future__ import annotations

from django.conf import settings

from .http import cached, get_json

SEARCH_TTL_SECONDS = 24 * 3600


def search(query: str, limit: int = 6) -> list[dict]:
    params = {"name": query, "count": str(limit), "language": "en", "format": "json"}
    data = cached("city-search", sorted(params.items()), SEARCH_TTL_SECONDS,
                  lambda: get_json(settings.CITY_SEARCH_URL, params))
    out, seen = [], set()
    for place in data.get("results", []) if isinstance(data, dict) else []:
        label = ", ".join(p for p in (place.get("name"), place.get("admin1"), place.get("country")) if p)
        if label in seen:
            continue
        seen.add(label)
        out.append({"label": label, "lat": place["latitude"], "lon": place["longitude"]})
    return out
