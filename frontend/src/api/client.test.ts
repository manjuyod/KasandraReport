import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, fetchReport } from './client';

const mockJsonResponse = (payload: unknown, status = 200): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
};

const setMockFetchResponse = (payload: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => mockJsonResponse(payload, status)),
  );
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchReport payload validation', () => {
  it('rejects non-array payloads from /api/report', async () => {
    setMockFetchResponse({ message: 'not-an-array' });

    await expect(fetchReport()).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects malformed rows with missing fields', async () => {
    setMockFetchResponse([
      {
        centerName: 'North',
        accountNumber: 100,
        studentName: 'Ally',
        // parentName missing
        phoneNumber: '555-0101',
        email: 'ally@example.com',
      },
    ]);

    await expect(fetchReport()).rejects.toBeInstanceOf(ApiError);
  });

  it('normalizes numeric accountNumber to string', async () => {
    setMockFetchResponse([
      {
        centerName: 'North',
        accountNumber: 100,
        studentName: 'Ally',
        parentName: 'Tay',
        phoneNumber: '555-0101',
        email: 'ally@example.com',
      },
    ]);

    const rows = await fetchReport();
    expect(rows[0].accountNumber).toBe('100');
  });
});
