import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { RISK_COLORS, RISK_LEVELS, formatDayTime, formatDuration, formatMiles, placeName } from "../risk";
import { boundsOf, headingWest, heatmapFrames, labelPoints, positionAt } from "../routeMath";
import type { Theme } from "../theme";
import { type Timeline, useTimeline } from "../timeline";
import type { Checkpoint, RiskLabel, RouteOption, TripPlan } from "../types";

export type WeatherLayer = "risk" | "precip" | "wind";

// OpenFreeMap (free, no key): Liberty has land cover, relief and US interstate
// shields; Dark is its near-black counterpart. AWS's open terrain tiles add
// hillshading under both.
const STYLES: Record<Theme, string> = {
  light: "https://tiles.openfreemap.org/styles/liberty",
  dark: "https://tiles.openfreemap.org/styles/dark",
};
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const LAYER_PROPERTY: Record<WeatherLayer, string> = { risk: "r", precip: "p", wind: "w" };
// Two copies of the weather layer: the current hour and the next one, cross-faded
// as the forecast time moves between them.
const HEAT_LAYERS = ["heat", "heat-next"] as const;

/** Per-theme look of the layers this app draws (route colours come from CSS; see routeColors). */
const PALETTE = {
  light: {
    lowOpacity: 0.3,
    riskOpacity: 0.62,
    hillshade: { exaggeration: 0.35, shadow: "#4b5d6b", highlight: "#ffffff", accent: "#6b7f72" },
  },
  dark: {
    lowOpacity: 0.15,
    riskOpacity: 0.5,
    hillshade: { exaggeration: 0.45, shadow: "#000000", highlight: "#3b4a63", accent: "#1c2533" },
  },
} satisfies Record<Theme, unknown>;

const riskColor = (property: string) =>
  [
    "match",
    ["get", property],
    0, RISK_COLORS.Low,
    1, RISK_COLORS.Moderate,
    2, RISK_COLORS.High,
    3, RISK_COLORS.Severe,
    RISK_COLORS["No Travel"],
  ] as unknown as maplibregl.ExpressionSpecification;

/** Weather disc opacity: the theme's level-based opacity, scaled by the cross-fade weight. */
const heatOpacity = (property: string, theme: Theme, weight: number) =>
  ["*", weight, ["match", ["get", property], 0, PALETTE[theme].lowOpacity, PALETTE[theme].riskOpacity]] as
    unknown as maplibregl.ExpressionSpecification;

/**
 * Disc radius (px, by zoom) that covers `miles` on the ground at latitude `lat`.
 * MapLibre's world is 512 px wide at zoom 0 and doubles with each zoom level;
 * above zoom 9 the discs stop growing, since street level adds no forecast detail.
 */
function discRadius(miles: number, lat: number): maplibregl.ExpressionSpecification {
  const pxPerMileAtZ0 = 512 / (24_901 * Math.cos((lat * Math.PI) / 180));
  const r0 = miles * pxPerMileAtZ0;
  return ["interpolate", ["exponential", 2], ["zoom"], 0, r0, 9, r0 * 2 ** 9];
}

/** Route colours from the active theme's CSS variables, so a palette is defined in one place. */
function routeColors() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    casing: read("--route-casing", "#ffffff"),
    selected: read("--route-selected", "#1d4ed8"),
    other: read("--route-other", "#7b8794"),
    checkpointStroke: read("--route-casing", "#ffffff"),
  };
}

