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

/**
 * Botón para acciones que no se pueden deshacer: el primer clic pide confirmación. `quiet`, como
 * un enlace hasta que se pulsa, para lo que se usa poco y no debe llamar la atención.
 */
export function ConfirmButton(props: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  small?: boolean;
  quiet?: boolean;
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
      className={
        props.quiet && !armed
          ? 'link-button'
          : ['button', (props.small || props.quiet) && 'small', armed && 'danger']
              .filter(Boolean)
              .join(' ')
      }
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

/** Estado que aguanta una recarga de la pestaña, como cuando el móvil la descarta. */
export function useSessionState<T>(key: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return JSON.parse(saved) as T;
    } catch {
      // Sin almacenamiento (modo privado): se empieza de cero.
    }
    return initial();
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Sin almacenamiento: lo escrito se perderá al recargar.
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/** Para retocar un texto corto, como lo que dice un PNJ, o escribirlo desde cero. */
export function LineEditor(props: {
  label: string;
  value: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="stack tight"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave();
      }}
    >
      <textarea
        aria-label={props.label}
        rows={3}
        maxLength={2000}
        autoFocus={props.autoFocus}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <div className="actions">
        <button type="submit" className="button small primary">
          Guardar
        </button>
        <button type="button" className="button small" onClick={props.onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
