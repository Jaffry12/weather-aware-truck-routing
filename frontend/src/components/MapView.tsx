import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { RISK_COLORS, RISK_TEXT, formatDayTime, placeName } from "../risk";
import { boundsOf, headingWest, heatmapFrames, hourTime, labelPoints, positionAt } from "../routeMath";
import type { Checkpoint, RiskLabel, TripPlan } from "../types";

export type WeatherLayer = "risk" | "precip" | "wind";

// OpenFreeMap's Liberty style (free, no key) has land cover, relief and US
// interstate shields; AWS's open terrain tiles add hillshading at closer zooms.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const LAYER_PROPERTY: Record<WeatherLayer, string> = { risk: "r", precip: "p", wind: "w" };

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

interface Props {
  plan: TripPlan | null;
  places: { origin: string; destination: string } | null;
  selectedRouteId: string | null;
  hour: number;
  layer: WeatherLayer;
  focus: { checkpoint: Checkpoint; key: number } | null;
  onSelectRoute: (id: string) => void;
}

export default function MapView({ plan, places, selectedRouteId, hour, layer, focus, onSelectRoute }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pinnedRef = useRef(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const truckMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const tagMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const selectRef = useRef(onSelectRoute);
  const [loaded, setLoaded] = useState(false);

  selectRef.current = onSelectRoute;

  const frames = useMemo(() => (plan?.heatmap ? heatmapFrames(plan.heatmap) : []), [plan]);

  // Build the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [-98, 39],
      zoom: 3.6,
      attributionControl: { compact: true, customAttribution: "Terrain: Mapzen, AWS Open Data" },
      // When the map sits below the sidebar (narrow screens) the page scrolls, so
      // one-finger drags and plain wheel scrolls should move the page, not the map.
      cooperativeGestures: window.matchMedia("(max-width: 860px)").matches,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 16,
      maxWidth: "320px",
      className: "cp-popup",
    });
    popup.on("close", () => (pinnedRef.current = false));
    popupRef.current = popup;

    map.on("load", () => {
      const layers = map.getStyle().layers;
      const firstLine = layers.find((l) => /^(water|waterway|tunnel|road|bridge)/.test(l.id))?.id;
      const firstLabel = layers.find((l) => l.type === "symbol")?.id;

      // Relief shading under the water and roads, for the terrain look.
      map.addSource("terrain", {
        type: "raster-dem",
        tiles: [TERRAIN_TILES],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 12,
      });
      map.addLayer(
        {
          id: "hillshade",
          type: "hillshade",
          source: "terrain",
          paint: {
            "hillshade-exaggeration": 0.35,
            "hillshade-shadow-color": "#4b5d6b",
            "hillshade-highlight-color": "#ffffff",
            "hillshade-accent-color": "#6b7f72",
          },
        },
        firstLine,
      );

      // The weather layer is a field of soft discs, one per forecast point, each in
      // its own risk colour. Unlike a density heatmap, overlapping Low points can
      // never add up to look like Moderate, so the colour always means the rule's level.
      map.addSource("heat", { type: "geojson", data: EMPTY });
      map.addLayer(
        {
          id: "heat",
          type: "circle",
          source: "heat",
          layout: { "circle-sort-key": ["get", "r"] },
          paint: {
            "circle-color": riskColor("r"),
            "circle-opacity": ["match", ["get", "r"], 0, 0.3, 0.62],
            "circle-blur": 1,
            "circle-radius": 0,
          },
        },
        firstLabel,
      );

      map.addSource("routes", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
        paint: { "line-color": "#ffffff", "line-width": ["case", ["get", "selected"], 11, 8] },
      });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
        paint: {
          "line-color": ["case", ["get", "selected"], "#1d4ed8", "#7b8794"],
          "line-width": ["case", ["get", "selected"], 6, 4],
        },
      });

      map.addSource("checkpoints", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "checkpoints",
        type: "circle",
        source: "checkpoints",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 7, 7.5],
          "circle-color": riskColor("risk_level"),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      const show = (cp: Checkpoint) => popup.setLngLat([cp.lon, cp.lat]).setHTML(checkpointHtml(cp)).addTo(map);
      const checkpointAt = (e: maplibregl.MapLayerMouseEvent) => {
        const payload = e.features?.[0]?.properties?.payload;
        return payload ? (JSON.parse(payload) as Checkpoint) : null;
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
        if (pinnedRef.current && !map.queryRenderedFeatures(e.point, { layers: ["checkpoints"] }).length) {
          popup.remove();
        }
      });

      setLoaded(true);
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  // New plan: pins, route tags, trucks, disc size and camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const markers of [truckMarkersRef.current, tagMarkersRef.current]) {
      markers.forEach((m) => m.remove());
      markers.clear();
    }
    popupRef.current?.remove();
    if (!plan) return;

    if (plan.heatmap) {
      const lats = plan.heatmap.points.map((p) => p[1]);
      const midLat = lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length);
      map.setPaintProperty("heat", "circle-radius", discRadius(plan.heatmap.spacing_miles * 1.4, midLat));
    }

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
      const tag = document.createElement("button");
      tag.type = "button";
      tag.className = "route-tag";
      tag.innerHTML = route.is_recommended ? `${route.name} <span aria-hidden>★</span>` : route.name;
      tag.title = `${route.name} via ${route.summary}`;
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
      padding: narrow ? { top: 80, bottom: 190, left: 56, right: 56 } : { top: 100, bottom: 200, left: 70, right: 70 },
      duration: 900,
      maxZoom: 9,
    });
  }, [plan, places, loaded]);

  // Route styling and checkpoints follow the selected route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const routes = map.getSource("routes") as GeoJSONSource;
    const checkpoints = map.getSource("checkpoints") as GeoJSONSource;
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
    const selected = plan.routes.find((r) => r.id === selectedRouteId);
    checkpoints.setData({
      type: "FeatureCollection",
      features: (selected?.checkpoints ?? []).map((cp) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [cp.lon, cp.lat] },
        properties: { risk_level: cp.risk_level, payload: JSON.stringify(cp) },
      })),
    });
    for (const markers of [truckMarkersRef.current, tagMarkersRef.current]) {
      markers.forEach((marker, id) => marker.getElement().classList.toggle("selected", id === selectedRouteId));
    }
    popupRef.current?.remove();
  }, [plan, selectedRouteId, loaded]);

  // Weather layer switcher: same frames, a different property drives the colour.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const property = LAYER_PROPERTY[layer];
    map.setPaintProperty("heat", "circle-color", riskColor(property));
    map.setPaintProperty("heat", "circle-opacity", ["match", ["get", property], 0, 0.3, 0.62]);
    map.setLayoutProperty("heat", "circle-sort-key", ["get", property]);
  }, [layer, loaded]);

  // The forecast slider: swap a prebuilt frame and move the trucks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("heat") as GeoJSONSource).setData(frames[hour] ?? EMPTY);
    if (!plan?.heatmap) return;
    const elapsed = (hourTime(plan.heatmap, hour).getTime() - new Date(plan.departure).getTime()) / 1000;
    for (const route of plan.routes) {
      const marker = truckMarkersRef.current.get(route.id);
      if (!marker) continue;
      marker.setLngLat(positionAt(route, elapsed));
      marker.getElement().classList.toggle("west", headingWest(route, elapsed));
    }
  }, [frames, hour, plan, loaded]);

  // Jump to a checkpoint picked in the table, and pin its details.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !focus) return;
    const cp = focus.checkpoint;
    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 7), duration: 700 });
    popupRef.current!.setLngLat([cp.lon, cp.lat]).setHTML(checkpointHtml(cp)).addTo(map);
    pinnedRef.current = true;
  }, [focus, loaded]);

  return <div ref={container} className="map" aria-label="Route map" />;
}

