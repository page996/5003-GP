/**
 * Visa Atlas v1.0 · 自绘 SVG 世界地图
 *
 * - 几何数据：`data/geo/world-paths.json`（由 `npm run geo:build` 预投影生成，运行期零外网、无地图 Key）
 * - 本组件只负责地图舞台内部：海洋/经纬网、国家着色、hover/selected 覆盖层、微国家点、标签、
 *   缩放/拖拽/键盘与跟随鼠标的玻璃浮层。外部图例与「地图 / 列表」切换由 App 负责。
 * - 接口由 `WorldMapProps` 锁定，请勿改动。
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { MapCountry, RegionCode } from '../../../shared/contracts.ts';
import { completenessLabel, policyGroupColor, policyGroupLabel } from '../../../shared/contracts.ts';
import worldGeo from '../../../data/geo/world-paths.json';
import './map.css';

export type MapColorMode = 'category' | 'completeness';

export interface WorldMapProps {
  countries: MapCountry[];
  /** 当前检索命中的国家集合；null 表示不启用命中变暗 */
  matched: Set<string> | null;
  selected: string | null;
  highlightRegion: RegionCode | null;
  colorMode: MapColorMode;
  /** 递增即重置缩放与平移 */
  resetSignal: number;
  onSelect: (iso2: string) => void;
  onHover: (iso2: string | null) => void;
}

/* ------------------------------------------------------------------ */
/* 预投影几何数据                                                      */
/* ------------------------------------------------------------------ */

interface GeoCountryEntry {
  iso2: string;
  path: string;
  area: number;
  cx: number;
  cy: number;
}

interface GeoLabelEntry {
  iso2: string;
  x: number;
  y: number;
  nameZh: string;
  nameEn: string;
  rank: number;
}

interface WorldGeoData {
  projection: string;
  width: number;
  height: number;
  sphere: string;
  graticule: string;
  equator?: string;
  primeMeridian?: string;
  countries: GeoCountryEntry[];
  centroids: Record<string, [number, number]>;
  labels: GeoLabelEntry[];
  unmapped: string[];
}

const GEO = worldGeo as unknown as WorldGeoData;
const GEO_BY_ISO = new Map(GEO.countries.map(country => [country.iso2, country]));
const GEO_LABEL_BY_ISO = new Map(GEO.labels.map(label => [label.iso2, label]));

/** 画布尺寸与缩放下限：与 `data/geo/REPORT.md` 保持一致 */
const WIDTH = GEO.width || 1000;
const HEIGHT = GEO.height || 520;
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 8;
const ZOOM_BUTTON_STEP = 1.6;
const FOCUS_ZOOM = 2.2;
/** 投影后面积小于该值的国家额外画圆点，保证可点击（单位：px²） */
const MICRO_AREA_PX2 = 20;
/** 微国家圆点半径 / 透明点击热区半径（画布单位） */
const DOT_RADIUS = 3.2;
/** 小面积多边形国家的圆点默认更小、更低调（hover / selected 时恢复清晰） */
const DOT_TINY_RADIUS = 2.4;
const DOT_HIT_RADIUS = 10;
const TOOLTIP_OFFSET = 14;
const ZOOM_ANIMATION_MS = 300;

interface ViewState {
  k: number;
  x: number;
  y: number;
}

