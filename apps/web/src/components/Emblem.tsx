/** El escudo de una campaña, con su inicial: la distingue en la lista y en su cabecera. */
export function Emblem({ name, large }: { name: string; large?: boolean }) {
  const size = large ? 64 : 44;
  return (
    <svg className="emblem" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3l18 6.5v13c0 10.5-7.5 19.5-18 22.5C13.5 42 6 33 6 22.5v-13z" />
      <text x="24" y="31" textAnchor="middle">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </text>
    </svg>
  );
}
