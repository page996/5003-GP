import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { OverviewResponse } from '../../shared/contracts.ts';
import { useI18n } from '../i18n.tsx';

interface DataNotesProps {
  open: boolean;
  onClose: () => void;
  overview: OverviewResponse;
}

/** 数据说明：居中窄弹层，只保留 4 段事实；支持中英文 */
export function DataNotes({ open, onClose, overview }: DataNotesProps) {
  const { lang, t } = useI18n();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 20);
    return () => {
      window.clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const { meta, stats } = overview;
  return createPortal(
    <div
      className="va-notes-overlay"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="va-notes"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={t('notes.title')}
      >
        <header className="va-notes__head">
          <div>
            <span className="va-notes__eyebrow">{t('notes.eyebrow')}</span>
            <h2 id={titleId}>{t('notes.title')}</h2>
          </div>
          <button ref={closeRef} type="button" className="va-icon-btn" onClick={onClose} aria-label={t('notes.close')}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div className="va-notes__body">
          <section>
            <h3>{t('notes.dataset')}</h3>
            <p>
              {t('notes.datasetText', {
                version: meta.datasetVersion,
                countries: stats.countries,
                policies: meta.policyCount,
                completeness: Math.round(stats.averageCompleteness),
              })}
            </p>
          </section>
          <section>
            <h3>{t('notes.source')}</h3>
            <p>{t('notes.sourceText', { countries: meta.countryCount })}</p>
          </section>
          <section>
            <h3>{t('notes.maturity')}</h3>
            <p>
              {t('notes.maturityText')}
              {meta.demoPolicyCount > 0 ? ` ${t('notes.demo', { count: meta.demoPolicyCount })}` : ''}
            </p>
          </section>
          <section>
            <h3>{t('notes.disclaimer')}</h3>
            <p>{lang === 'en' ? t('notes.disclaimerText') : meta.disclaimer}</p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
