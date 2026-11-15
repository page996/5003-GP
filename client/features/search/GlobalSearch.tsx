import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react';
import {
  FileText,
  Globe2,
  Loader2,
  MapPin,
  Search,
  SearchX,
  Stamp,
  Tag,
  X,
} from 'lucide-react';
import { fetchSuggestions, isAbortError } from '../../api';
import type { Suggestion } from '../../../shared/contracts.ts';
import { cx } from '../../components/cx';

type SuggestionKind = Suggestion['kind'];

const GROUP_ORDER: SuggestionKind[] = ['country', 'alias', 'category', 'type', 'keyword'];
const GROUP_LABEL: Record<SuggestionKind, string> = {
  country: '国家 / 地区',
  alias: '别名与缩写',
  category: '政策类别',
  type: '签证类型',
  keyword: '关键词',
};

function kindIcon(kind: SuggestionKind): ReactNode {
  const size = 15;
  switch (kind) {
    case 'country':
      return <Globe2 size={size} strokeWidth={1.7} aria-hidden="true" />;
    case 'alias':
      return <MapPin size={size} strokeWidth={1.7} aria-hidden="true" />;
    case 'category':
      return <Tag size={size} strokeWidth={1.7} aria-hidden="true" />;
    case 'type':
      return <Stamp size={size} strokeWidth={1.7} aria-hidden="true" />;
    default:
      return <FileText size={size} strokeWidth={1.7} aria-hidden="true" />;
  }
}

interface GlobalSearchProps {
  value: string;
  onChange: (text: string) => void;
  onSubmit: (text?: string) => void;
  onPickCountry: (iso2: string) => void;
  onPickCategory: (code: string) => void;
  onPickType: (code: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * 顶部全局搜索：受控输入 + 300ms 联想 + 分组下拉 + 键盘操作。
 * `/` 聚焦由 App 的全局快捷键负责；Esc 在联想打开时只关闭联想。
 */
export function GlobalSearch({
  value,
  onChange,
  onSubmit,
  onPickCountry,
  onPickCategory,
  onPickType,
  inputRef,
}: GlobalSearchProps) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const keyword = value.trim();

  useEffect(() => {
    abortRef.current?.abort();
    if (!keyword) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setHighlight(-1);
      return;
    }
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      fetchSuggestions(keyword, controller.signal)
        .then(next => {
          if (controller.signal.aborted) return;
          setSuggestions(next);
          // 首屏从 URL 恢复关键词时不主动展开联想；仅输入框聚焦时展开
          if (focusedRef.current) setOpen(true);
          setHighlight(-1);
        })
        .catch(error => {
          if (isAbortError(error) || controller.signal.aborted) return;
          setSuggestions([]);
          if (focusedRef.current) setOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        focusedRef.current = false;
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const commit = useCallback(
    (item: Suggestion) => {
      setOpen(false);
      setHighlight(-1);
      if (item.kind === 'country' || item.kind === 'alias') {
        const iso2 = item.iso2 ?? (item.kind === 'country' ? item.code : null);
        if (iso2) {
          onPickCountry(iso2.toUpperCase());
          return;
        }
        onSubmit(item.label);
        return;
      }
      if (item.kind === 'category') {
        onPickCategory(item.code);
        return;
      }
      if (item.kind === 'type') {
        onPickType(item.code);
        return;
      }
      onSubmit(item.label);
    },
    [onPickCategory, onPickCountry, onPickType, onSubmit],
  );

  const groupOrder = GROUP_ORDER.map(kind => ({
    kind,
    items: suggestions.filter(item => item.kind === kind),
  })).filter(group => group.items.length > 0);
  const flat = groupOrder.flatMap(group => group.items);
  const showPanel = open && keyword.length > 0;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (!showPanel || flat.length === 0) return;
      event.preventDefault();
      setHighlight(prev => (prev + 1) % flat.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      if (!showPanel || flat.length === 0) return;
      event.preventDefault();
      setHighlight(prev => (prev <= 0 ? flat.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (showPanel && highlight >= 0 && flat[highlight]) {
        commit(flat[highlight]);
      } else {
        setOpen(false);
        onSubmit();
      }
      return;
    }
    if (event.key === 'Escape') {
      if (showPanel) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setHighlight(-1);
      }
      return;
    }
    if (event.key === 'Tab') setOpen(false);
  }

  function handleFocus() {
    focusedRef.current = true;
    if (keyword && flat.length > 0) setOpen(true);
  }

  function handleBlur(event: ReactFocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && wrapperRef.current?.contains(next)) return;
    focusedRef.current = false;
    setOpen(false);
  }

  function handleClear() {
    abortRef.current?.abort();
    setSuggestions([]);
    setOpen(false);
    focusedRef.current = true;
    onChange('');
    onSubmit('');
    inputRef.current?.focus();
  }

  let currentKind: SuggestionKind | null = null;
  const optionRows: ReactNode[] = [];
  flat.forEach((item, index) => {
    if (item.kind !== currentKind) {
      currentKind = item.kind;
      optionRows.push(
        <div key={`group-${item.kind}`} className="va-search__group" role="presentation">
          {GROUP_LABEL[item.kind]}
        </div>,
      );
    }
    const active = index === highlight;
    optionRows.push(
      <button
        key={`${item.kind}-${item.code}-${index}`}
        id={`${listId}-option-${index}`}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={-1}
        className={cx('va-search__option', active && 'is-highlighted')}
        onMouseEnter={() => setHighlight(index)}
        onClick={() => commit(item)}
      >
        <span className="va-search__option-icon">{kindIcon(item.kind)}</span>
        <span className="va-search__option-label">{item.label}</span>
        {item.hint ? <span className="va-search__option-hint">{item.hint}</span> : null}
        {item.iso2 || item.kind === 'country' || item.kind === 'alias' ? (
          <code className="va-search__option-code">{item.iso2 ?? item.code}</code>
        ) : null}
      </button>,
    );
  });

  return (
    <div className="va-search" ref={wrapperRef} role="search">
      <div className={cx('va-search__box', showPanel && 'is-open')}>
        <Search size={17} strokeWidth={1.8} className="va-search__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="va-search__input"
          type="text"
          value={value}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-option-${highlight}` : undefined}
          aria-label="搜索国家、签证类型或关键词"
          placeholder="搜索国家、签证类型或关键词，如「日本」「免签」「落地签」"
          autoComplete="off"
          spellCheck={false}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          data-testid="search-input"
        />
        {loading ? <Loader2 size={14} className="va-search__spinner va-spin" aria-hidden="true" /> : null}
        {value ? (
          <button type="button" className="va-search__clear" onClick={handleClear} aria-label="清除搜索">
            <X size={13} aria-hidden="true" />
          </button>
        ) : (
          <span className="va-search__kbd" aria-hidden="true">
            <kbd>/</kbd>
          </span>
        )}
      </div>

      {showPanel ? (
        <div className="va-search__panel" id={listId} role="listbox" aria-label="搜索建议">
          {flat.length > 0 ? (
            <>
              <div className="va-search__options">{optionRows}</div>
              <div className="va-search__foot" aria-hidden="true">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> 选择
                </span>
                <span>
                  <kbd>Enter</kbd> 确认
                </span>
                <span>
                  <kbd>Esc</kbd> 关闭
                </span>
              </div>
            </>
          ) : loading ? (
            <div className="va-search__state">
              <Loader2 size={14} className="va-spin" aria-hidden="true" />
              正在联想…
            </div>
          ) : (
            <div className="va-search__state">
              <SearchX size={15} aria-hidden="true" />
              没有找到「{keyword}」相关国家或类型，按 Enter 直接检索
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
