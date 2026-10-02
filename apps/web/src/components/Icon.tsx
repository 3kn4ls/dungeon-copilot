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
