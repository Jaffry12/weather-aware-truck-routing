import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { RISK_COLORS, formatDayTime } from "../risk";
import { boundsOf, heatmapFrames, hourTime, labelPoints, positionAt } from "../routeMath";
import type { Checkpoint, TripPlan } from "../types";

const STYLE_URL = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

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
  selectedRouteId: string | null;
  hour: number;
  focus: { checkpoint: Checkpoint; key: number } | null;
  onSelectRoute: (id: string) => void;
}

export default function MapView({ plan, selectedRouteId, hour, focus, onSelectRoute }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
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
      center: [-96, 38.5],
      zoom: 3.6,
      attributionControl: { compact: true },
      // When the map sits below the sidebar (narrow screens) the page scrolls, so
      // one-finger drags and plain wheel scrolls should move the page, not the map.
      cooperativeGestures: window.matchMedia("(max-width: 860px)").matches,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: "280px" });

    map.on("load", () => {
      // Draw the heatmap under the basemap's labels so place names stay readable.
      const firstLabel = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
      // The weather layer is a field of soft discs, one per forecast point, each in
      // its own risk colour. Unlike a density heatmap, overlapping Low points can
      // never add up to look like Moderate, so the colour always means the rule's level.
      map.addSource("heat", { type: "geojson", data: EMPTY });
      map.addLayer(
        {
          id: "heat",
          type: "circle",
          source: "heat",
          layout: { "circle-sort-key": ["get", "w"] },
          paint: {
            "circle-color": riskColor("w"),
            "circle-opacity": ["match", ["get", "w"], 0, 0.3, 0.6],
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
        paint: { "line-color": "#ffffff", "line-width": ["case", ["get", "selected"], 10, 7] },
      });
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
        paint: {
          "line-color": ["case", ["get", "selected"], "#1d4ed8", "#64748b"],
          "line-width": ["case", ["get", "selected"], 6, 4],
          "line-opacity": ["case", ["get", "selected"], 1, 0.8],
        },
      });
      map.addSource("checkpoints", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "checkpoints",
        type: "circle",
        source: "checkpoints",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 8, 7],
          "circle-color": riskColor("risk_level"),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      map.on("click", "routes-line", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) selectRef.current(String(id));
      });
      for (const layer of ["routes-line", "checkpoints"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("mousemove", "checkpoints", (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        const cp = JSON.parse(props.payload) as Checkpoint;
        popupRef.current!.setLngLat([cp.lon, cp.lat]).setHTML(checkpointHtml(cp)).addTo(map);
      });
      map.on("mouseleave", "checkpoints", () => popupRef.current!.remove());

      setLoaded(true);
    });

    mapRef.current = map;
    return () => map.remove();
  }, []);

  // New plan: endpoint markers and camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const markers of [truckMarkersRef.current, tagMarkersRef.current]) {
      markers.forEach((m) => m.remove());
      markers.clear();
    }
    if (!plan) return;

    const first = plan.routes[0];
    const start = first.geometry[0];
    const end = first.geometry[first.geometry.length - 1];
    markersRef.current = [
      new maplibregl.Marker({ element: pin("A", "#0f172a") }).setLngLat(start).addTo(map),
      new maplibregl.Marker({ element: pin("B", "#0f172a") }).setLngLat(end).addTo(map),
    ];
    if (plan.heatmap) {
      const lats = plan.heatmap.points.map((p) => p[1]);
      const midLat = lats.reduce((a, b) => a + b, 0) / Math.max(1, lats.length);
      map.setPaintProperty("heat", "circle-radius", discRadius(plan.heatmap.spacing_miles * 1.4, midLat));
    }

    const tagSpots = labelPoints(plan.routes);
    plan.routes.forEach((route, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "route-tag";
      el.textContent = route.is_recommended ? `${route.name} ★` : route.name;
      el.title = `${route.name} via ${route.summary}`;
      el.addEventListener("click", () => selectRef.current(route.id));
      tagMarkersRef.current.set(route.id, new maplibregl.Marker({ element: el }).setLngLat(tagSpots[i]).addTo(map));
    });
    for (const route of plan.routes) {
      const el = document.createElement("div");
      el.className = "truck-marker";
      el.textContent = "🚚";
      el.title = route.name;
      truckMarkersRef.current.set(route.id, new maplibregl.Marker({ element: el }).setLngLat(start).addTo(map));
    }
    // Leave room for the forecast panel at the bottom; phones get tighter side margins.
    const narrow = map.getContainer().clientWidth < 600;
    map.fitBounds(boundsOf(plan.routes), {
      padding: narrow ? { top: 40, bottom: 150, left: 24, right: 24 } : { top: 60, bottom: 140, left: 60, right: 60 },
      duration: 900,
      maxZoom: 9,
    });
  }, [plan, loaded]);

  // Route styling and checkpoints follow the selected route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const routes = (map.getSource("routes") as GeoJSONSource);
    const checkpoints = (map.getSource("checkpoints") as GeoJSONSource);
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
        properties: {
          id: r.id,
          selected: r.id === selectedRouteId,
        },
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
  }, [plan, selectedRouteId, loaded]);

  // The forecast slider: swap a prebuilt heatmap frame and move the trucks.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource("heat") as GeoJSONSource).setData(frames[hour] ?? EMPTY);
    if (!plan?.heatmap) return;
    const elapsed = (hourTime(plan.heatmap, hour).getTime() - new Date(plan.departure).getTime()) / 1000;
    for (const route of plan.routes) {
      truckMarkersRef.current.get(route.id)?.setLngLat(positionAt(route, elapsed));
    }
  }, [frames, hour, plan, loaded]);

  // Jump to a checkpoint picked in the table.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !focus) return;
    const cp = focus.checkpoint;
    map.flyTo({ center: [cp.lon, cp.lat], zoom: Math.max(map.getZoom(), 7), duration: 700 });
    popupRef.current!.setLngLat([cp.lon, cp.lat]).setHTML(checkpointHtml(cp)).addTo(map);
  }, [focus, loaded]);

  return <div ref={container} className="map" aria-label="Route map" />;
}

function pin(text: string, color: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "endpoint-pin";
  el.style.background = color;
  el.textContent = text;
  return el;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function checkpointHtml(cp: Checkpoint): string {
  const chip = (label: string) =>
    `<span class="chip" style="background:${RISK_COLORS[label as keyof typeof RISK_COLORS]}">${escapeHtml(label)}</span>`;
  const why = cp.drivers.length ? `<div class="popup-why">Driven by ${escapeHtml(cp.drivers.join(", "))}</div>` : "";
  return `
    <div class="popup">
      <div class="popup-head"><strong>Mile ${cp.mile.toFixed(0)}</strong> ${chip(cp.risk)}</div>
      <div class="popup-eta">ETA ${escapeHtml(formatDayTime(cp.eta))}</div>
      <table>
        <tr><td>Wind</td><td>${cp.wind_mph.toFixed(0)} mph</td><td>${chip(cp.wind_risk)}</td></tr>
        <tr><td>Rain</td><td>${cp.rain_in_hr.toFixed(2)} in/hr</td><td>${chip(cp.rain_risk)}</td></tr>
        <tr><td>Snow</td><td>${cp.snow_in_hr.toFixed(2)} in/hr</td><td>${chip(cp.snow_risk)}</td></tr>
      </table>
      ${cp.load_escalated ? '<div class="popup-why">Wind risk raised by the load-weight rules.</div>' : ""}
      ${why}
    </div>`;
}
