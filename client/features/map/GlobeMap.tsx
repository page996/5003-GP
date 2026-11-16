/**
 * Visa Atlas v2.0 · 可拨动 / 可缩放的 MapLibre GL 地球
 *
 * - 投影：MapLibre GL JS 5.9 的 globe projection（无瓦片、无 Key、无外网）
 * - 几何：本地 GeoJSON，来自 `npm run geo:build` 生成的 `public/geo/*.geo.json`
 * - 交互：拖拽拨动地球、滚轮/双指缩放、双击放大、点击国家选中、点击空白回调；
 *         hover 用 feature-state 直接改图层（不触发 React 重渲染），并与 `hoverIso2` 合并。
 * - 相机：初始 center [108, 22] / zoom 2.0 / minZoom 0.5 / maxZoom 10；
 *         `focusRequest` 变化时按 bbox / center / 微国家点规则飞近，`resetSignal` 回到初始视角。
 *
 * 测试钩子：根节点 `.va-globe`（内部含 `.maplibregl-canvas`），地图 load 完成后
 * 设置 `window.__globeReady = true`。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LocateFixed, Minus, Plus } from 'lucide-react';
import type { Map as MapLibreMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { POLICY_GROUPS } from '../../../shared/contracts.ts';
import type { MapCountry } from '../../../shared/contracts.ts';
import { useI18n } from '../../i18n.tsx';
import './globe.css';

export interface GlobeFocusRequest {
  iso2: string;
  /** 每次请求递增，保证连续选择同一国家也能触发飞行动画 */
  nonce: number;
}

export interface GlobeMapProps {
  /** 250 个目录国家的 API 元数据（名称/政策/完整度等） */
  countries: MapCountry[];
  /** 当前检索命中的国家集合；null 表示不启用“未命中变暗” */
  matched: Set<string> | null;
  /** 当前选中国家 ISO2（高亮黄色） */
  selected: string | null;
  /** 外部控制的 hover（搜索列表/悬浮卡 hover 时同步地图高亮） */
  hoverIso2: string | null;
  /** 搜索/预置词选中的国家：变化时飞到该国 */
  focusRequest: GlobeFocusRequest | null;
  /** 递增即重置到初始视角 */
  resetSignal: number;
  onSelect: (iso2: string) => void;
  onHover: (iso2: string | null) => void;
  onBackgroundClick: () => void;
  onReady?: () => void;
}

declare global {
  interface Window {
    __globeReady?: boolean;
  }
}

/* ------------------------------------------------------------------ */
/* 常量与视觉规范                                                      */
/* ------------------------------------------------------------------ */

const INITIAL_CENTER: [number, number] = [108, 22];
/** 基准视口 900px 短边时 zoom 2.0（1440×900 地球直径约 573px）；其他视口按短边等比缩放 */
const BASE_ZOOM = 2.0;
const BASE_SHORT_EDGE = 900;
const MIN_INITIAL_ZOOM = 1.7;
const MAX_INITIAL_ZOOM = 2.7;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 让地球直径约为容器短边的 62–68%：1440×900 → 2.0，1920×1080 → 约 2.26 */
const computeInitialZoom = (width: number, height: number): number => {
  const shortEdge = Math.max(1, Math.min(width, height));
  return clamp(BASE_ZOOM + Math.log2(shortEdge / BASE_SHORT_EDGE), MIN_INITIAL_ZOOM, MAX_INITIAL_ZOOM);
};

const GEO_URLS = {
  countries: '/geo/countries.geo.json',
  microstates: '/geo/microstates.geo.json',
} as const;

const SOURCE_COUNTRIES = 'countries';
const SOURCE_MICRO = 'micro';
const SOURCE_SEAM_COVER = 'seam-cover';
const LAYER_FILL = 'countries-fill';
const LAYER_MICRO = 'micro-dot';

/**
 * MapLibre globe 在 180° 经线处会渲染一条背景接缝细线（无对应 feature，无法用
 * queryRenderedFeatures 查到）。用一条与海洋同色的窄线盖住它；放在陆地填充下面，
 * 因此不会覆盖任何国家。
 */
const SEAM_COVER_DATA = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[180, -58], [180, 58]] },
    },
    {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: [[-180, -58], [-180, 58]] },
    },
  ],
};

const PALETTE = {
  space: '#05080b',
  ocean: '#0e1a22',
  border: '#626b72',
  dim: '#191d20',
  /** 选中国家时其他地区的“静默”底色 */
  focus: '#10161a',
  focusBorder: '#222b31',
  hover: '#DFC11D',
  selected: '#E3C31C',
  outline: '#F6DD55',
  micro: '#8C9AA3',
  /** 无政策/未采集国家的兜底灰 */
  unknown: '#262e33',
} as const;

