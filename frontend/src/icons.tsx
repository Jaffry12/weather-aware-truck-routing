import type { SVGProps } from "react";

// Small inline icon set (24 px grid, drawn with the current text colour).

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.1-7-11.4A7 7 0 0 1 19 9.6C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);

export const SwapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
  </Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
  </Icon>
);

export const TruckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1V16h-12z" />
    <path d="M14.5 9h4l3 3.5V16h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17.5" cy="17.5" r="1.8" />
  </Icon>
);

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5h.01" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const CloudIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.3A3.4 3.4 0 0 0 7 18.5z" />
  </Icon>
);

export const DropIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z" />
  </Icon>
);

export const WindIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.6-3.6M3 12.5h15.5a2.75 2.75 0 1 1-2.6 3.6M3 16.5h7" />
  </Icon>
);

export const SnowIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l10.4-6.8a1 1 0 0 0 0-1.72L9.5 4.34A1 1 0 0 0 8 5.2z" />
  </Icon>
);

export const PauseIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="4" height="14" rx="1" />
    <rect x="13.5" y="5" width="4" height="14" rx="1" />
  </Icon>
);

export const StarIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M12 3.2l2.6 5.5 6 .7-4.5 4.1 1.2 5.9L12 16.4l-5.3 3 1.2-5.9-4.5-4.1 6-.7z" />
  </Icon>
);

export const ShieldCheckIcon = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
    <defs>
      <linearGradient id="shield-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#60a5fa" />
        <stop offset="1" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    <path d="M20 3.5 33 8.4v9.8c0 8.2-5.5 14.2-13 16.3C12.5 32.4 7 26.4 7 18.2V8.4z" fill="url(#shield-fill)" />
    <path d="m14 19.2 4.2 4.2 8-8.3" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"
      strokeLinejoin="round" />
  </svg>
);

/** Brand mark: a delivery truck under a weather cloud. */
export const Logo = () => (
  <svg width="66" height="41" viewBox="0 0 74 46" aria-hidden>
    <defs>
      <linearGradient id="logo-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#bfdbfe" />
        <stop offset="1" stopColor="#60a5fa" />
      </linearGradient>
      <linearGradient id="logo-truck" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#3b82f6" />
        <stop offset="1" stopColor="#1d4ed8" />
      </linearGradient>
    </defs>
    <path d="M22 24h30a8.5 8.5 0 0 0 1.2-16.9A12.5 12.5 0 0 0 29.6 6 9 9 0 0 0 22 24z" fill="url(#logo-cloud)" />
    <path d="M2 18h9M0 23h9M3 28h8" stroke="#93c5fd" strokeWidth="2.4" strokeLinecap="round" />
    <rect x="13" y="16" width="33" height="19" rx="3" fill="url(#logo-truck)" />
    <path d="M46 21h11l8 8.5V35H46z" fill="#1e40af" />
    <path d="M49 23.5h7l4.8 5H49z" fill="#dbeafe" />
    <circle cx="22" cy="37" r="4.6" fill="#0f172a" stroke="#fff" strokeWidth="2.2" />
    <circle cx="56" cy="37" r="4.6" fill="#0f172a" stroke="#fff" strokeWidth="2.2" />
  </svg>
);
