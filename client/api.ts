/**
 * Visa Atlas · 前端 API 封装
 *
 * - 所有请求走同源 `/api`（Vite 开发环境由代理转发到 127.0.0.1:3001）
 * - 响应统一为 `{ data }` / `{ error: { code, message, details? } }`
 * - 全部 `cache: 'no-store'`，全部支持 AbortController
 * - 失败统一抛 ApiError（含 code / status / message），调用方用 isAbortError 过滤取消
 */
import type {
  ApiErrorBody,
  CountryDossier,
  OverviewResponse,
  SearchQuery,
  SearchResponse,
  Suggestion,
} from '../shared/contracts.ts';
import { toSearchParams } from '../shared/contracts.ts';

const API_BASE = '/api';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: ApiErrorDetail[] | undefined;

  constructor(code: string, message: string, status = 0, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** AbortController 取消并非错误，调用方应静默忽略 */
export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === 'AbortError';
  return error instanceof Error && error.name === 'AbortError';
}

/** 把任意异常收窄成可展示的 ApiError */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError('UNKNOWN_ERROR', error.message || '请求失败，请稍后再试。');
  return new ApiError('UNKNOWN_ERROR', '请求失败，请稍后再试。');
}

interface RequestOptions {
  signal?: AbortSignal;
  method?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { signal, method = 'GET' } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('NETWORK_ERROR', '无法连接资料服务，请确认 API 已启动后重试。', 0);
  }

  let text = '';
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError('NETWORK_ERROR', '读取资料服务响应失败，请重试。', response.status);
  }

  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(
        'INVALID_RESPONSE',
        response.ok ? '资料服务返回了无法解析的内容。' : `请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }
  }

  if (!response.ok) {
    const envelope = body as ApiErrorBody | null;
    const detail = envelope && typeof envelope === 'object' ? envelope.error : undefined;
    throw new ApiError(
      detail?.code ?? `HTTP_${response.status}`,
      detail?.message ?? '请求失败，请稍后再试。',
      response.status,
      detail?.details as ApiErrorDetail[] | undefined,
    );
  }

  if (!body || typeof body !== 'object' || !('data' in body)) {
    throw new ApiError('INVALID_RESPONSE', '资料服务返回了无法识别的内容。', response.status);
  }
  return (body as { data: T }).data;
}

/** 数据集元信息 + 统计 + 地图着色数据 + 全部字典 */
export function fetchOverview(signal?: AbortSignal): Promise<OverviewResponse> {
  return request<OverviewResponse>('/v1/overview', { signal });
}

/** 检索结果：q / type / region / group / category / stay / status / priority / demo / sort / page / pageSize */
export function fetchSearch(query: SearchQuery, signal?: AbortSignal): Promise<SearchResponse> {
  const params = toSearchParams(query);
  params.set('pageSize', String(query.pageSize));
  return request<SearchResponse>(`/v1/search?${params.toString()}`, { signal });
}

/** 搜索框联想（最多 8 条） */
export function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const keyword = q.trim();
  if (!keyword) return Promise.resolve([]);
  const params = new URLSearchParams({ q: keyword.slice(0, 40) });
  return request<Suggestion[]>(`/v1/suggest?${params.toString()}`, { signal });
}

/** 国家档案；includeDemo = true 时附带演示明细 */
export function fetchCountry(iso2: string, includeDemo: boolean, signal?: AbortSignal): Promise<CountryDossier> {
  const suffix = includeDemo ? '?demo=1' : '';
  return request<CountryDossier>(`/v1/countries/${encodeURIComponent(iso2.toUpperCase())}${suffix}`, { signal });
}