/** 5 个政策组 = 5 种语义色：免签绿、落地签黄、电子签青、预办珊瑚、特殊中性灰 */
const GROUP_COLOR = new Map<string, string>(POLICY_GROUPS.map(group => [group.code, group.color]));
const FALLBACK_GROUP_COLOR = '#8C9AA3';

/** 解析 #RRGGBB，用于把语义色与深色底混合出低饱和色 */
function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map(char => char + char).join('') : value;
  const number = Number.parseInt(normalized.slice(0, 6), 16);
  if (Number.isNaN(number)) return [140, 154, 163];
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function mixHex(from: string, to: string, ratio: number): string {
  const [r1, g1, b1] = parseHex(from);
  const [r2, g2, b2] = parseHex(to);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * ratio);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

const groupBrightColor = (group: string | null | undefined): string =>
  (group ? GROUP_COLOR.get(group) : undefined) ?? FALLBACK_GROUP_COLOR;
/** 未选中陆地：语义色的深色低饱和版本，颜色仍有含义 */
const groupBaseColor = (bright: string): string => mixHex(bright, '#0b1115', 0.76);
/** 选中国家后，hover 其他国家只给很克制的提示 */
const groupFocusHoverColor = (bright: string): string => mixHex(bright, '#10171b', 0.55);
const matchTint = (bright: string): string => mixHex(bright, '#1e252a', 0.5);

const FLY_DURATION = 900;
const RESET_DURATION = 900;
const ZOOM_DURATION = 260;
/** 选中飞行：保留邻国上下文，不让小国占满屏幕（参数按 1440×900 截图实测标定） */
const FIT_PADDING = 165;
const FIT_MAX_ZOOM = 6.1;
const NO_BBOX_ZOOM = 3;
const MICRO_ZOOM = 7.2;
const CLICK_MOVE_TOLERANCE = 6;

/* ------------------------------------------------------------------ */
/* 几何数据类型（与 scripts/build-globe-geo.ts 输出对齐）               */
/* ------------------------------------------------------------------ */

interface CountryProperties {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: string;
  tone: number;
  center: [number, number] | null;
  bbox: [number, number, number, number] | null;
  /** 以下字段在运行时由 API MapCountry 数据补齐（不写入磁盘 GeoJSON） */
  categoryCode?: string | null;
  groupCode?: string | null;
  /** 政策组语义色（亮色，用于 hover/选中强调） */
  groupColor?: string;
  /** 语义色与深底混合后的静默陆地色 */
  groupBaseColor?: string;
  matchColor?: string;
  focusHoverColor?: string;
}

interface MicroProperties {
  iso2: string;
  nameZh: string;
  nameEn: string;
  region: string;
  tone: number;
  center: [number, number] | null;
  bbox: null;
  categoryCode?: string | null;
  groupCode?: string | null;
  groupColor?: string;
  groupBaseColor?: string;
  matchColor?: string;
  focusHoverColor?: string;
}

interface FeatureCollectionLike<Properties> {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id?: string;
    properties: Properties;
    geometry: { type: string; coordinates: unknown };
  }[];
}

/* ------------------------------------------------------------------ */
/* 样式（表达式）                                                      */
/* ------------------------------------------------------------------ */

const featureState = (key: string) => ['boolean', ['feature-state', key], false];

/** 政策组语义色（免签绿 / 落地签黄 / 电子签青 / 预办珊瑚 / 特殊灰） */
const groupColorExpr = ['coalesce', ['get', 'groupColor'], FALLBACK_GROUP_COLOR];
/** 低饱和语义底色；无政策国家使用中性灰 */
const groupBaseColorExpr = ['coalesce', ['get', 'groupBaseColor'], PALETTE.unknown];
/** 检索命中时的语义淡彩 */
const matchColorExpr = ['coalesce', ['get', 'matchColor'], groupBaseColorExpr];
/** 选中国家时，hover 其他国家的克制提示色 */
const focusHoverColorExpr = ['coalesce', ['get', 'focusHoverColor'], PALETTE.focus];

/**
 * 填充优先级：
 * - selected：参考黄（交互选中）
 * - focus（已有选中国家）：其他地区统一静默深灰；hover 只给克制提示
 * - hover：政策组语义色
 * - 检索未命中：深灰；命中：语义淡彩；默认：语义色低饱和底
 */
const landFillColor = [
  'case',
  featureState('selected'),
  PALETTE.selected,
  featureState('focus'),
  ['case', featureState('hover'), focusHoverColorExpr, PALETTE.focus],
  featureState('hover'),
  groupColorExpr,
  featureState('dim'),
  PALETTE.dim,
  featureState('match'),
  matchColorExpr,
  groupBaseColorExpr,
];