const IDENTITY_VIEW: ViewState = { k: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clampView = (view: ViewState): ViewState => {
  const scaledWidth = WIDTH * view.k;
  const scaledHeight = HEIGHT * view.k;
  const margin = 90;
  const minX = WIDTH - scaledWidth - margin;
  const maxX = margin;
  const minY = HEIGHT - scaledHeight - margin;
  const maxY = margin;
  return {
    k: view.k,
    x: minX > maxX ? (WIDTH - scaledWidth) / 2 : clamp(view.x, minX, maxX),
    y: minY > maxY ? (HEIGHT - scaledHeight) / 2 : clamp(view.y, minY, maxY),
  };
};

/** 以画布上的某个点为中心缩放（point 使用 viewBox 坐标系） */
const zoomViewAt = (view: ViewState, point: { x: number; y: number }, factor: number): ViewState => {
  const nextK = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
  if (nextK === view.k) return view;
  const ratio = nextK / view.k;
  return clampView({
    k: nextK,
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
  });
};

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map(char => char + char)
          .join('')
      : normalized;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return `rgba(159, 179, 200, ${alpha})`;
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const fillForCountry = (
  country: MapCountry | undefined,
  colorMode: MapColorMode,
): string => {
  if (colorMode === 'completeness') {
    const score = country?.hasData ? clamp(country.completeness, 0, 100) : 0;
    const alpha = (0.045 + (score / 100) * 0.3).toFixed(3);
    return `rgba(116, 232, 192, ${alpha})`;
  }
  if (country?.group) return hexToRgba(policyGroupColor(country.group), 0.11);
  return 'rgba(150, 185, 210, 0.06)';
};

const stayText = (country: MapCountry | null): string => {
  if (!country) return '本轮未采集';
  if (country.stayLabel) return country.stayLabel;
  if (country.stayDays !== null) return `每次最多 ${country.stayDays} 天`;
  return '本轮未采集';
};

/* ------------------------------------------------------------------ */
/* 子图层（用 memo 隔离 hover 状态，hover 时不重绘 236 条国界）        */
/* ------------------------------------------------------------------ */

interface CountriesLayerProps {
  fills: Map<string, string>;
  dimmed: Set<string>;
  spotlight: Set<string>;
  metaByIso: Map<string, MapCountry>;
}

const CountriesLayer = memo(function CountriesLayer({ fills, dimmed, spotlight, metaByIso }: CountriesLayerProps) {
  return (
    <g className="va-map-countries">
      {GEO.countries.map(country => {
        const meta = metaByIso.get(country.iso2);
        const title = meta
          ? `${meta.nameZh} ${meta.nameEn} · ${meta.iso2} · ${meta.regionLabel}`
          : `${GEO_LABEL_BY_ISO.get(country.iso2)?.nameZh ?? country.iso2} · ${country.iso2}`;
        const className = [
          'va-map-country',
          dimmed.has(country.iso2) ? 'is-dim' : '',
          spotlight.has(country.iso2) ? 'is-spotlight' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <path
            key={country.iso2}
            className={className}
            d={country.path}
            fill={fills.get(country.iso2)}
            data-iso2={country.iso2}
            aria-label={title}
          >
            <title>{title}</title>
          </path>
        );
      })}
    </g>
  );
});

interface LabelsLayerProps {
  view: ViewState;
  /** 1 个屏幕 CSS px 等于多少 SVG 用户单位（用于让字号保持屏幕恒定 9–10px） */
  unitPerPx: number;
}

const LabelsLayer = memo(function LabelsLayer({ view, unitPerPx }: LabelsLayerProps) {
  // 窄舞台（屏幕 1px 对应更多 SVG 单位）时进一步收紧低缩放的标签数量，避免欧洲等密集区压字
  const narrow = unitPerPx > 1.12;
  const maxRank = view.k < 1.35 ? (narrow ? 6 : 8) : view.k < 2 ? (narrow ? 12 : 14) : view.k < 3.2 ? (narrow ? 18 : 20) : 28;
  const marginX = 48 * unitPerPx;
  const marginY = 20 * unitPerPx;
  return (
    <g className="va-map-labels" aria-hidden="true">
      {GEO.labels.map(label => {
        if (label.rank > maxRank) return null;
        const x = view.x + label.x * view.k;
        const y = view.y + label.y * view.k;
        if (x < -marginX || x > WIDTH + marginX || y < -marginY || y > HEIGHT + marginY) return null;
        return (
          <text
            key={label.iso2}
            className="va-map-label"
            x={x}
            y={y}
            textAnchor="middle"
            fontSize={9.6 * unitPerPx}
            strokeWidth={2.4 * unitPerPx}
          >
            {label.nameZh}
          </text>
        );
      })}
    </g>
  );
});

type MicroDotKind = 'unmapped' | 'tiny';

interface MicroDot {
  iso2: string;
  cx: number;
  cy: number;
  /** unmapped = 目录有但 Natural Earth 无多边形；tiny = 有极小多边形（面积 < 阈值） */
  kind: MicroDotKind;
}

interface MicroDotsLayerProps {
  view: ViewState;
  dots: MicroDot[];
  dimmed: Set<string>;
  selected: string | null;
  metaByIso: Map<string, MapCountry>;
  colorMode: MapColorMode;
  unitPerPx: number;
}

const MicroDotsLayer = memo(function MicroDotsLayer({
  view,
  dots,
  dimmed,
  selected,
  metaByIso,
  colorMode,
  unitPerPx,
}: MicroDotsLayerProps) {
  const hitRadius = DOT_HIT_RADIUS * unitPerPx;
  const cullMargin = 24 * unitPerPx;
  return (
    <g className="va-map-dots">
      {dots.map(dot => {
        const x = view.x + dot.cx * view.k;
        const y = view.y + dot.cy * view.k;
        if (x < -cullMargin || x > WIDTH + cullMargin || y < -cullMargin || y > HEIGHT + cullMargin) return null;
        const className = [
          'va-map-dot',
          dot.kind === 'unmapped' ? 'va-map-dot--unmapped' : 'va-map-dot--tiny',
          dimmed.has(dot.iso2) ? 'is-dim' : '',
          selected === dot.iso2 ? 'is-selected' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const radius = (dot.kind === 'unmapped' ? DOT_RADIUS : DOT_TINY_RADIUS) * unitPerPx;
        const meta = metaByIso.get(dot.iso2);
        const title = meta
          ? `${meta.nameZh} ${meta.nameEn} · ${meta.iso2} · 微国家/地区`
          : `${dot.iso2} · 微国家/地区`;
        const dotColor =
          colorMode === 'completeness'
            ? `rgba(116, 232, 192, ${0.4 + (meta?.hasData ? clamp(meta.completeness, 0, 100) / 100 : 0) * 0.5})`
            : meta?.group
              ? policyGroupColor(meta.group)
              : 'var(--va-sky, #8ccbff)';
        return (
          <g
            key={dot.iso2}
            className={className}
            data-iso2={dot.iso2}
            data-dot-kind={dot.kind}
            transform={`translate(${x} ${y})`}
          >
            <title>{title}</title>
            <circle className="va-map-dot__hit" r={hitRadius} data-iso2={dot.iso2} aria-label={title} />
            <circle
              className="va-map-dot__body"
              r={radius}
              data-iso2={dot.iso2}
              style={{ '--va-map-dot-fill': dotColor } as CSSProperties}
            />
          </g>
        );
      })}
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* 主组件                                                             */
/* ------------------------------------------------------------------ */

export function WorldMap({
  countries,
  matched,
  selected,
  highlightRegion,
  colorMode,
  resetSignal,
  onSelect,
  onHover,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<ViewState>(IDENTITY_VIEW);
  const [view, setView] = useState<ViewState>(IDENTITY_VIEW);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ moved: boolean } | null>(null);
  const dragWindowRef = useRef<{ move: (event: PointerEvent) => void; up: (event: PointerEvent) => void } | null>(
    null,
  );
  const pointerMovedRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const tooltipRafRef = useRef(0);
  const tweenRef = useRef(0);
  const lastResetRef = useRef(resetSignal);

  const reducedMotionRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  /**
   * 让标签字号（9–10px）与微国家圆点半径（3.2px）保持「屏幕恒定」，
   * 而不是随 SVG 被拉伸：记录 1 个屏幕 CSS px 等于多少 SVG 用户单位。
   */
  const [unitPerPx, setUnitPerPx] = useState(1);
  useEffect(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;
    const update = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
      if (scale > 0) {
        const next = 1 / scale;
        setUnitPerPx(previous => (Math.abs(previous - next) > 0.01 ? next : previous));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const applyView = useCallback((next: ViewState) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const cancelTween = useCallback(() => {
    if (tweenRef.current) {
      cancelAnimationFrame(tweenRef.current);
      tweenRef.current = 0;
    }
  }, []);

  const animateView = useCallback(
    (target: ViewState, duration = ZOOM_ANIMATION_MS) => {
      cancelTween();
      if (reducedMotionRef.current) {
        applyView(target);
        return;
      }
      const start = viewRef.current;
      const startTime = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = 1 - (1 - progress) ** 3;
        applyView({
          k: start.k + (target.k - start.k) * eased,
          x: start.x + (target.x - start.x) * eased,
          y: start.y + (target.y - start.y) * eased,
        });
        if (progress < 1) tweenRef.current = requestAnimationFrame(tick);
        else tweenRef.current = 0;
      };
      tweenRef.current = requestAnimationFrame(tick);
    },
    [applyView, cancelTween],
  );

  useEffect(() => () => cancelTween(), [cancelTween]);

  /* ---------------- 派生数据（仅在数据/筛选变化时重算） ---------------- */

  const metaByIso = useMemo(() => new Map(countries.map(country => [country.iso2, country])), [countries]);

  const fills = useMemo(() => {
    const map = new Map<string, string>();
    for (const country of GEO.countries) {
      map.set(country.iso2, fillForCountry(metaByIso.get(country.iso2), colorMode));
    }
    return map;
  }, [metaByIso, colorMode]);

  /** matched 与 highlightRegion 的叠加规则：两者都是「限制」，同时存在时取交集 */
  const dimmed = useMemo(() => {
    const result = new Set<string>();
    const matchedActive = matched !== null && matched.size > 0; // 0 个命中时不做整图变暗
    if (!matchedActive && !highlightRegion) return result;
    for (const country of countries) {
      const matchedOk = !matchedActive || matched!.has(country.iso2);
      const regionOk = !highlightRegion || country.region === highlightRegion;
      if (!matchedOk || !regionOk) result.add(country.iso2);
    }
    // 微国家/无多边形国家没有 MapCountry 之外的几何限制，也按同样规则处理
    for (const iso2 of GEO.unmapped) {
      const country = metaByIso.get(iso2);
      const matchedOk = !matchedActive || matched!.has(iso2);
      const regionOk = !highlightRegion || country?.region === highlightRegion;
      if (!matchedOk || !regionOk) result.add(iso2);
    }
    return result;
  }, [countries, matched, highlightRegion, metaByIso]);

  const spotlight = useMemo(() => {
    const result = new Set<string>();
    if (!highlightRegion) return result;
    for (const country of countries) {
      if (country.region === highlightRegion && !dimmed.has(country.iso2)) result.add(country.iso2);
    }
    return result;
  }, [countries, highlightRegion, dimmed]);

  const microDots = useMemo(() => {
    const result: MicroDot[] = [];
    for (const iso2 of GEO.unmapped) {
      const centroid = GEO.centroids[iso2];
      if (centroid) result.push({ iso2, cx: centroid[0], cy: centroid[1], kind: 'unmapped' });
    }
    for (const country of GEO.countries) {
      if (country.area >= MICRO_AREA_PX2) continue;
      const centroid = GEO.centroids[country.iso2];
      if (centroid) result.push({ iso2: country.iso2, cx: centroid[0], cy: centroid[1], kind: 'tiny' });
    }
    return result;
  }, []);

  const selectedGeo = selected ? GEO_BY_ISO.get(selected) ?? null : null;
  const hoveredGeo = hovered ? GEO_BY_ISO.get(hovered) ?? null : null;
  const hoveredCountry = hovered ? metaByIso.get(hovered) ?? null : null;
  const selectedCountry = selected ? metaByIso.get(selected) ?? null : null;

  /* ---------------- 浮层定位（直接改 DOM，不触发 React 重绘） ---------------- */

  const positionTooltip = useCallback((clientX: number, clientY: number) => {
    const tooltip = tooltipRef.current;
    const container = containerRef.current;
    if (!tooltip || !container) return;
    const rect = container.getBoundingClientRect();
    const width = tooltip.offsetWidth || 236;
    const height = tooltip.offsetHeight || 148;
    let x = clientX - rect.left + TOOLTIP_OFFSET;
    let y = clientY - rect.top + TOOLTIP_OFFSET;
    if (x + width > rect.width - 8) x = clientX - rect.left - TOOLTIP_OFFSET - width;
    if (y + height > rect.height - 8) y = clientY - rect.top - TOOLTIP_OFFSET - height;
    x = clamp(x, 8, Math.max(8, rect.width - width - 8));
    y = clamp(y, 8, Math.max(8, rect.height - height - 8));
    tooltip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }, []);

  const scheduleTooltip = useCallback(
    (clientX: number, clientY: number) => {
      lastPointerRef.current = { x: clientX, y: clientY };
      if (tooltipRafRef.current) return;
      tooltipRafRef.current = requestAnimationFrame(() => {
        tooltipRafRef.current = 0;
        positionTooltip(lastPointerRef.current.x, lastPointerRef.current.y);
      });
    },
    [positionTooltip],
  );

  useEffect(
    () => () => {
      if (tooltipRafRef.current) cancelAnimationFrame(tooltipRafRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (hovered) positionTooltip(lastPointerRef.current.x, lastPointerRef.current.y);
  }, [hovered, positionTooltip]);

  /* ---------------- hover / 选中 ---------------- */

  const setHoveredIso = useCallback(
    (iso2: string | null) => {
      if (hoveredRef.current === iso2) return;
      hoveredRef.current = iso2;
      setHovered(iso2);
      onHover(iso2);
    },
    [onHover],
  );

  const clearHover = useCallback(() => {
    if (hoveredRef.current !== null) {
      hoveredRef.current = null;
      setHovered(null);
      onHover(null);
    }
  }, [onHover]);

  const clientToUser = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  }, []);

  /* ---------------- 缩放 / 平移 ---------------- */

  const zoomAtCenter = useCallback(
    (factor: number) => {
      animateView(zoomViewAt(viewRef.current, { x: WIDTH / 2, y: HEIGHT / 2 }, factor));
    },
    [animateView],
  );

  const resetView = useCallback(() => {
    animateView(IDENTITY_VIEW);
  }, [animateView]);

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const current = viewRef.current;
      applyView(clampView({ k: current.k, x: current.x + dx, y: current.y + dy }));
    },
    [applyView],
  );

  // 滚轮缩放：以鼠标位置为中心；必须用非 passive 原生监听才能 preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey && event.deltaMode === 0 && Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const point = clientToUser(event.clientX, event.clientY);
      if (!point) return;
      cancelTween();
      const factor = Math.exp(-event.deltaY * 0.0016);
      applyView(zoomViewAt(viewRef.current, point, factor));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [applyView, cancelTween, clientToUser]);

  // resetSignal 变化时动画复位（跳过首次挂载）
  useEffect(() => {
    if (resetSignal === lastResetRef.current) return;
    lastResetRef.current = resetSignal;
    animateView(IDENTITY_VIEW);
  }, [resetSignal, animateView]);

  // selected 变化时平滑聚焦到该国质心（selected=null 不改变视图；首次挂载不强制聚焦）
  const lastSelectedRef = useRef(selected);
  useEffect(() => {
    if (selected === lastSelectedRef.current) return;
    lastSelectedRef.current = selected;
    if (!selected) return;
    const centroid = GEO.centroids[selected];
    if (!centroid) return;
    const target = clampView({
      k: FOCUS_ZOOM,
      x: WIDTH / 2 - centroid[0] * FOCUS_ZOOM,
      y: HEIGHT / 2 - centroid[1] * FOCUS_ZOOM,
    });
    animateView(target);
  }, [selected, animateView]);

  /* ---------------- 指针交互 ---------------- */

  /** 结束拖拽：移除 window 上的临时监听（不用 setPointerCapture，避免 click 目标被改成 svg） */
  const detachDragWindow = useCallback(() => {
    const handler = dragWindowRef.current;
    if (!handler) return;
    window.removeEventListener('pointermove', handler.move);
    window.removeEventListener('pointerup', handler.up);
    window.removeEventListener('pointercancel', handler.up);
    dragWindowRef.current = null;
  }, []);

  useEffect(() => () => detachDragWindow(), [detachDragWindow]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 || dragWindowRef.current) return;
      cancelTween();
      const matrix = svgRef.current?.getScreenCTM();
      const userPerPx = matrix && matrix.a !== 0 ? 1 / matrix.a : 1;
      const startView = viewRef.current;
      const startX = event.clientX;
      const startY = event.clientY;
      const drag = { moved: false };
      dragRef.current = drag;
      pointerMovedRef.current = false;
      // 点击地图后焦点留在交互容器上，便于继续用 + / - / 0 / 方向键操作
      containerRef.current?.focus({ preventScroll: true });

      const move = (nativeEvent: PointerEvent) => {
        const dx = nativeEvent.clientX - startX;
        const dy = nativeEvent.clientY - startY;
        if (!drag.moved) {
          if (Math.hypot(dx, dy) <= 4) return;
          drag.moved = true;
          pointerMovedRef.current = true;
          setDragging(true);
          clearHover();
        }
        applyView(
          clampView({
            k: startView.k,
            x: startView.x + dx * userPerPx,
            y: startView.y + dy * userPerPx,
          }),
        );
      };
      const up = () => {
        detachDragWindow();
        dragRef.current = null;
        setDragging(false);
      };
      dragWindowRef.current = { move, up };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    },
    [applyView, cancelTween, clearHover, detachDragWindow],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (dragRef.current) return; // 拖拽位移由 window 监听处理
      const target = event.target as Element | null;
      const iso2 = target?.closest?.('[data-iso2]')?.getAttribute('data-iso2') ?? null;
      setHoveredIso(iso2);
      if (iso2) scheduleTooltip(event.clientX, event.clientY);
    },
    [scheduleTooltip, setHoveredIso],
  );

  const handlePointerLeave = useCallback(() => {
    if (!dragRef.current) clearHover();
  }, [clearHover]);

  const handleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (pointerMovedRef.current) {
        pointerMovedRef.current = false;
        return;
      }
      const target = event.target as Element | null;
      const iso2 = target?.closest?.('[data-iso2]')?.getAttribute('data-iso2');
      if (iso2) onSelect(iso2);
      // 点击空白保持当前选中，不取消
    },
    [onSelect],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      const point = clientToUser(event.clientX, event.clientY);
      if (!point) return;
      animateView(zoomViewAt(viewRef.current, point, 1.8));
    },
    [animateView, clientToUser],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const key = event.key;
      if (key === '+' || key === '=') {
        event.preventDefault();
        zoomAtCenter(ZOOM_BUTTON_STEP);
      } else if (key === '-' || key === '_') {
        event.preventDefault();
        zoomAtCenter(1 / ZOOM_BUTTON_STEP);
      } else if (key === '0') {
        event.preventDefault();
        resetView();
      } else if (key === 'ArrowLeft') {
        event.preventDefault();
        panBy(40, 0);
      } else if (key === 'ArrowRight') {
        event.preventDefault();
        panBy(-40, 0);
      } else if (key === 'ArrowUp') {
        event.preventDefault();
        panBy(0, 40);
      } else if (key === 'ArrowDown') {
        event.preventDefault();
        panBy(0, -40);
      }
    },
    [panBy, resetView, zoomAtCenter],
  );

  /* ---------------- 渲染 ---------------- */

  const hoverColor = useMemo(() => {
    if (colorMode === 'category' && hoveredCountry?.group) return policyGroupColor(hoveredCountry.group);
    return 'var(--va-mint, #74e8c0)';
  }, [colorMode, hoveredCountry]);

  const selectedFill = useMemo(() => {
    if (colorMode === 'category' && selectedCountry?.group) return hexToRgba(policyGroupColor(selectedCountry.group), 0.4);
    return 'rgba(231, 198, 140, 0.22)';
  }, [colorMode, selectedCountry]);

  const tooltipName =
    hoveredCountry?.nameZh ?? (hovered ? GEO_LABEL_BY_ISO.get(hovered)?.nameZh : undefined) ?? hovered ?? '';
  const tooltipNameEn =
    hoveredCountry?.nameEn ?? (hovered ? GEO_LABEL_BY_ISO.get(hovered)?.nameEn : undefined) ?? '';
  const tooltipGroup = hoveredCountry?.group ?? null;
  const tooltipStay = stayText(hoveredCountry);
  const tooltipStatus = hoveredCountry
    ? hoveredCountry.hasData
      ? `${completenessLabel(hoveredCountry.completeness)} · ${hoveredCountry.completeness}%`
      : '本轮未采集'
    : '资料加载中';

  return (
    <div
      className={`va-map${hovered ? ' is-hovering' : ''}${dragging ? ' is-dragging' : ''}`}
      ref={containerRef}
      data-color-mode={colorMode}
      style={{ '--va-map-lift': `${(3 * unitPerPx).toFixed(2)}px` } as CSSProperties}
      tabIndex={0}
      role="group"
      aria-label="世界地图交互区：方向键平移，+ / - 缩放，0 复位"
      onKeyDown={handleKeyDown}
    >
      <svg
        ref={svgRef}
        className="va-map-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="世界签证图谱。可拖拽平移、滚轮或按钮缩放；悬停国家查看政策组与停留期，点击打开国家档案。"
        tabIndex={-1}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <g className="va-map-world" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <path className="va-map-sphere" d={GEO.sphere} />
          <path className="va-map-graticule" d={GEO.graticule} />
          {GEO.equator ? <path className="va-map-graticule va-map-graticule--major" d={GEO.equator} /> : null}
          {GEO.primeMeridian ? (
            <path className="va-map-graticule va-map-graticule--major" d={GEO.primeMeridian} />
          ) : null}
          <CountriesLayer fills={fills} dimmed={dimmed} spotlight={spotlight} metaByIso={metaByIso} />
          {hoveredGeo ? (
            <path
              className="va-map-hover-overlay"
              d={hoveredGeo.path}
              style={{ '--va-map-hover-color': hoverColor } as CSSProperties}
            />
          ) : null}
          {selectedGeo ? (
            <>
              <path
                className="va-map-selected-overlay"
                d={selectedGeo.path}
                style={{ '--va-map-selected-fill': selectedFill } as CSSProperties}
              />
              <circle
                className="va-map-selected-pulse"
                cx={selectedGeo.cx + 9 * unitPerPx}
                cy={selectedGeo.cy - 9 * unitPerPx}
                r={2.6 * unitPerPx}
              />
            </>
          ) : null}
        </g>
        <MicroDotsLayer
          view={view}
          dots={microDots}
          dimmed={dimmed}
          selected={selected}
          metaByIso={metaByIso}
          colorMode={colorMode}
          unitPerPx={unitPerPx}
        />
        <LabelsLayer view={view} unitPerPx={unitPerPx} />
      </svg>

      <div className="va-map-controls" role="group" aria-label="地图缩放控制">
        <button
          type="button"
          className="va-map-zoom"
          aria-label="放大"
          title="放大（+）"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            zoomAtCenter(ZOOM_BUTTON_STEP);
          }}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="va-map-zoom"
          aria-label="缩小"
          title="缩小（−）"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            zoomAtCenter(1 / ZOOM_BUTTON_STEP);
          }}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="va-map-zoom"
          aria-label="重置视图"
          title="重置（0）"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            resetView();
          }}
        >
          <LocateFixed size={15} aria-hidden="true" />
        </button>
      </div>

      {hovered ? (
        <div className="va-map-tooltip" ref={tooltipRef} role="tooltip">
          <div className="va-map-tooltip__head">
            <span className="va-map-tooltip__zh">{tooltipName}</span>
            <span className="va-map-tooltip__en">{tooltipNameEn}</span>
          </div>
          <div className="va-map-tooltip__badges">
            <span className="va-map-tooltip__iso">{hovered}</span>
            {tooltipGroup ? (
              <span
                className="va-map-tooltip__badge"
                style={{ '--va-map-badge-color': policyGroupColor(tooltipGroup) } as CSSProperties}
              >
                {policyGroupLabel(tooltipGroup)}
              </span>
            ) : (
              <span className="va-map-tooltip__badge is-muted">本轮未采集</span>
            )}
            {hoveredCountry?.priority ? <span className="va-map-tooltip__badge is-priority">重点候选</span> : null}
          </div>
          <div className="va-map-tooltip__row">
            <span>停留期</span>
            <strong>{tooltipStay}</strong>
          </div>
          <div className="va-map-tooltip__row">
            <span>{hoveredCountry?.regionLabel ?? '地区待确认'}</span>
            <span className="va-map-tooltip__status">{tooltipStatus}</span>
          </div>
          <div className="va-map-tooltip__cta">点击查看国家档案 →</div>
        </div>
      ) : null}
    </div>
  );
}

export default WorldMap;