/** Add the terrain, weather, route and checkpoint layers to a freshly loaded basemap. */
function addOverlays(map: maplibregl.Map, theme: Theme) {
  const p = { ...PALETTE[theme], ...routeColors() };
  const layers = map.getStyle().layers;
  const firstLine = layers.find((l) => /^(water|waterway|tunnel|road|bridge|highway)/.test(l.id))?.id;
  const firstLabel = layers.find((l) => l.type === "symbol")?.id;

  // Relief shading under the water and roads, for the terrain look.
  map.addSource("terrain", { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 12 });
  map.addLayer(
    {
      id: "hillshade",
      type: "hillshade",
      source: "terrain",
      paint: {
        "hillshade-exaggeration": p.hillshade.exaggeration,
        "hillshade-shadow-color": p.hillshade.shadow,
        "hillshade-highlight-color": p.hillshade.highlight,
        "hillshade-accent-color": p.hillshade.accent,
      },
    },
    firstLine,
  );

  // The weather layer is a field of soft discs, one per forecast point, each in
  // its own risk colour. Unlike a density heatmap, overlapping Low points can
  // never add up to look like Moderate, so the colour always means the rule's level.
  for (const id of HEAT_LAYERS) {
    map.addSource(id, { type: "geojson", data: EMPTY });
    map.addLayer(
      {
        id,
        type: "circle",
        source: id,
        layout: { "circle-sort-key": ["get", "r"] },
        paint: {
          "circle-color": riskColor("r"),
          "circle-opacity": 0,
          // Opacity changes every animation frame during playback; skip MapLibre's easing.
          // (Valid style spec, but missing from MapLibre's paint typings.)
          "circle-opacity-transition": { duration: 0, delay: 0 },
          "circle-blur": 1,
          "circle-radius": 0,
        } as maplibregl.CircleLayerSpecification["paint"],
      },
      firstLabel,
    );
  }

  map.addSource("routes", { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "routes-casing",
    type: "line",
    source: "routes",
    layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
    paint: { "line-color": p.casing, "line-width": ["case", ["get", "selected"], 11, 8] },
  });
  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
    paint: {
      "line-color": ["case", ["get", "selected"], p.selected, p.other],
      "line-width": ["case", ["get", "selected"], 6, 4],
    },
  });

  // Checkpoints of every route; the selected route's are larger and drawn on top.
  map.addSource("checkpoints", { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "checkpoints",
    type: "circle",
    source: "checkpoints",
    layout: { "circle-sort-key": ["case", ["get", "selected"], 1, 0] },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"],
        3, ["case", ["get", "selected"], 4, 2.6],
        7, ["case", ["get", "selected"], 7.5, 5]],
      "circle-color": riskColor("risk_level"),
      "circle-stroke-color": p.checkpointStroke,
      "circle-stroke-width": ["case", ["get", "selected"], 2, 1.25],
    },
  });
}

const COMPARISONS = new Set(["<", "<=", ">", ">="]);

/**
 * Make a comparison against a missing feature property simply false.
 * MapLibre already treats it as false, but logs a type warning per feature first.
 */
function guardComparisons(expr: unknown): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, left, right] = expr;
  if (typeof op === "string" && COMPARISONS.has(op) && expr.length === 3) {
    const leftIsGet = Array.isArray(left) && left[0] === "get";
    const rightIsGet = Array.isArray(right) && right[0] === "get";
    // A value that makes the comparison fail: huge for "x < n", tiny for "x > n" (mirrored on the right).
    const fallback = (lessThan: boolean) => (lessThan ? 1e9 : -1e9);
    return [
      op,
      leftIsGet ? ["coalesce", left, fallback(op.startsWith("<"))] : guardComparisons(left),
      rightIsGet ? ["coalesce", right, fallback(op.startsWith(">"))] : guardComparisons(right),
    ];
  }
  return expr.map(guardComparisons);
}

/** Tidy third-party basemap expressions that read properties some features lack. */
function quietBasemapWarnings(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers) {
    if (!("filter" in layer) || !layer.filter) continue;
    const guarded = guardComparisons(layer.filter);
    if (JSON.stringify(guarded) !== JSON.stringify(layer.filter)) {
      map.setFilter(layer.id, guarded as maplibregl.FilterSpecification);
    }
  }
  // Liberty's 3D buildings read heights that some buildings lack.
  if (map.getLayer("building-3d")) {
    map.setPaintProperty("building-3d", "fill-extrusion-height", ["coalesce", ["get", "render_height"], 0]);
    map.setPaintProperty("building-3d", "fill-extrusion-base", ["coalesce", ["get", "render_min_height"], 0]);
  }
}

/** Light/dark switch, built as a map control so it stacks under the zoom buttons. */
class ThemeControl implements maplibregl.IControl {
  private container = document.createElement("div");
  private button = document.createElement("button");

  constructor(onToggle: () => void) {
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group theme-control";
    this.button.type = "button";
    this.button.addEventListener("click", onToggle);
    this.container.append(this.button);
  }

  show(theme: Theme) {
    const next = theme === "dark" ? "light" : "dark";
    this.button.title = `Switch to ${next} mode`;
    this.button.setAttribute("aria-label", `Switch to ${next} mode`);
    this.button.innerHTML = theme === "dark" ? SUN_SVG : MOON_SVG;
  }

  onAdd() {
    return this.container;
  }

  onRemove() {
    this.container.remove();
  }
}

interface Props {
  plan: TripPlan | null;
  places: { origin: string; destination: string } | null;
  selectedRouteId: string | null;
  timeline: Timeline;
  layer: WeatherLayer;
  theme: Theme;
  focus: { checkpoint: Checkpoint; key: number } | null;
  onSelectRoute: (id: string) => void;
  onToggleTheme: () => void;
}