const TRUCK_SVG = `<svg viewBox="0 0 40 24" width="34" height="20" aria-hidden="true">
  <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h19A2.5 2.5 0 0 1 26 4.5V18H2z" fill="currentColor" stroke="#fff" stroke-width="1.6"/>
  <path d="M26 7.5h6.5l5.5 6V18H26z" fill="currentColor" stroke="#fff" stroke-width="1.6"/>
  <path d="M28.5 9.5h3.4l3.4 3.7h-6.8z" fill="#e2e8f0"/>
  <circle cx="9" cy="19" r="3.2" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
  <circle cx="31" cy="19" r="3.2" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
</svg>`;

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

function checkpointHtml(cp: Checkpoint): string {
  const row = (icon: keyof typeof POPUP_ICONS, label: string, value: string, risk: RiskLabel) => `
    <div class="cp-row">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${POPUP_ICONS[icon]}</svg>
      <span class="cp-label">${label}</span>
      <span class="cp-value" style="color:${RISK_TEXT[risk]}">${value} · ${escapeHtml(risk)}</span>
    </div>`;
  const notes = [
    cp.load_escalated ? "Wind risk raised by the load-weight rules." : "",
    cp.drivers.length ? `Driven by ${escapeHtml(cp.drivers.join(", "))}.` : "",
  ].filter(Boolean);
  return `
    <div class="cp">
      <div class="cp-head">Mile ${cp.mile.toFixed(0)} · ETA ${escapeHtml(formatDayTime(cp.eta))}</div>
      ${row("wind", "Wind", `${cp.wind_mph.toFixed(0)} mph`, cp.wind_risk)}
      ${row("rain", "Rain", `${cp.rain_in_hr.toFixed(2)} in/hr`, cp.rain_risk)}
      ${row("snow", "Snow", `${cp.snow_in_hr.toFixed(2)} in/hr`, cp.snow_risk)}
      ${notes.length ? `<div class="cp-note">${notes.join(" ")}</div>` : ""}
    </div>`;
}