/** 国境线：zoom 插值 0.7 → 1.3px；命中时带政策组语义色。 */
const borderWidth = ['interpolate', ['linear'], ['zoom'], 0.5, 0.7, 6, 1.3];
const borderColor = [
  'case',
  featureState('focus'),
  ['case', featureState('selected'), PALETTE.outline, PALETTE.focusBorder],
  featureState('dim'),
  '#242b2f',
  featureState('match'),
  groupColorExpr,
  PALETTE.border,
];
const borderOpacity = [
  'case',
  featureState('selected'),
  1,
  featureState('focus'),
  0.4,
  featureState('dim'),
  0.4,
  featureState('match'),
  0.78,
  0.9,
];

/** 描边 / 柔光：selected 用参考黄；hover 用政策组语义色。 */
const outlineWidth = [
  'case',
  featureState('selected'),
  2.6,
  featureState('focus'),
  ['case', featureState('hover'), 1.0, 0.01],
  featureState('hover'),
  2.1,
  0.01,
];
const outlineColor = ['case', featureState('selected'), PALETTE.outline, groupColorExpr];
const outlineOpacity = [
  'case',
  featureState('selected'),
  1,
  featureState('focus'),
  ['case', featureState('hover'), 0.75, 0],
  featureState('hover'),
  1,
  0,
];
const glowWidth = [
  'case',
  featureState('selected'),
  9,
  featureState('focus'),
  ['case', featureState('hover'), 3.5, 0.01],
  featureState('hover'),
  6,
  0.01,
];
const glowOpacity = [
  'case',
  featureState('selected'),
  0.6,
  featureState('focus'),
  ['case', featureState('hover'), 0.16, 0],
  featureState('hover'),
  0.38,
  0,
];
const glowColor = ['case', featureState('selected'), PALETTE.outline, groupColorExpr];
/** selected 内部再叠一圈政策组语义色描边：黄选中 + 类别点缀 */
const accentWidth = ['case', featureState('selected'), 1.25, 0.01];
const accentOpacity = ['case', featureState('selected'), 0.95, 0];

/**
 * 微国家圆点：3–6px，hover / selected 放大。
 * MapLibre 限制：一个 paint 属性里 zoom 只能作为顶层 step/interpolate 的输入，
 * 因此把 feature-state 缩放 case 放在 interpolate 的每个 stop 输出里（只有一处 zoom 表达）。
 */
const microRadiusScale = ['case', featureState('selected'), 1.5, featureState('hover'), 1.35, 1];
const microRadius = [
  'interpolate',
  ['linear'],
  ['zoom'],
  0,
  ['*', 3, microRadiusScale],
  2,
  ['*', 3.6, microRadiusScale],
  5,
  ['*', 5, microRadiusScale],
  8,
  ['*', 6, microRadiusScale],
];
const microGlowRadius = ['interpolate', ['linear'], ['zoom'], 0, 7.2, 2, 8.6, 5, 12, 8, 14.4];
const microColor = [
  'case',
  featureState('selected'),
  PALETTE.selected,
  featureState('focus'),
  ['case', featureState('hover'), focusHoverColorExpr, PALETTE.focus],
  featureState('hover'),
  groupColorExpr,
  featureState('dim'),
  PALETTE.dim,
  featureState('match'),
  matchColorExpr,
  groupBaseColorExpr,
];
const microStrokeWidth = ['case', featureState('selected'), 2, featureState('hover'), 1.6, 1];
const microStrokeColor = [
  'case',
  featureState('selected'),
  PALETTE.outline,
  featureState('focus'),
  PALETTE.focusBorder,
  featureState('hover'),
  groupColorExpr,
  PALETTE.ocean,
];
const microGlowColor = ['case', featureState('selected'), PALETTE.outline, groupColorExpr];
const microGlowOpacity = [
  'case',
  featureState('selected'),
  0.28,
  featureState('focus'),
  ['case', featureState('hover'), 0.1, 0],
  featureState('hover'),
  0.22,
  0,
];

