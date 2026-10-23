"""Shared HTTP session with retries, plus a small cache helper."""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from typing import TypeVar

import requests
from django.core.cache import cache
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

T = TypeVar("T")

USER_AGENT = "weather-aware-truck-routing/1.0"
TIMEOUT_SECONDS = 20


class UpstreamError(Exception):
    """A third-party API failed or returned something unusable."""


class RateLimited(UpstreamError):
    """A free-tier API is throttling us; retrying in a minute usually works."""


def _make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.4, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=frozenset({"GET"}))
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers["User-Agent"] = USER_AGENT
    return session


session = _make_session()


def get_json(url: str, params: dict | None = None, error_statuses: tuple[int, ...] = ()) -> object:
    """GET JSON. Statuses in `error_statuses` return their JSON body for the caller to interpret."""
    host = url.split("/")[2]
    try:
        resp = session.get(url, params=params, timeout=TIMEOUT_SECONDS)
    except requests.exceptions.RetryError as exc:
        # Retries ran out: throttling ("too many 429 error responses") or a server outage (5xx).
        if "429" in str(exc):
            raise RateLimited(f"{host} is busy (free-tier rate limit). Please try again in a minute.") from exc
        raise UpstreamError(f"{host} is not responding right now. Please try again shortly.") from exc
    except requests.RequestException as exc:
        # Don't echo the full URL (it can be thousands of coordinates long).
        raise UpstreamError(f"Could not reach {host} ({type(exc).__name__}).") from exc
    if resp.status_code == 429:
        raise RateLimited(f"{host} is busy (free-tier rate limit). Please try again in a minute.")
    if resp.status_code in error_statuses:
        try:
            return resp.json()
        except ValueError:
            pass
    if resp.status_code >= 400:
        raise UpstreamError(f"{host} returned HTTP {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def cached(namespace: str, key_parts: object, ttl_seconds: int, fn: Callable[[], T]) -> T:
    key = f"{namespace}:{hashlib.sha1(repr(key_parts).encode()).hexdigest()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    value = fn()
    cache.set(key, value, ttl_seconds)
    return value
