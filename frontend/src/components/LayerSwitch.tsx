import { CloudIcon, DropIcon, WindIcon } from "../icons";
import type { WeatherLayer } from "./MapView";

const OPTIONS: { id: WeatherLayer; label: string; hint: string; Icon: typeof CloudIcon }[] = [
  { id: "risk", label: "Weather Risk", hint: "Overall risk: the worst of wind, rain and snow", Icon: CloudIcon },
  { id: "precip", label: "Precipitation", hint: "Risk from rain and snow only", Icon: DropIcon },
  { id: "wind", label: "Wind", hint: "Risk from wind only, including the load-weight rules", Icon: WindIcon },
];

interface Props {
  value: WeatherLayer;
  onChange: (layer: WeatherLayer) => void;
}

export default function LayerSwitch({ value, onChange }: Props) {
  return (
    <div className="layer-switch" role="radiogroup" aria-label="Map weather layer">
      {OPTIONS.map(({ id, label, hint, Icon }) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} title={hint}
          className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
