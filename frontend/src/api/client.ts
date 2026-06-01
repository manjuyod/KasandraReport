import { ApiErrorCode, getApiErrorCode } from './errors';
import type { ReportRow } from './types';

const API_PATHS = {
  login: '/api/login',
  logout: '/api/logout',
  report: '/api/report',
} as const;

const JSON_HEADERS = {
  'Content-Type': 'application/json',
} as const;

export class ApiError extends Error {
  public code: ApiErrorCode;
  public status: number;

  constructor(status: number, code: ApiErrorCode, message = 'API request failed') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ReportPayload = Record<string, unknown>;
const toStringValue = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

const invalidReportPayload = (): never => {
  throw new ApiError(200, 'unexpected_error', 'Invalid report payload');
};

const requireStringField = (value: unknown): string => {
  if (typeof value !== 'string') {
    invalidReportPayload();
  }

  return value as string;
};

const requireStringOrNumberField = (value: unknown): string => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    invalidReportPayload();
  }

  return toStringValue(value);
};

const parseErrorCode = async (response: Response): Promise<ApiErrorCode> => {
  let code: string | undefined;
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'error' in payload) {
        const raw = (payload as { error?: unknown }).error;
        if (typeof raw === 'string') {
          code = raw;
        }
      }
    }
  } catch {
    // ignore parse failures and fall back to status-based code
  }

  if (response.status === 0) {
    return 'network_error';
  }

  if (code) {
    const mapped = code.toLowerCase();
    switch (mapped) {
      case 'unauthorized':
      case 'too_many_requests':
      case 'service_unavailable':
      case 'gateway_timeout':
      case 'internal_error':
      case 'network_error':
      case 'unexpected_error':
        return mapped as ApiErrorCode;
      default:
        break;
    }
  }

  return getApiErrorCode({
    status: response.status,
    code,
  });
};

const parseApiError = async (response: Response): Promise<ApiError> => {
  const code = await parseErrorCode(response);
  return new ApiError(response.status, code, `Request failed: ${response.status}`);
};

const requestJson = async <T>(url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...JSON_HEADERS,
        ...(init?.headers ?? {}),
      },
      credentials: 'include',
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network error');
  }

  if (!response.ok) {
    throw await parseApiError(response);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
};

export async function login(password: string): Promise<void> {
  await requestJson(API_PATHS.login, {
    method: 'POST',
    body: JSON.stringify({ password }),
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export async function logout(): Promise<void> {
  await requestJson(API_PATHS.logout, {
    method: 'POST',
  });
}

export async function fetchReport(): Promise<ReportRow[]> {
  const rawData = await requestJson<unknown>(API_PATHS.report, { method: 'GET' });

  if (!Array.isArray(rawData)) {
    invalidReportPayload();
  }

  return (rawData as unknown[]).map((row: unknown) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      invalidReportPayload();
    }

    const typedRow = row as ReportPayload;
    return {
      centerName: requireStringField(typedRow.centerName),
      accountNumber: requireStringOrNumberField(typedRow.accountNumber),
      studentName: requireStringField(typedRow.studentName),
      parentName: requireStringField(typedRow.parentName),
      phoneNumber: requireStringField(typedRow.phoneNumber),
      email: requireStringField(typedRow.email),
    };
  });
}
