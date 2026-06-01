import { describe, expect, it } from 'vitest';
import { resolveBackendProxyTarget } from './devProxy';

describe('resolveBackendProxyTarget', () => {
  it('uses BACKEND_URL when provided', () => {
    expect(resolveBackendProxyTarget({ BACKEND_URL: 'http://127.0.0.1:18084' })).toBe(
      'http://127.0.0.1:18084',
    );
  });

  it('builds a localhost target from BACKEND_PORT', () => {
    expect(resolveBackendProxyTarget({ BACKEND_PORT: '18084' })).toBe('http://localhost:18084');
  });

  it('falls back to PORT before the default backend port', () => {
    expect(resolveBackendProxyTarget({ PORT: '19000' })).toBe('http://localhost:19000');
    expect(resolveBackendProxyTarget({})).toBe('http://localhost:8080');
  });
});
