import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { OverviewResponse } from '../../shared/contracts.ts';

interface DataNotesProps {
  open: boolean;
  onClose: () => void;
  overview: OverviewResponse;
}

/** v2 数据说明：居中窄弹层，只保留 4 段事实 */
export function DataNotes({ open, onClose, overview }: DataNotesProps) {
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
      <div className="va-notes" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-label="数据说明">
        <header className="va-notes__head">
          <div>
            <span className="va-notes__eyebrow">ABOUT THIS ATLAS</span>
            <h2 id={titleId}>数据说明</h2>
          </div>
          <button ref={closeRef} type="button" className="va-icon-btn" onClick={onClose} aria-label="关闭数据说明">
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div className="va-notes__body">
          <section>
            <h3>数据集</h3>
            <p>
              版本 <strong>{meta.datasetVersion}</strong> · {stats.countries} 个国家与地区 · {meta.policyCount} 条旅游签政策 ·
              平均完整度 {Math.round(stats.averageCompleteness)}%。
            </p>
          </section>
          <section>
            <h3>来源</h3>
            <p>
              小组整理的公开信息 CSV（单一来源，{meta.countryCount} 国目录）；未附逐国官方链接，未经使领馆逐条核验。
            </p>
          </section>
          <section>
            <h3>资料成熟度</h3>
            <p>
              真实资料为<strong>摘要级</strong>：有政策分类与一句官方口径摘要，费用、材料、审核时间尚未采集，界面显示「待采集」。
              {meta.demoPolicyCount > 0
                ? `另有 ${meta.demoPolicyCount} 条虚构演示样本，仅用于展示字段与交互，不可用于申请。`
                : ''}
            </p>
          </section>
          <section>
            <h3>免责声明</h3>
            <p>{meta.disclaimer}</p>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
