import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleCheck, Compass, Database, Globe2, RefreshCw, Sparkles } from 'lucide-react';
import type { Catalog, Policy, Recommendation, RecommendationRequest } from '../shared/contracts';
import { purposeLabels, regionLabels } from '../shared/contracts';
import { loadCatalog, loadRecommendations } from './api';
import { countryLabel, filterPolicies, SearchPanel, type Filters } from './features/search/SearchPanel';
import { MapPanel } from './features/map/MapPanel';
import { PolicyDetails } from './features/details/PolicyDetails';
import { RecommendationForm } from './features/recommendation/RecommendationForm';

type Tab = 'explore' | 'recommend' | 'coverage';
export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('explore');
  const [filters, setFilters] = useState<Filters>({ query: '', countryCode: null, type: '', region: '' });
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  async function refresh(signal?: AbortSignal) {
    setLoading(true); setError('');
    try { const next = await loadCatalog(signal); setCatalog(next); setSelectedRoute(null); setRecommendations(null); }
    catch (failure) { if (!signal?.aborted) setError((failure as Error).message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => { controller.abort(); requestRef.current?.abort(); }; }, []);
  function changeFilters(next: Filters) { setFilters(next); setSelectedRoute(null); }
  async function submitRecommendation(request: RecommendationRequest) {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setRecommending(true); setRecommendationError(''); setRecommendations(null); setSelectedRoute(null);
    try { const result = await loadRecommendations(request, controller.signal); if (!controller.signal.aborted) setRecommendations(result); }
    catch (failure) { if (!controller.signal.aborted) setRecommendationError((failure as Error).message); }
    finally { if (!controller.signal.aborted) setRecommending(false); }
  }
  const policy = catalog?.policies.find(item => item.routeCode === selectedRoute) ?? null;
  const result = recommendations?.find(item => item.policy.routeCode === selectedRoute);
  const visiblePolicies = catalog ? filterPolicies(catalog, filters) : [];
  const priorityTargets = catalog?.coverage.filter(item => item.priority).length ?? 0;
  const verified = catalog?.coverage.filter(item => item.verifiedRoutes > 0).length ?? 0;
  function routeCard(item: Policy, match?: Recommendation) {
    return <button key={item.routeCode} className={`route-card ${selectedRoute === item.routeCode ? 'active' : ''}`} onClick={() => setSelectedRoute(item.routeCode)}>
      <div className="card-top"><span className="country-code">{item.countryCode}</span><span className={item.isDemo ? 'badge demo-badge' : 'badge'}>{item.isDemo ? '虚构演示' : '资料参考'}</span></div>
      <h3>{countryLabel(catalog!.countries, item.countryCode)} <span> / {purposeLabels[item.visaType]}</span></h3>
      <p>{item.officialName ?? '路线名称待确认'}</p>
      {match ? <div className="match-line"><strong>{match.score}<small> 参考分</small></strong><span>{match.status === 'REFERENCE_MATCH' ? '已知条件匹配' : match.status === 'KNOWN_MISMATCH' ? '有已知不符项' : '仍需核实'}</span></div> : <div className="card-bottom"><span>{item.documents.length}项材料 · {item.fees.length}项费用</span><ArrowRight size={17}/></div>}
    </button>;
  }
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('explore'); }}><span className="brand-symbol"><Compass size={25}/></span><span>VISA <strong>ATLAS</strong><small>全球签证探索 · 共享开发基座</small></span></a>
      <nav aria-label="主导航"><button className={tab === 'explore' ? 'active' : ''} onClick={() => setTab('explore')}><Globe2 size={16}/>探索目的地</button><button className={tab === 'recommend' ? 'active' : ''} onClick={() => setTab('recommend')}><Sparkles size={16}/>个人条件＋意图推荐</button><button className={tab === 'coverage' ? 'active' : ''} onClick={() => setTab('coverage')}><Database size={16}/>全球数据覆盖</button></nav>
      <button className="refresh-button" disabled={loading} onClick={() => void refresh()} aria-label="重新加载资料"><RefreshCw size={16}/></button>
    </header>
    <div className="integrity-banner"><BookOpen size={15}/>{catalog?.mode === 'mysql' ? 'MySQL真实读取模式' : '离线演示模式'} · {catalog?.policies.filter(item => item.isDemo).length ?? 0}条虚构场景 · {catalog?.policies.filter(item => !item.isDemo).length ?? 0}条真实资料 <strong>国家目录 ≠ 政策已收齐；演示内容不可用于申请</strong></div>
    {loading && !catalog ? <main className="initial-state"><Globe2 size={40}/><h1>正在加载全球目录…</h1></main> : error ? <main className="initial-state"><h1>暂时无法读取资料</h1><p role="alert">{error}</p><button className="primary-button" onClick={() => void refresh()}>重新连接</button></main> : catalog && <>
      {tab === 'explore' && <main className="explore-layout"><SearchPanel catalog={catalog} filters={filters} onChange={changeFilters}/><div className="explore-main">
        <div className="page-heading"><span className="eyebrow">DISCOVER YOUR NEXT DESTINATION</span><h1>世界很大，先找到你的方向<span>.</span></h1><p>从全球目录出发，按目的地探索资料，或结合个人条件寻找适合的路线。</p></div>
        <div className="region-tabs"><button className={!filters.region ? 'active' : ''} onClick={() => changeFilters({ ...filters, region: '', countryCode: null })}>全球</button>{Object.entries(regionLabels).map(([code, label]) => <button className={filters.region === code ? 'active' : ''} key={code} onClick={() => changeFilters({ ...filters, region: code, countryCode: null })}>{label}</button>)}</div>
        <MapPanel countries={catalog.countries} policies={catalog.policies} selectedCountry={filters.countryCode} onSelect={code => changeFilters({ ...filters, countryCode: code, region: '' })}/>
        <div className="results-heading"><h2>{filters.countryCode ? countryLabel(catalog.countries, filters.countryCode) : '签证路线'} <span>{visiblePolicies.length}</span></h2><button className="text-button" onClick={() => setTab('recommend')}>加入个人条件 <ArrowRight size={14}/></button></div>
        <div className="route-grid">{visiblePolicies.map(item => routeCard(item))}</div>{!visiblePolicies.length && <div className="empty-results"><Database size={25}/><h3>该范围的签证资料尚未收集或没有匹配项</h3><p>这不表示目的地没有签证。可以清空筛选，或查看全球数据覆盖任务。</p><button className="text-button" onClick={() => setTab('coverage')}>查看待收集清单</button></div>}
      </div><PolicyDetails policy={policy}/></main>}
      {tab === 'recommend' && <main className="recommend-layout"><div><RecommendationForm countries={catalog.countries} busy={recommending} onSubmit={request => void submitRecommendation(request)}/><div className="recommend-results"><div className="results-heading"><h2>推荐与解释 <span>{recommendations?.length ?? '—'}</span></h2><span className="muted">未知条件不会被算成通过</span></div>{recommendationError && <p role="alert" className="error">{recommendationError}</p>}<div className="route-grid">{recommendations?.map(item => routeCard(item.policy, item))}</div>{recommendations?.length === 0 && <p className="empty-small">当前范围尚无可推荐资料；请补充政策数据，不能用空数据判定用户不符合。</p>}{recommendations === null && <p className="empty-small">填写个人条件与出行意图后，系统将逐项比较并解释原因。</p>}</div></div><PolicyDetails policy={policy} recommendation={result}/></main>}
      {tab === 'coverage' && <main className="coverage-page"><span className="eyebrow">COVERAGE IS EVIDENCE, NOT A COUNTRY COUNT</span><h1>全球覆盖，从真实资料开始</h1><p>目录覆盖国家与地区；重点国家清单是项目候选范围，不代表政策已完成。每个目标均保留七类用途，不用减少字段或国家来制造完成率。</p><div className="metric-grid"><div><Globe2/><strong>{catalog.countries.length}</strong><span>国家与地区目录</span></div><div><Compass/><strong>{priorityTargets}</strong><span>重点覆盖候选目的地</span></div><div><CircleCheck/><strong>{verified}</strong><span>有完整且近期核验路线的目的地</span></div></div>
        <p className="warning">“目标类型已出现”也不等于所有护照、申请渠道与政策都已穷尽；需要负责人确认覆盖范围与核验标准。当前演示路线完全不计入真实覆盖。</p>
        <div className="coverage-table-wrap"><table className="coverage-table"><thead><tr><th>国家 / 地区</th><th>区域</th><th>范围</th><th>真实路线</th><th>已核验完整路线</th><th>当前状态</th></tr></thead><tbody>{catalog.coverage.map(item => { const country = catalog.countries.find(row => row.code === item.countryCode)!; return <tr key={item.countryCode}><td><strong>{country.nameZh}</strong><small>{country.nameEn} · {country.code}</small></td><td>{regionLabels[country.region] ?? country.region}</td><td>{item.priority ? '重点候选 · 7类用途' : '全球扩展 · 7类用途'}</td><td>{item.realRoutes}</td><td>{item.verifiedRoutes}</td><td><span className="badge">{{ NOT_COLLECTED: '待采集', IN_PROGRESS: '采集 / 核验中', PARTIAL: '部分目标有资料', TARGET_TYPES_PRESENT: '目标类型已出现' }[item.status]}</span></td></tr>; })}</tbody></table></div>
      </main>}
    </>}
    <footer className="app-footer"><span>VISA ATLAS / BASE 0.1</span><span>资料检索与规则参考 · 不提供获签保证 · 仅桌面 Web</span></footer>
  </div>;
}