function buildStyle(
  countries: FeatureCollectionLike<CountryProperties>,
  microstates: FeatureCollectionLike<MicroProperties>,
): StyleSpecification {
  const style = {
    version: 8,
    name: 'visa-atlas-globe',
    projection: { type: 'globe' },
    sources: {
      // 加大 tile buffer：避免 globe 投影下 GeoJSON 被内部瓦片裁切时在 tile 边界留下
      // 被 line 图层描出的“假国境线/极地环带”（这是 MapLibre GeoJSON 源的已知表现）。
      [SOURCE_COUNTRIES]: { type: 'geojson', data: countries, promoteId: 'iso2', buffer: 512 },
      [SOURCE_MICRO]: { type: 'geojson', data: microstates, promoteId: 'iso2', buffer: 256 },
      [SOURCE_SEAM_COVER]: { type: 'geojson', data: SEAM_COVER_DATA },
    },
    layers: [
      {
        id: 'ocean',
        type: 'background',
        paint: { 'background-color': PALETTE.ocean },
      },
      {
        id: LAYER_FILL,
        type: 'fill',
        source: SOURCE_COUNTRIES,
        paint: { 'fill-color': landFillColor, 'fill-opacity': 1 },
      },
      {
        id: 'country-borders',
        type: 'line',
        source: SOURCE_COUNTRIES,
        paint: {
          'line-color': borderColor,
          'line-width': borderWidth,
          'line-opacity': borderOpacity,
        },
      },
      {
        id: 'country-glow',
        type: 'line',
        source: SOURCE_COUNTRIES,
        paint: {
          'line-color': glowColor,
          'line-width': glowWidth,
          'line-blur': 3.4,
          'line-opacity': glowOpacity,
        },
      },
      {
        id: 'country-outline',
        type: 'line',
        source: SOURCE_COUNTRIES,
        paint: {
          'line-color': outlineColor,
          'line-width': outlineWidth,
          'line-opacity': outlineOpacity,
        },
      },
      {
        id: 'selected-accent',
        type: 'line',
        source: SOURCE_COUNTRIES,
        paint: {
          'line-color': groupColorExpr,
          'line-width': accentWidth,
          'line-opacity': accentOpacity,
          'line-blur': 0.3,
        },
      },
      {
        id: 'micro-glow',
        type: 'circle',
        source: SOURCE_MICRO,
        paint: {
          'circle-radius': microGlowRadius,
          'circle-color': microGlowColor,
          'circle-blur': 1,
          'circle-opacity': microGlowOpacity,
        },
      },
      {
        id: LAYER_MICRO,
        type: 'circle',
        source: SOURCE_MICRO,
        paint: {
          'circle-radius': microRadius,
          'circle-color': microColor,
          'circle-stroke-color': microStrokeColor,
          'circle-stroke-width': microStrokeWidth,
        },
      },
      {
        id: 'seam-cover-top',
        type: 'line',
        source: SOURCE_SEAM_COVER,
        paint: {
          'line-color': PALETTE.ocean,
          'line-width': ['interpolate', ['linear'], ['zoom'], 0, 7, 4, 4.5, 8, 2.5],
          'line-opacity': 1,
        },
      },
    ],
    sky: {
      'sky-color': '#05080b',
      'horizon-color': '#0b1218',
      'fog-color': '#05080b',
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.55, 9, 0.2],
    },
  };
  return style as unknown as StyleSpecification;
}

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const setFeatureStateSafe = (map: MapLibreMap, source: string, id: string, state: Record<string, boolean>): void => {
  try {
    map.setFeatureState({ source, id }, state);
  } catch {
    /* source 尚未就绪时忽略，load 后会统一同步 */
  }
};

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return '';
};

/** 把 API 政策类别与分类色合入 GeoJSON（不写回磁盘，仅运行时视觉用） */
function decorateFeature(meta: MapCountry | undefined): {
  categoryCode: string | null;
  groupCode: string | null;
  groupColor: string;
  groupBaseColor: string;
  matchColor: string;
  focusHoverColor: string;
} {
  const bright = groupBrightColor(meta?.group);
  return {
    categoryCode: meta?.categoryCode ?? null,
    groupCode: meta?.group ?? null,
    groupColor: bright,
    groupBaseColor: meta?.group ? groupBaseColor(bright) : PALETTE.unknown,
    matchColor: matchTint(bright),
    focusHoverColor: groupFocusHoverColor(bright),
  };
}

function decorateCountries(collection: FeatureCollectionLike<CountryProperties>, countries: MapCountry[]): void {
  const metaByIso = new Map(countries.map(country => [country.iso2, country]));
  for (const feature of collection.features) {
    Object.assign(feature.properties, decorateFeature(metaByIso.get(feature.properties.iso2)));
  }
}