export default function MapView(props: Props) {
  const { plan, places, selectedRouteId, timeline, layer, theme, focus, onSelectRoute, onToggleTheme } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const themeControlRef = useRef<ThemeControl | null>(null);
  const pinnedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const truckMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const tagMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const selectRef = useRef(onSelectRoute);
  const toggleThemeRef = useRef(onToggleTheme);
  const themeRef = useRef(theme);
  const shownThemeRef = useRef(theme);
  const shownHourRef = useRef(-1);
  // Bumped every time a basemap finishes loading and our layers are (re)added,
  // so the effects below repaint their data onto the new style.
  const [styleVersion, setStyleVersion] = useState(0);
  const ready = styleVersion > 0;
  const t = useTimeline(timeline);

  selectRef.current = onSelectRoute;
  toggleThemeRef.current = onToggleTheme;
  themeRef.current = theme;

  const frames = useMemo(() => (plan?.heatmap ? heatmapFrames(plan.heatmap) : []), [plan]);

  // Build the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLES[themeRef.current],
      center: [-98, 39],
      zoom: 3.6,
      attributionControl: { compact: true, customAttribution: "Terrain: Mapzen, AWS Open Data" },
      // When the map sits below the sidebar (narrow screens) the page scrolls, so
      // one-finger drags and plain wheel scrolls should move the page, not the map.
      cooperativeGestures: window.matchMedia("(max-width: 1024px)").matches,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const themeControl = new ThemeControl(() => toggleThemeRef.current());
    themeControl.show(themeRef.current);
    map.addControl(themeControl, "top-right");
    themeControlRef.current = themeControl;

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 16,
      maxWidth: "320px",
      className: "cp-popup",
    });
    popup.on("close", () => (pinnedRef.current = false));
    popupRef.current = popup;

    // The Liberty basemap references a few icons its sprite sheet lacks ("circle-11");
    // answer with a blank image instead of letting MapLibre warn on every tile.
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    map.on("style.load", () => {
      quietBasemapWarnings(map);
      addOverlays(map, shownThemeRef.current);
      shownHourRef.current = -1;
      setStyleVersion((v) => v + 1);
    });

    // Layer-scoped handlers survive basemap swaps, so they are registered once.
    const show = (cp: CheckpointPayload) => popup.setLngLat([cp.lon, cp.lat]).setHTML(checkpointHtml(cp)).addTo(map);
    const checkpointAt = (e: maplibregl.MapLayerMouseEvent) => {
      const payload = e.features?.[0]?.properties?.payload;
      return payload ? (JSON.parse(payload) as CheckpointPayload) : null;
    };
    map.on("click", "routes-line", (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) selectRef.current(String(id));
    });
    for (const id of ["routes-line", "checkpoints"]) {
      map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
    }
    // Hover previews a checkpoint; a click pins it until closed.
    map.on("mousemove", "checkpoints", (e) => {
      const cp = checkpointAt(e);
      if (cp && !pinnedRef.current) show(cp);
    });
    map.on("mouseleave", "checkpoints", () => {
      if (!pinnedRef.current) popup.remove();
    });
    map.on("click", "checkpoints", (e) => {
      const cp = checkpointAt(e);
      if (!cp) return;
      show(cp);
      pinnedRef.current = true;
    });
    map.on("click", (e) => {
      const onCheckpoint = map.getLayer("checkpoints") &&
        map.queryRenderedFeatures(e.point, { layers: ["checkpoints"] }).length > 0;
      if (pinnedRef.current && !onCheckpoint) popup.remove();
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  // Theme switch: swap the basemap; "style.load" re-adds our layers in the new colours.
  useEffect(() => {
    themeControlRef.current?.show(theme);
    const map = mapRef.current;
    if (!map || !ready || shownThemeRef.current === theme) return;
    shownThemeRef.current = theme;
    popupRef.current?.remove();
    map.setStyle(STYLES[theme], { diff: false });
  }, [theme, ready]);

  // New plan: pins, route tags, trucks and camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const markers of [truckMarkersRef.current, tagMarkersRef.current]) {
      markers.forEach((m) => m.remove());
      markers.clear();
    }
    popupRef.current?.remove();
    if (!plan) return;

    const first = plan.routes[0];
    const start = first.geometry[0];
    const end = first.geometry[first.geometry.length - 1];
    markersRef.current = [
      new maplibregl.Marker({ element: endpointPin("A", "#16a34a", places?.origin), anchor: "bottom" })
        .setLngLat(start).addTo(map),
      new maplibregl.Marker({ element: endpointPin("B", "#dc2626", places?.destination), anchor: "bottom" })
        .setLngLat(end).addTo(map),
    ];

    const tagSpots = labelPoints(plan.routes);
    plan.routes.forEach((route, i) => {
      const tag = routeTag(route);
      tag.addEventListener("click", () => selectRef.current(route.id));
      tagMarkersRef.current.set(route.id, new maplibregl.Marker({ element: tag }).setLngLat(tagSpots[i]).addTo(map));

      const truck = document.createElement("div");
      truck.className = "truck-marker";
      truck.innerHTML = TRUCK_SVG;
      truck.title = `${route.name} truck`;
      truckMarkersRef.current.set(route.id, new maplibregl.Marker({ element: truck }).setLngLat(start).addTo(map));
    });

    // Leave room for the layer switcher and forecast panel; phones get tighter margins.
    const narrow = map.getContainer().clientWidth < 600;
    map.fitBounds(boundsOf(plan.routes), {
      padding: narrow ? { top: 80, bottom: 190, left: 56, right: 56 } : { top: 100, bottom: 200, left: 70, right: 80 },
      duration: 900,
      maxZoom: 9,
    });
  }, [plan, places, ready]);

  // Route styling and every route's checkpoints follow the selection.
  useEffect(() => {
    const map = mapRef.current;
    const routes = map?.getSource("routes") as GeoJSONSource | undefined;
    const checkpoints = map?.getSource("checkpoints") as GeoJSONSource | undefined;
    if (!routes || !checkpoints) return;
    if (!plan) {
      routes.setData(EMPTY);
      checkpoints.setData(EMPTY);
      return;
    }
    routes.setData({
      type: "FeatureCollection",
      features: plan.routes.map((r) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: r.geometry },
        properties: { id: r.id, selected: r.id === selectedRouteId },
      })),
    });
    checkpoints.setData({
      type: "FeatureCollection",
      features: plan.routes.flatMap((route) =>
        route.checkpoints.map((cp) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [cp.lon, cp.lat] },
          properties: {
            risk_level: cp.risk_level,
            selected: route.id === selectedRouteId,
            payload: JSON.stringify({ ...cp, route: route.name } satisfies CheckpointPayload),
          },
        })),
      ),
    });
    for (const markers of [truckMarkersRef.current, tagMarkersRef.current]) {
      markers.forEach((marker, id) => marker.getElement().classList.toggle("selected", id === selectedRouteId));
    }
    popupRef.current?.remove();
  }, [plan, selectedRouteId, styleVersion]);

  // Weather layer look: which property drives the colour, and the disc size.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("heat")) return;
    const property = LAYER_PROPERTY[layer];
    const radius = plan?.heatmap ? discRadius(plan.heatmap.spacing_miles * 1.4, midLatitude(plan.heatmap.points)) : 0;
    for (const id of HEAT_LAYERS) {
      map.setPaintProperty(id, "circle-color", riskColor(property));
      map.setLayoutProperty(id, "circle-sort-key", ["get", property]);
      map.setPaintProperty(id, "circle-radius", radius);
    }
  }, [layer, plan, styleVersion]);

  // A new plan starts its frames afresh. (Declared before the effect below, so it runs first.)
  useEffect(() => {
    shownHourRef.current = -1;
  }, [frames]);

  // Forecast time (fractional hours): cross-fade the two hourly frames around it
  // and glide the trucks to where they would be at that moment.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("heat") || !plan?.heatmap) return;
    const hour = Math.min(Math.floor(t), frames.length - 1);
    const fade = Math.min(1, t - hour);
    if (shownHourRef.current !== hour) {
      (map.getSource("heat") as GeoJSONSource).setData(frames[hour] ?? EMPTY);
      (map.getSource("heat-next") as GeoJSONSource).setData(frames[hour + 1] ?? frames[hour] ?? EMPTY);
      shownHourRef.current = hour;
    }
    const property = LAYER_PROPERTY[layer];
    map.setPaintProperty("heat", "circle-opacity", heatOpacity(property, shownThemeRef.current, 1 - fade));
    map.setPaintProperty("heat-next", "circle-opacity", heatOpacity(property, shownThemeRef.current, fade));

    const elapsed = (new Date(plan.heatmap.start).getTime() + t * 3600_000 - new Date(plan.departure).getTime()) / 1000;
    for (const route of plan.routes) {
      const marker = truckMarkersRef.current.get(route.id);
      if (!marker) continue;
      marker.setLngLat(positionAt(route, elapsed));
      marker.getElement().classList.toggle("west", headingWest(route, elapsed));
    }
  }, [t, frames, plan, layer, styleVersion]);

  // Jump to a checkpoint picked in the table, and pin its details.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus || !plan) return;
    const cp = focus.checkpoint;
    const route = plan.routes.find((r) => r.checkpoints.includes(cp));
    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 7), duration: 700 });
    popupRef.current!.setLngLat([cp.lon, cp.lat])
      .setHTML(checkpointHtml({ ...cp, route: route?.name ?? "" })).addTo(map);
    pinnedRef.current = true;
  }, [focus, ready, plan]);

  return <div ref={container} className="map" aria-label="Route map" />;
}

