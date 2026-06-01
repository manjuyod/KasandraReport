import { describe, expect, it } from 'vitest';
import { buildReportCsv, sanitizeSpreadsheetValue } from './export';
import type { ReportRow } from '../api/types';

describe('sanitizeSpreadsheetValue', () => {
  const dangerous = [
    '=SUM(A1)',
    ' +1+1',
    '-2+2',
    '   @HYPERLINK("x","y")',
    '\tstart',
    '\rstart',
    '\nstart',
    '  =CMD("rm -rf /")',
  ];

  it('prefixes values that can trigger formula parsing', () => {
    for (const value of dangerous) {
      expect(sanitizeSpreadsheetValue(value)).toBe(`'${value}`);
    }
  });

  it('does not modify safe content', () => {
    expect(sanitizeSpreadsheetValue('abc')).toBe('abc');
    expect(sanitizeSpreadsheetValue('123')).toBe('123');
  });
});

describe('buildReportCsv', () => {
  it('escapes every field and keeps formula-safe output', () => {
    const rows: ReportRow[] = [
      {
        centerName: 'North Campus',
        accountNumber: '001',
        studentName: '=CMD("rm -rf /")',
        parentName: 'Jane, Doe',
        phoneNumber: '\t202-555-0101',
        email: 'parent@example.com',
      },
    ];

    const csv = buildReportCsv(rows);
    const lines = csv.split('\r\n');

    expect(lines[0]).toContain(
      '"Center Name","Account Number","Student Name","Parent Name","Phone Number","Email"',
    );
    expect(lines[1]).toContain("\"'=CMD(\"\"rm -rf /\"\")\"");
    expect(lines[1]).toContain('"Jane, Doe"');
    expect(lines[1]).toContain('"\'\t202-555-0101"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});
