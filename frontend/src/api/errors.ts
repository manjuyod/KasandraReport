export type ApiErrorCode =
  | 'unauthorized'
  | 'too_many_requests'
  | 'service_unavailable'
  | 'gateway_timeout'
  | 'internal_error'
  | 'network_error'
  | 'unexpected_error';

export type LoginFailureState =
  | 'invalid_password'
  | 'rate_limited'
  | 'backend_unavailable'
  | 'network_error'
  | 'session_expired'
  | 'unknown';

export type ReportFailureState =
  | 'session_expired'
  | 'backend_unavailable'
  | 'network_error'
  | 'unexpected';

export interface ApiErrorLike {
  status: number;
  code?: string;
}

const STATUS_ERROR_CODE_MAP: Readonly<Record<number, ApiErrorCode>> = {
  401: 'unauthorized',
  429: 'too_many_requests',
  503: 'service_unavailable',
  504: 'gateway_timeout',
  500: 'internal_error',
};

const VALID_ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'too_many_requests',
  'service_unavailable',
  'gateway_timeout',
  'internal_error',
  'network_error',
  'unexpected_error',
]);

const normalizeErrorCode = (value: unknown): ApiErrorCode | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase();
  return VALID_ERROR_CODES.has(normalized) ? (normalized as ApiErrorCode) : null;
}

export function getApiErrorCode(error: unknown): ApiErrorCode {
  if (!error || typeof error !== 'object') {
    return 'unexpected_error';
  }

  const candidate = error as ApiErrorLike;
  if (typeof candidate.status === 'number' && Number.isFinite(candidate.status)) {
    const fromCode = normalizeErrorCode(candidate.code);
    if (candidate.status === 0 && !candidate.code) {
      return 'network_error';
    }

    if (fromCode) {
      return fromCode;
    }

    return STATUS_ERROR_CODE_MAP[candidate.status] ?? 'unexpected_error';
  }

  return 'unexpected_error';
}

export function mapLoginError(code: ApiErrorCode): LoginFailureState {
  switch (code) {
    case 'unauthorized':
      return 'invalid_password';
    case 'too_many_requests':
      return 'rate_limited';
    case 'service_unavailable':
    case 'gateway_timeout':
      return 'backend_unavailable';
    case 'network_error':
      return 'network_error';
    default:
      return 'unknown';
  }
}

export function mapReportError(code: ApiErrorCode): ReportFailureState {
  switch (code) {
    case 'unauthorized':
      return 'session_expired';
    case 'service_unavailable':
    case 'gateway_timeout':
      return 'backend_unavailable';
    case 'network_error':
      return 'network_error';
    default:
      return 'unexpected';
  }
}

