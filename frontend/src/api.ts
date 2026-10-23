import type { Place, TripPlan, TripRequest } from "./types";

// Same-origin in production (Vercel serves /api), proxied to Django in dev.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// The serverless function stops at 60 s, so a plan that takes longer is not coming back.
const PLAN_TIMEOUT_MS = 70_000;
const SEARCH_TIMEOUT_MS = 15_000;

export class ApiError extends Error {}

async function request<T>(path: string, timeoutMs: number, init: RequestInit = {}): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}${path}`, { ...init, signal });
  } catch (err) {
    if (timeout.aborted) {
      throw new ApiError("The routing or weather service is taking too long. Please try again in a moment.");
    }
    if (init.signal?.aborted) throw err;
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(describeError(body) ?? `Request failed (${resp.status}).`);
  }
  return body as T;
}

function describeError(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail;
  const first = Object.entries(record)[0];
  if (!first) return undefined;
  const [field, value] = first;
  const message = Array.isArray(value) ? value[0] : value;
  return typeof message === "string" ? `${field.replace(/_/g, " ")}: ${message}` : undefined;
}

export function searchPlaces(query: string, signal?: AbortSignal): Promise<{ results: Place[] }> {
  return request(`/api/geocode?q=${encodeURIComponent(query)}`, SEARCH_TIMEOUT_MS, { signal });
}

export function planTrip(body: TripRequest, signal?: AbortSignal): Promise<TripPlan> {
  return request("/api/plan", PLAN_TIMEOUT_MS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}
