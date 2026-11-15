import { Badge } from './Badge';
import { Modal } from './Modal';
import { DATA_STATUS_META } from '../../shared/contracts.ts';
import type { OverviewResponse } from '../../shared/contracts.ts';

interface DataNotesModalProps {
  open: boolean;
  onClose: () => void;
  overview: OverviewResponse;
  includeDemo: boolean;
}

const REAL_STATUSES = ['DETAILED', 'PARTIAL', 'SUMMARY_ONLY', 'MENTION_ONLY'] as const;

/** 数据说明弹层：数据集、成熟度、演示数据边界与免责声明 */
export function DataNotesModal({ open, onClose, overview, includeDemo }: DataNotesModalProps) {
  const { meta, stats } = overview;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="数据说明"
      eyebrow="ABOUT THIS ATLAS"
      footer={
        <button type="button" className="va-button" onClick={onClose}>
          我知道了
        </button>
      }
    >
      <section className="va-notes__section">
        <h3>这是什么</h3>
        <p>
          Visa Atlas 是一个课程项目：以<strong>中国普通护照持有人的旅游签 / 免签 / 落地签政策</strong>
          为第一份真实数据，做成本地可运行的世界地图探索、全文检索、多条件筛选与国家签证档案。它不是官方签证数据库，也不提供获签保证。
        </p>
      </section>

      <section className="va-notes__section">
        <h3>数据规模</h3>
        <dl className="va-notes__dl">
          <div>
            <dt>国家与地区目录</dt>
            <dd>{stats.countries}</dd>
          </div>
          <div>
            <dt>旅游签政策记录</dt>
            <dd>{meta.policyCount}</dd>
          </div>
          <div>
            <dt>有资料的国家</dt>
            <dd>
              {stats.withPolicy} / {stats.countries}
            </dd>
          </div>
          <div>
            <dt>重点候选目的地</dt>
            <dd>{stats.priorityTargets}</dd>
          </div>
          <div>
            <dt>演示明细记录</dt>
            <dd>{meta.demoPolicyCount}</dd>
          </div>
          <div>
            <dt>平均完整度</dt>
            <dd>{Math.round(stats.averageCompleteness)}%</dd>
          </div>
        </dl>
      </section>

      <section className="va-notes__section">
        <h3>资料成熟度</h3>
        <p>本轮真实数据为摘要级：有政策分类与官方口径摘要，费用、材料、审核时间尚未采集，界面统一显示「待采集」，不会编造数值。</p>
        <ul className="va-notes__status-list">
          {REAL_STATUSES.map(status => (
            <li key={status}>
              <Badge tone="neutral">{DATA_STATUS_META[status].label}</Badge>
              <span>{DATA_STATUS_META[status].description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="va-notes__section va-notes__section--demo">
        <h3>
          演示数据
          <Badge tone="demo">演示</Badge>
        </h3>
        <p>
          演示明细是<strong>虚构样本</strong>，仅用于验证费用、材料、办理时间、资格规则等字段与交互。默认关闭；开启后页面顶部出现金色提示条，所有演示条目持续带「演示」徽章。
          {includeDemo ? '当前已开启，请注意区分。' : '当前为关闭状态。'}
        </p>
      </section>

      <section className="va-notes__section">
        <h3>数据集信息</h3>
        <dl className="va-notes__dl">
          <div>
            <dt>数据集版本</dt>
            <dd>{meta.datasetVersion}</dd>
          </div>
          <div>
            <dt>Schema 版本</dt>
            <dd>{meta.schemaVersion}</dd>
          </div>
          <div>
            <dt>数据库模式</dt>
            <dd>{meta.mode === 'mysql' ? 'MySQL 8' : 'SQLite'}</dd>
          </div>
          <div>
            <dt>生成日期</dt>
            <dd>{meta.generatedAt ? meta.generatedAt.slice(0, 10) : '未知'}</dd>
          </div>
          <div>
            <dt>来源文件</dt>
            <dd className="va-notes__mono">{meta.sourceFile}</dd>
          </div>
          <div>
            <dt>记录数</dt>
            <dd>
              政策 {meta.policyCount} · 国家 {meta.countryCount} · 类别 {meta.categoryCount} · 类型 {meta.typeCount}
            </dd>
          </div>
        </dl>
      </section>

      <section className="va-notes__section">
        <h3>免责声明</h3>
        <p>{meta.disclaimer}</p>
        <p className="va-notes__warning">未经使领馆逐条核验，请以官方最新公告为准。</p>
      </section>
    </Modal>
  );
}
