import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Un panel que sale por la derecha, encima de la página (en el móvil, a pantalla completa). Es un
 * <dialog> modal: Escape lo cierra, el foco no se escapa y lo de debajo no se puede tocar. Se
 * cierra también pulsando fuera.
 */
export function Drawer(props: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const { title, onClose, children } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="drawer"
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: cierra quien lo abrió, que también cambia la ruta.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Un clic en el fondo oscuro llega al propio <dialog>; dentro, a su contenido.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