type CheckpointPayload = Checkpoint & { route: string };

const midLatitude = (points: [number, number][]) =>
  points.reduce((sum, p) => sum + p[1], 0) / Math.max(1, points.length);

const TRUCK_SVG = `<svg viewBox="0 0 40 24" width="34" height="20" aria-hidden="true">
  <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h19A2.5 2.5 0 0 1 26 4.5V18H2z" fill="currentColor" stroke="#fff" stroke-width="1.6"/>
  <path d="M26 7.5h6.5l5.5 6V18H26z" fill="currentColor" stroke="#fff" stroke-width="1.6"/>
  <path d="M28.5 9.5h3.4l3.4 3.7h-6.8z" fill="#e2e8f0"/>
  <circle cx="9" cy="19" r="3.2" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
  <circle cx="31" cy="19" r="3.2" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
</svg>`;

const ICON_ATTRS = 'viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const MOON_SVG = `<svg ${ICON_ATTRS}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;
const SUN_SVG = `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="4"/>` +
  '<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

/** Map tag with the route's summary: name, time, distance, and its worst risk as a dot. */
function routeTag(route: RouteOption): HTMLElement {
  const tag = document.createElement("button");
  tag.type = "button";
  tag.className = "route-tag";
  tag.innerHTML = `
    <span class="route-tag-name">${escapeHtml(route.name)}${route.is_recommended ? " <span aria-hidden=\"true\">★</span>" : ""}</span>
    <span class="route-tag-meta">
      <i style="background:${RISK_COLORS[route.max_risk]}"></i>${formatDuration(route.duration_minutes)} · ${formatMiles(route.distance_miles)}
    </span>`;
  tag.title = `${route.name} via ${route.summary}: ${formatDuration(route.duration_minutes)}, ` +
    `${formatMiles(route.distance_miles)}, arrives ${formatDayTime(route.arrival)}, worst risk ${route.max_risk}`;
  return tag;
}

