import { describe, expect, it } from 'vitest';
import { ApiErrorCode, getApiErrorCode, mapLoginError, mapReportError } from './errors';

describe('error mapping', () => {
  it('normalizes transport errors', () => {
    expect(
      getApiErrorCode({
        status: 0,
      }),
    ).toBe('network_error');
  });

  it('maps unauthorized errors for auth and report flows', () => {
    expect(mapLoginError('unauthorized')).toBe('invalid_password');
    expect(mapReportError('unauthorized')).toBe('session_expired');
  });

  it('maps unknown payload to status fallback', () => {
    const statusMapped = getApiErrorCode({
      status: 429,
      code: 'unexpected',
    } as { status: number; code: string });
    expect(statusMapped).toBe('too_many_requests');
  });

  it('maps HTTP 503 payload into login/report helpers', () => {
    const code = getApiErrorCode({ status: 503, code: 'not_a_code' } as {
      status: number;
      code: string;
    });
    expect(code).toBe('service_unavailable');
    expect(mapLoginError(code)).toBe('backend_unavailable');
    expect(mapReportError(code)).toBe('backend_unavailable');
  });

  it('accepts valid ApiErrorCode values', () => {
    const codes: ApiErrorCode[] = [
      'unauthorized',
      'too_many_requests',
      'service_unavailable',
      'gateway_timeout',
      'internal_error',
      'network_error',
      'unexpected_error',
    ];
    expect(codes.every((code) => typeof code === 'string')).toBe(true);
  });
});
