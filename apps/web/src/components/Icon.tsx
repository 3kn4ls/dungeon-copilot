/** Iconos de trazo, a 24×24, que toman el color del texto. */
const ICONS = {
  campaigns: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  campaign: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />,
  room: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="3.5" r="1.5" />
      <circle cx="12" cy="20.5" r="1.5" />
      <circle cx="3.5" cy="12" r="1.5" />
      <circle cx="20.5" cy="12" r="1.5" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />,
  system: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor" />
    </>
  ),
  chronicle: (
    <>
      <path d="M8 4h10a2 2 0 012 2v2h-4" />
      <path d="M16 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2v-1h9" />
      <path d="M8 4a2 2 0 00-2 2v11" />
      <path d="M10 9h3M10 13h3" />
    </>
  ),
  characters: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0113 0" />
      <path d="M16 4.6a3.5 3.5 0 010 6.8M18 14a6.5 6.5 0 013.5 6" />
    </>
  ),
  npcs: (
    <>
      <path d="M4 6c3-1.5 13-1.5 16 0 0 7-3 12-8 12S4 13 4 6z" />
      <path d="M8 10h2.5M13.5 10H16" />
      <path d="M10 14.5c1.2.8 2.8.8 4 0" />
    </>
  ),
  secret: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  speak: <path d="M4 5h16v11H9l-5 4z" />,
  act: (
    <path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-2.8 0-4.4-1.6-5.8-3.8L3.3 13a1.5 1.5 0 012.5-1.6L8 13" />
  ),
  ask: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17.2v.1" />
    </>
  ),
  melee: (
    <>
      <path d="M20 4l-9.5 9.5M20 4h-4M20 4v4" />
      <path d="M7 12l5 5M9.5 14.5L4 20" />
    </>
  ),
  ranged: (
    <>
      <path d="M6 3c7 3 9 12 3 18" />
      <path d="M6 3v18M4 12h15M16 9l3 3-3 3" />
    </>
  ),
  spell: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  enter: (
    <>
      <path d="M10 3h9v18h-9" />
      <path d="M3 12h11M10 8l4 4-4 4" />
    </>
  ),
  exit: (
    <>
      <path d="M14 3H5v18h9" />
      <path d="M10 12h11M17 8l4 4-4 4" />
    </>
  ),
  map: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  pointer: <path d="M6 3l12 7.5-5.2 1.3 3.2 6.2-2.6 1.3-3.2-6.2L6 17z" />,
  ruler: (
    <>
      <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
      <path d="M6.5 8v3M10.5 8v4M14.5 8v3M18.5 8v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.8A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3 3.8M6.2 7.6A15.6 15.6 0 002.5 12S6 18.5 12 18.5a9 9 0 004.2-1" />
      <path d="M9.9 9.9a3 3 0 004.2 4.2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
