/**
 * 占位组件：由地图开发负责人替换为完整实现。
 * 这里先锁定与 App 的接口契约，避免前后端/地图并行开发时接口漂移。
 */
import type { MapCountry, RegionCode } from '../../../shared/contracts.ts';

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

export function WorldMap({ countries }: WorldMapProps) {
  return (
    <div className="va-map-placeholder" style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--va-text-3)' }}>
      地图组件加载中…（{countries.length} 个目的地）
    </div>
  );
}
