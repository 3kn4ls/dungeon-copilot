import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../api';

export function Stepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: ReactNode;
  /** Oculta la etiqueta a la vista (sigue en los botones) cuando ya hay un título al lado. */
  hideLabel?: boolean;
}) {
  const { label, value, min, max, onChange, format = String, hint, hideLabel } = props;
  return (
    <div className="stepper">
      <span className={hideLabel ? 'visually-hidden' : 'field-label'}>{label}</span>
      <div className="stepper-controls">
        <button
          type="button"
          aria-label={`Bajar ${label}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          −
        </button>
        <output className="num" aria-live="polite">
          {format(value)}
        </output>
        <button
          type="button"
          aria-label={`Subir ${label}`}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Muestra el error de una petición y, si el servidor los manda, los campos concretos que fallan. */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Algo ha fallado';
  const issues = error instanceof ApiError ? error.issues : [];
  return (
    <div className="error" role="alert">
      <p>{message}</p>
      {issues.length > 0 && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Botón para acciones que no se pueden deshacer: el primer clic pide confirmación. */
export function ConfirmButton(props: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? 'button danger' : 'button'}
      disabled={props.disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? props.confirmLabel : props.children}
    </button>
  );
}

export function PageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-message">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** Estado de carga o error de una consulta, para no repetirlo en cada pantalla. */
export function QueryState({ error }: { error: unknown }) {
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <PageMessage title={notFound ? 'No encontrado' : 'No se pudo cargar'}>
        <ErrorNote error={error} />
      </PageMessage>
    );
  }
  return <p className="muted loading">Cargando…</p>;
}

/** Título de la pestaña del navegador. */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Dungeon Copilot` : 'Dungeon Copilot';
  }, [title]);
}
