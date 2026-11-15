/**
 * 统一的 API 错误类型。
 *
 * 服务层只抛这些错误，app 层负责映射为 {error:{code,message,details?}}；
 * 未识别的异常一律视为 500，避免把堆栈/内部信息返回给前端。
 */

export interface ErrorDetail {
  field: string;
  message: string;
}

/** 可安全展示给客户端的错误基类 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(code: string, httpStatus: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/** 参数校验失败（400）：details 指出具体字段，前端可直接定位 */
export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = '请求参数不合法') {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super('NOT_FOUND', 404, message);
  }
}

/** 数据库不可用/未初始化（503）：前端应显示可重试的错误态而不是空结果 */
export class DataUnavailableError extends AppError {
  constructor(message = '数据库暂不可用，请稍后重试', options?: { cause?: unknown }) {
    super('DATA_UNAVAILABLE', 503, message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/** 判断底层数据库错误是否属于「服务不可用」而非查询 bug */
export function isDatabaseUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? '';
  if (
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EPIPE',
      'PROTOCOL_CONNECTION_LOST',
      'ER_ACCESS_DENIED_ERROR',
      'ER_BAD_DB_ERROR',
      'ER_CON_COUNT_ERROR',
      'ER_TABLEACCESS_DENIED_ERROR',
    ].includes(code)
  ) {
    return true;
  }
  const message = error.message;
  return (
    message.includes('database is not open') ||
    message.includes('SQLITE_CANTOPEN') ||
    message.includes('unable to open database file') ||
    message.includes('connect ECONNREFUSED')
  );
}
