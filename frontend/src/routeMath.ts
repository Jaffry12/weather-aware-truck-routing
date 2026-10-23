import type { Heatmap, RouteOption } from "./types";

/** Where the truck is `seconds` after departure, interpolated along the route geometry. */
export function positionAt(route: RouteOption, seconds: number): [number, number] {
  const t = route.geometry_seconds;
  const g = route.geometry;
  if (seconds <= 0) return g[0];
  if (seconds >= t[t.length - 1]) return g[g.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= seconds) lo = mid;
    else hi = mid;
  }
  const f = (seconds - t[lo]) / (t[hi] - t[lo] || 1);
  return [g[lo][0] + (g[hi][0] - g[lo][0]) * f, g[lo][1] + (g[hi][1] - g[lo][1]) * f];
}

export const hourTime = (heatmap: Heatmap, hour: number): Date =>
  new Date(new Date(heatmap.start).getTime() + hour * 3600_000);

export function boundsOf(routes: RouteOption[]): [[number, number], [number, number]] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of routes) {
    for (const [x, y] of r.geometry) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [[minX, minY], [maxX, maxY]];
}

/**
 * A spot on each route for its name tag: the point (between 20% and 80% of the
 * trip) farthest from every other route, so tags don't stack where routes overlap.
 */
export function labelPoints(routes: RouteOption[]): [number, number][] {
  const samples = routes.map((r) => {
    const total = r.geometry_seconds[r.geometry_seconds.length - 1];
    return Array.from({ length: 25 }, (_, i) => positionAt(r, total * (0.2 + (0.6 * i) / 24)));
  });
  const all = routes.map((r) => r.geometry);
  return samples.map((candidates, i) => {
    let best = candidates[Math.floor(candidates.length / 2)];
    let bestGap = -1;
    for (const c of candidates) {
      let gap = Infinity;
      all.forEach((geometry, j) => {
        if (j === i) return;
        for (const [x, y] of geometry) gap = Math.min(gap, (x - c[0]) ** 2 + (y - c[1]) ** 2);
      });
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    return best;
  });
}

/** One GeoJSON FeatureCollection per forecast hour, built once per plan. */
export function heatmapFrames(heatmap: Heatmap): GeoJSON.FeatureCollection<GeoJSON.Point>[] {
  return heatmap.levels.map((row) => ({
    type: "FeatureCollection",
    features: heatmap.points.map((coordinates, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: { w: row[i] },
    })),
  }));
}
