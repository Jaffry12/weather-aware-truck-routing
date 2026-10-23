"""Place search via Photon (OpenStreetMap data, no API key)."""

from __future__ import annotations

from django.conf import settings

from .http import cached, get_json

GEOCODE_TTL_SECONDS = 24 * 3600
# Bias results toward the continental US, where the trucking rules apply.
BIAS_LAT, BIAS_LON = 39.5, -98.35


def search(query: str, limit: int = 6) -> list[dict]:
    params = {"q": query, "limit": str(limit), "lang": "en", "lat": str(BIAS_LAT), "lon": str(BIAS_LON)}
    data = cached("photon", sorted(params.items()), GEOCODE_TTL_SECONDS,
                  lambda: get_json(settings.PHOTON_URL, params))
    out, seen = [], set()
    for feature in data.get("features", []) if isinstance(data, dict) else []:
        props = feature.get("properties", {})
        lon, lat = feature["geometry"]["coordinates"]
        label = _label(props)
        if label in seen:
            continue
        seen.add(label)
        out.append({"label": label, "lat": lat, "lon": lon})
    return out


def _label(props: dict) -> str:
    parts = [props.get("name"), props.get("city") if props.get("city") != props.get("name") else None,
             props.get("state"), props.get("country")]
    return ", ".join(p for p in parts if p)
