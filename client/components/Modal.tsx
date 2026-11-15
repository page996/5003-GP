import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** 玻璃弹层：焦点管理、Esc 关闭、点击遮罩关闭、Tab 循环 */
export function Modal({ open, onClose, title, eyebrow = 'ABOUT DATA', children, footer }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreRef.current = previous;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 20);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(element => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="va-modal-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="va-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="va-modal__head">
          <div>
            <span className="va-eyebrow">{eyebrow}</span>
            <h2 id={titleId} className="va-modal__title">
              {title}
            </h2>
          </div>
          <button ref={closeRef} type="button" className="va-icon-btn" onClick={onClose} aria-label="关闭弹层">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="va-modal__body va-scroll">{children}</div>
        {footer ? <footer className="va-modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
