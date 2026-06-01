import { describe, expect, it } from 'vitest';
import {
  buildReportCsv,
  buildReportDownloadFilename,
  createXlsxAutoFilterFeature,
  sanitizeSpreadsheetValue,
} from './export';
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

describe('buildReportDownloadFilename', () => {
  it('uses Student Info Run plus the browser local date', () => {
    const date = new Date(2026, 5, 1, 12, 30, 0);

    expect(buildReportDownloadFilename('xlsx', date)).toBe('Student Info Run 2026-06-01.xlsx');
    expect(buildReportDownloadFilename('csv', date)).toBe('Student Info Run 2026-06-01.csv');
  });
});

describe('createXlsxAutoFilterFeature', () => {
  it('inserts an Excel autofilter over the report header and data range', () => {
    const feature = createXlsxAutoFilterFeature(3);
    const transform = feature.files?.transform?.['xl/worksheets/sheet{id}.xml']?.transform;
    const xml =
      '<?xml version="1.0" ?><worksheet><sheetViews/><sheetData><row r="1"/><row r="2"/><row r="3"/></sheetData></worksheet>';

    expect(transform?.(xml, { sheet: 'Report' }, { sheetIndex: 0, sheetId: '1' })).toContain(
      '<autoFilter ref="A1:F3"/>',
    );
  });
});
