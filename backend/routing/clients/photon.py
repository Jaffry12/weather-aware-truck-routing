"""Place search via Photon (OpenStreetMap data, no API key)."""

from __future__ import annotations

from django.conf import settings

from .http import cached, get_json

GEOCODE_TTL_SECONDS = 24 * 3600
# Lean gently toward the continental US, where the trucking rules apply. A strong
# bias (Photon's default) ranks small towns near the centre of the country above
# big cities: "kansas city" would suggest Cawker City, KS first.
BIAS_LAT, BIAS_LON = 39.5, -98.35
BIAS_ZOOM, BIAS_SCALE = 4, 0.1


def search(query: str, limit: int = 6) -> list[dict]:
    params = {"q": query, "limit": str(limit), "lang": "en", "lat": str(BIAS_LAT), "lon": str(BIAS_LON),
              "zoom": str(BIAS_ZOOM), "location_bias_scale": str(BIAS_SCALE)}
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