function decorateMicrostates(collection: FeatureCollectionLike<MicroProperties>, countries: MapCountry[]): void {
  const metaByIso = new Map(countries.map(country => [country.iso2, country]));
  for (const feature of collection.features) {
    Object.assign(feature.properties, decorateFeature(metaByIso.get(feature.properties.iso2)));
  }
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 两个经纬度之间的球面角距（度） */
const angularDistanceDegrees = (
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number => {
  const deltaLng = toRadians(a.lng - b.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const cosine = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
};

/**
 * globe 投影下地图可视区域是球面上的一个圆盘，圆盘之外是太空。
 * MapLibre 的 `queryRenderedFeatures` 对圆盘外的点仍可能返回背面国家（会把点吸附到地平线），
 * 因此点击/悬停前先用「地心到地平线最大角距」判断点是否真的落在地球表面。
 */
const isPointOnGlobeSurface = (map: MapLibreMap, point: { x: number; y: number }): boolean => {
  try {
    const center = map.getCenter();
    // 画布外的点会被 unproject 吸附到地平线，用它的角距作为可视球冠半径
    const horizon = map.unproject([-10_000, -10_000]);
    if (!Number.isFinite(horizon.lng) || !Number.isFinite(horizon.lat)) return false;
    const horizonAngle = angularDistanceDegrees(center, horizon);
    if (!(horizonAngle > 0)) return true;
    const lngLat = map.unproject([point.x, point.y]);
    if (!Number.isFinite(lngLat.lng) || !Number.isFinite(lngLat.lat)) return false;
    return angularDistanceDegrees(center, lngLat) < horizonAngle - 0.02;
  } catch {
    return true;
  }
};

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

export function GlobeMap(props: GlobeMapProps) {
  const { selected, matched, hoverIso2, focusRequest, resetSignal } = props;
  const { t } = useI18n();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  const propsRef = useRef(props);
  propsRef.current = props;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  /** 250 个国家的几何元数据（聚焦时查 bbox/center） */
  const countryMetaRef = useRef<Map<string, CountryProperties>>(new Map());
  const microMetaRef = useRef<Map<string, MicroProperties>>(new Map());
  const countryIdsRef = useRef<string[]>([]);
  const microIdsRef = useRef<string[]>([]);

  /** feature-state 当前实际值，避免重复 setFeatureState */
  const selectedStateRef = useRef<string | null>(null);
  const hoverStateRef = useRef<string | null>(null);
  const hoverInternalRef = useRef<string | null>(null);
  const dimmedStateRef = useRef<Set<string>>(new Set());
  const matchedStateRef = useRef<Set<string>>(new Set());
  const pointerDownPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const readyCalledRef = useRef(false);
  const lastFocusNonceRef = useRef<number | null>(null);
  const lastResetSignalRef = useRef(resetSignal);
  /** 响应式初始视角：随容器短边变化，reset 时回到当前基线 */
  const initialZoomRef = useRef(BASE_ZOOM);
  /** 用户是否已经亲手操作过相机（拖拽/缩放/飞行）——交互过则 resize 不抢视角 */
  const hasInteractedRef = useRef(false);

  /* ---------------- prefers-reduced-motion ---------------- */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  /* ---------------- feature-state 同步（不经过 React state） ---------------- */

  const syncSelected = useCallback((map: MapLibreMap, next: string | null) => {
    if (selectedStateRef.current === next) return;
    if (selectedStateRef.current) {
      setFeatureStateSafe(map, SOURCE_COUNTRIES, selectedStateRef.current, { selected: false });
      setFeatureStateSafe(map, SOURCE_MICRO, selectedStateRef.current, { selected: false });
    }
    selectedStateRef.current = next;
    if (next) {
      setFeatureStateSafe(map, SOURCE_COUNTRIES, next, { selected: true });
      setFeatureStateSafe(map, SOURCE_MICRO, next, { selected: true });
    }
  }, []);

  /**
   * 选中国家后把“其他地区静默”的 focus 状态写到全部 feature。
   * focus=true 时填充为统一深灰，只有 selected 国家保留参考黄；
   * hover 另一个国家时仅给克制提示，不再让整图按语义色各自亮起。
   */
  const syncFocus = useCallback((map: MapLibreMap, active: boolean) => {
    for (const id of countryIdsRef.current) {
      setFeatureStateSafe(map, SOURCE_COUNTRIES, id, { focus: active });
    }
    for (const id of microIdsRef.current) {
      setFeatureStateSafe(map, SOURCE_MICRO, id, { focus: active });
    }
  }, []);

  const syncDim = useCallback((map: MapLibreMap, matchedSet: Set<string> | null) => {
    const active = matchedSet !== null && matchedSet.size > 0; // 0 个命中时不做整图变暗
    const nextDimmed = new Set<string>();
    if (active) {
      const matchedIds = matchedSet as Set<string>;
      for (const id of countryIdsRef.current) if (!matchedIds.has(id)) nextDimmed.add(id);
      for (const id of microIdsRef.current) if (!matchedIds.has(id)) nextDimmed.add(id);
    }
    const previous = dimmedStateRef.current;
    for (const id of previous) {
      if (!nextDimmed.has(id)) {
        setFeatureStateSafe(map, SOURCE_COUNTRIES, id, { dim: false });
        setFeatureStateSafe(map, SOURCE_MICRO, id, { dim: false });
      }
    }
    for (const id of nextDimmed) {
      if (!previous.has(id)) {
        setFeatureStateSafe(map, SOURCE_COUNTRIES, id, { dim: true });
        setFeatureStateSafe(map, SOURCE_MICRO, id, { dim: true });
      }
    }
    dimmedStateRef.current = nextDimmed;
  }, []);

  /** 检索命中的国家单独标记 match=true，用于填充/边框显示低饱和分类色 */
  const syncMatch = useCallback((map: MapLibreMap, matchedSet: Set<string> | null) => {
    const active = matchedSet !== null && matchedSet.size > 0;
    const nextMatched = new Set<string>();
    if (active) {
      const matchedIds = matchedSet as Set<string>;
      for (const id of countryIdsRef.current) if (matchedIds.has(id)) nextMatched.add(id);
      for (const id of microIdsRef.current) if (matchedIds.has(id)) nextMatched.add(id);
    }
    const previous = matchedStateRef.current;
    for (const id of previous) {
      if (!nextMatched.has(id)) {
        setFeatureStateSafe(map, SOURCE_COUNTRIES, id, { match: false });
        setFeatureStateSafe(map, SOURCE_MICRO, id, { match: false });
      }
    }
    for (const id of nextMatched) {
      if (!previous.has(id)) {
        setFeatureStateSafe(map, SOURCE_COUNTRIES, id, { match: true });
        setFeatureStateSafe(map, SOURCE_MICRO, id, { match: true });
      }
    }
    matchedStateRef.current = nextMatched;
  }, []);

  const syncHover = useCallback((map: MapLibreMap) => {
    const effective = hoverInternalRef.current ?? propsRef.current.hoverIso2;
    if (hoverStateRef.current === effective) return;
    if (hoverStateRef.current) {
      setFeatureStateSafe(map, SOURCE_COUNTRIES, hoverStateRef.current, { hover: false });
      setFeatureStateSafe(map, SOURCE_MICRO, hoverStateRef.current, { hover: false });
    }
    hoverStateRef.current = effective;
    if (effective) {
      setFeatureStateSafe(map, SOURCE_COUNTRIES, effective, { hover: true });
      setFeatureStateSafe(map, SOURCE_MICRO, effective, { hover: true });
    }
    map.getCanvas().style.cursor = effective ? 'pointer' : '';
  }, []);

  /* ---------------- 相机动作 ---------------- */

  const flyToIso2 = useCallback((map: MapLibreMap, iso2: string) => {
    const duration = reducedMotionRef.current ? 0 : FLY_DURATION;
    const country = countryMetaRef.current.get(iso2);
    if (country) {
      const bbox = country.bbox;
      if (bbox && bbox.length === 4) {
        // MapLibre v5 globe 的 fitBounds 会忽略 maxZoom，这里手动计算相机并夹紧缩放，
        // 避免阿尔巴尼亚这类小国被放大到占满屏幕。
        const camera = map.cameraForBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
          ],
          { padding: FIT_PADDING },
        );
        if (camera) {
          map.flyTo({
            center: camera.center,
            zoom: Math.min(camera.zoom ?? NO_BBOX_ZOOM, FIT_MAX_ZOOM),
            bearing: 0,
            pitch: 0,
            duration,
          });
          return;
        }
      }
      if (country.center) {
        map.flyTo({ center: country.center, zoom: NO_BBOX_ZOOM, duration });
      }
      return;
    }
    const micro = microMetaRef.current.get(iso2);
    if (micro?.center) {
      map.flyTo({ center: micro.center, zoom: MICRO_ZOOM, duration });
    }
  }, []);

  const resetCamera = useCallback((map: MapLibreMap) => {
    map.flyTo({
      center: INITIAL_CENTER,
      zoom: initialZoomRef.current,
      bearing: 0,
      pitch: 0,
      duration: reducedMotionRef.current ? 0 : RESET_DURATION,
    });
  }, []);

  /* ---------------- 初始化地图 ---------------- */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const controller = new AbortController();
    let resizeObserver: ResizeObserver | null = null;
    let detachCanvasEvents: (() => void) | null = null;
    let detachWindowPointer: (() => void) | null = null;

    setStatus('loading');
    setErrorMessage('');
    window.__globeReady = false;

    const init = async () => {
      try {
        const [countries, microstates] = await Promise.all([
          fetch(GEO_URLS.countries, { signal: controller.signal }).then(response => {
            if (!response.ok) throw new Error(`countries.geo.json ${response.status}`);
            return response.json() as Promise<FeatureCollectionLike<CountryProperties>>;
          }),
          fetch(GEO_URLS.microstates, { signal: controller.signal }).then(response => {
            if (!response.ok) throw new Error(`microstates.geo.json ${response.status}`);
            return response.json() as Promise<FeatureCollectionLike<MicroProperties>>;
          }),
        ]);
        if (disposed) return;

        // 把 API 的政策类别/分类色合入 GeoJSON properties（只在启动时做一次，不增加运行时网络请求）
        decorateCountries(countries, propsRef.current.countries);
        decorateMicrostates(microstates, propsRef.current.countries);

        countryMetaRef.current = new Map(countries.features.map(item => [item.properties.iso2, item.properties]));
        microMetaRef.current = new Map(microstates.features.map(item => [item.properties.iso2, item.properties]));
        countryIdsRef.current = countries.features.map(item => item.properties.iso2);
        microIdsRef.current = microstates.features.map(item => item.properties.iso2);
        selectedStateRef.current = null;
        hoverStateRef.current = null;
        hoverInternalRef.current = null;
        dimmedStateRef.current = new Set();
        matchedStateRef.current = new Set();

        const containerRect = container.getBoundingClientRect();
        const initialZoom = computeInitialZoom(
          containerRect.width || window.innerWidth,
          containerRect.height || window.innerHeight,
        );
        initialZoomRef.current = initialZoom;

        const map = new maplibregl.Map({
          container,
          style: buildStyle(countries, microstates),
          center: INITIAL_CENTER,
          zoom: initialZoom,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          doubleClickZoom: true,
          fadeDuration: 180,
        });
        mapRef.current = map;
        // 开发环境暴露 map 便于浏览器调试（生产构建会被 Vite 摇掉）
        if (import.meta.env.DEV) {
          (window as unknown as { __globeMap?: MapLibreMap }).__globeMap = map;
        }

        /* 视口自适应：未交互过时随容器短边重算初始 zoom；交互过只更新 reset 基线 */
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (disposed || mapRef.current !== map) return;
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            initialZoomRef.current = computeInitialZoom(rect.width, rect.height);
            if (!hasInteractedRef.current) {
              map.jumpTo({ center: INITIAL_CENTER, zoom: initialZoomRef.current });
            }
          });
          resizeObserver.observe(container);
        }

        /* 用户亲手操作相机后，resize 不再自动调整视角 */
        const markInteracted = () => {
          hasInteractedRef.current = true;
        };
        const canvasEvents: [string, EventListener, AddEventListenerOptions][] = [
          ['pointerdown', markInteracted, { passive: true }],
          ['wheel', markInteracted, { passive: true }],
          ['touchstart', markInteracted, { passive: true }],
          ['dblclick', markInteracted, { passive: true }],
        ];
        for (const [type, listener, options] of canvasEvents) {
          map.getCanvas().addEventListener(type, listener, options);
        }
        detachCanvasEvents = () => {
          for (const [type, listener] of canvasEvents) map.getCanvas().removeEventListener(type, listener);
        };

        const queryIso2 = (event: MapMouseEvent): string | null => {
          if (!isPointOnGlobeSurface(map, event.point)) return null;
          try {
            const features = map.queryRenderedFeatures(event.point, { layers: [LAYER_FILL, LAYER_MICRO] });
            const iso2 = features[0]?.properties?.iso2;
            return typeof iso2 === 'string' ? iso2 : null;
          } catch {
            return null;
          }
        };

        const applyAllStates = () => {
          syncSelected(map, propsRef.current.selected);
          syncFocus(map, propsRef.current.selected !== null);
          syncDim(map, propsRef.current.matched);
          syncMatch(map, propsRef.current.matched);
          hoverInternalRef.current = null;
          syncHover(map);
        };

        map.on('load', () => {
          if (disposed || mapRef.current !== map) return;
          applyAllStates();
          window.__globeReady = true;
          if (!readyCalledRef.current) {
            readyCalledRef.current = true;
            propsRef.current.onReady?.();
          }
          requestAnimationFrame(() => {
            if (!disposed && mapRef.current === map) setStatus('ready');
          });
        });

        map.on('error', event => {
          if (disposed || mapRef.current !== map) return;
          const message = errorMessageOf((event as { error?: unknown }).error ?? event);
          if (!map.loaded()) {
            setErrorMessage(message);
            setStatus('error');
          }
          // 已加载后的非致命错误（如单帧渲染告警）不打断地球
        });

        const clearPointerDown = () => {
          // 关键：拖拽结束（包括在球体外/UI 上松开）必须清空按下状态，
          // 否则 mousemove 会一直认为还在拖拽、悬停高亮失效。
          pointerDownPointRef.current = null;
        };
        window.addEventListener('pointerup', clearPointerDown);
        window.addEventListener('mouseup', clearPointerDown);
        window.addEventListener('blur', clearPointerDown);
        detachWindowPointer = () => {
          window.removeEventListener('pointerup', clearPointerDown);
          window.removeEventListener('mouseup', clearPointerDown);
          window.removeEventListener('blur', clearPointerDown);
        };

        map.on('mousedown', event => {
          pointerDownPointRef.current = { x: event.point.x, y: event.point.y };
          dragMovedRef.current = false;
        });

        map.on('mousemove', event => {
          if (pointerDownPointRef.current) {
            const start = pointerDownPointRef.current;
            if (Math.hypot(event.point.x - start.x, event.point.y - start.y) > CLICK_MOVE_TOLERANCE) {
              dragMovedRef.current = true;
            }
            return; // 拖拽拨动地球时不切换 hover
          }
          const next = queryIso2(event);
          if (next === hoverInternalRef.current) return;
          hoverInternalRef.current = next;
          syncHover(map);
          propsRef.current.onHover(next);
        });

        map.on('mouseout', () => {
          if (hoverInternalRef.current === null) return;
          hoverInternalRef.current = null;
          syncHover(map);
          propsRef.current.onHover(null);
        });

        map.on('click', event => {
          const moved = dragMovedRef.current;
          dragMovedRef.current = false;
          pointerDownPointRef.current = null;
          if (moved) return;
          const iso2 = queryIso2(event);
          if (iso2) propsRef.current.onSelect(iso2);
          else propsRef.current.onBackgroundClick();
        });
      } catch (error) {
        if (disposed) return;
        setErrorMessage(errorMessageOf(error));
        setStatus('error');
      }
    };

    void init();

    return () => {
      disposed = true;
      controller.abort();
      resizeObserver?.disconnect();
      detachCanvasEvents?.();
      detachWindowPointer?.();
      const map = mapRef.current;
      mapRef.current = null;
      if (map) map.remove();
      window.__globeReady = false;
    };
  }, [retryNonce, syncDim, syncHover, syncSelected]);

  /* ---------------- 外部状态 → feature-state / 相机 ---------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    syncSelected(map, selected);
    syncFocus(map, selected !== null);
  }, [selected, status, syncSelected, syncFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    syncDim(map, matched);
    syncMatch(map, matched);
  }, [matched, status, syncDim, syncMatch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    syncHover(map);
  }, [hoverIso2, status, syncHover]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready' || !focusRequest) return;
    if (lastFocusNonceRef.current === focusRequest.nonce) return;
    lastFocusNonceRef.current = focusRequest.nonce;
    hasInteractedRef.current = true;
    flyToIso2(map, focusRequest.iso2);
  }, [focusRequest, status, flyToIso2]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== 'ready') return;
    if (lastResetSignalRef.current === resetSignal) return;
    lastResetSignalRef.current = resetSignal;
    hasInteractedRef.current = false;
    resetCamera(map);
  }, [resetSignal, status, resetCamera]);

  /* ---------------- 渲染 ---------------- */

  const handleZoomIn = () => {
    const map = mapRef.current;
    if (!map) return;
    hasInteractedRef.current = true;
    map.zoomIn({ duration: reducedMotionRef.current ? 0 : ZOOM_DURATION });
  };
  const handleZoomOut = () => {
    const map = mapRef.current;
    if (!map) return;
    hasInteractedRef.current = true;
    map.zoomOut({ duration: reducedMotionRef.current ? 0 : ZOOM_DURATION });
  };
  const handleReset = () => {
    const map = mapRef.current;
    if (!map) return;
    hasInteractedRef.current = false;
    resetCamera(map);
  };
  const handleRetry = () => setRetryNonce(value => value + 1);

  return (
    <div
      className={[
        'va-globe',
        status === 'ready' ? 'is-ready' : '',
        status === 'error' ? 'has-error' : '',
        reducedMotion ? 'is-reduced-motion' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-status={status}
      data-countries={props.countries.length}
      role="region"
      aria-label={t('globe.aria')}
      aria-busy={status === 'loading'}
    >
      <div className="va-globe-canvas" ref={containerRef} aria-hidden="true" />

      {status !== 'error' ? (
        <div className="va-globe-loading" role="status" aria-live="polite">
          <span className="va-globe-loading__dot" aria-hidden="true" />
          <span>{t('globe.loading')}</span>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="va-globe-error" role="alert">
          <span className="va-globe-error__title">{t('globe.errorTitle')}</span>
          <span className="va-globe-error__detail">{errorMessage || t('globe.errorHint')}</span>
          <button type="button" className="va-globe-error__retry" onClick={handleRetry}>
            {t('globe.retry')}
          </button>
        </div>
      ) : null}

      <div className="va-globe-controls" role="group" aria-label={t('globe.controls')}>
        <button type="button" className="va-globe-control" aria-label={t('globe.zoomIn')} title={t('globe.zoomIn')} onClick={handleZoomIn}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="va-globe-control" aria-label={t('globe.zoomOut')} title={t('globe.zoomOut')} onClick={handleZoomOut}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="va-globe-control" aria-label={t('globe.reset')} title={t('globe.reset')} onClick={handleReset}>
          <LocateFixed size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default GlobeMap;