function endpointPin(letter: string, color: string, label?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "endpoint";
  el.innerHTML = `
    <svg class="endpoint-pin" viewBox="0 0 34 44" width="34" height="44" aria-hidden="true">
      <path d="M17 42.5S3 28.4 3 17.2a14 14 0 0 1 28 0C31 28.4 17 42.5 17 42.5z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
      <text x="17" y="22" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="700" fill="#fff">${letter}</text>
    </svg>
    ${label ? `<span class="endpoint-name">${escapeHtml(placeName(label))}</span>` : ""}`;
  return el;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const POPUP_ICONS = {
  wind: '<path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.6-3.6M3 12.5h15.5a2.75 2.75 0 1 1-2.6 3.6M3 16.5h7"/>',
  rain: '<path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
};

function checkpointHtml(cp: CheckpointPayload): string {
  const row = (icon: keyof typeof POPUP_ICONS, label: string, value: string, risk: RiskLabel) => `
    <div class="cp-row">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${POPUP_ICONS[icon]}</svg>
      <span class="cp-label">${label}</span>
      <span class="cp-value risk-text-${RISK_LEVELS.indexOf(risk)}">${value} · ${escapeHtml(risk)}</span>
    </div>`;
  const notes = [
    cp.load_escalated ? "Wind risk raised by the load-weight rules." : "",
    cp.drivers.length ? `Driven by ${escapeHtml(cp.drivers.join(", "))}.` : "",
  ].filter(Boolean);
  return `
    <div class="cp">
      ${cp.route ? `<div class="cp-route">${escapeHtml(cp.route)}</div>` : ""}
      <div class="cp-head">Mile ${cp.mile.toFixed(0)} · ETA ${escapeHtml(formatDayTime(cp.eta))}</div>
      ${row("wind", "Wind", `${cp.wind_mph.toFixed(0)} mph`, cp.wind_risk)}
      ${row("rain", "Rain", `${cp.rain_in_hr.toFixed(2)} in/hr`, cp.rain_risk)}
      ${row("snow", "Snow", `${cp.snow_in_hr.toFixed(2)} in/hr`, cp.snow_risk)}
      ${notes.length ? `<div class="cp-note">${notes.join(" ")}</div>` : ""}
    </div>`;
}
