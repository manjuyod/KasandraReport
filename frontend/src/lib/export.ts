import writeXlsxFile from 'write-excel-file/browser';
import { REPORT_COLUMNS, type ReportColumnKey, type ReportRow } from '../api/types';

type XlsxCellValue = string | { value: string; type: typeof String };

const FORMULA_TRIGGER = /^[ ]*([=+\-@]|\t|\r|\n)/;

const isFormulaLikeValue = (value: string): boolean => {
  return FORMULA_TRIGGER.test(value);
};

export const sanitizeSpreadsheetValue = (value: string): string => {
  if (value === '') {
    return '';
  }

  return isFormulaLikeValue(value) ? `'${value}` : value;
};

const toCellValue = (row: ReportRow, key: ReportColumnKey): string => {
  return sanitizeSpreadsheetValue(String(row[key] ?? ''));
};

const csvEscape = (value: string): string => {
  return `"${sanitizeSpreadsheetValue(value).replace(/"/g, '""')}"`;
};

export const buildReportCsv = (rows: readonly ReportRow[]): string => {
  const header = REPORT_COLUMNS.map((column) => csvEscape(column.label)).join(',');
  const lines = rows.map((row) => {
    const values = REPORT_COLUMNS.map((column) => {
      const value = toCellValue(row, column.key);
      return csvEscape(value);
    });
    return values.join(',');
  });
  return ['\uFEFF' + header, ...lines].join('\r\n');
};

const buildXlsxRows = (rows: readonly ReportRow[]) => {
  const header = REPORT_COLUMNS.map((column) => ({
    value: column.label,
    type: String,
  })) as XlsxCellValue[];
  const data = rows.map((row) => {
    return REPORT_COLUMNS.map((column) => ({
      value: sanitizeSpreadsheetValue(String(row[column.key] ?? '')),
      type: String,
    }));
  }) as XlsxCellValue[][];

  return [header, ...data];
};

const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const exportReportCsv = (rows: readonly ReportRow[], filename = 'kassandra-report.csv'): void => {
  const csv = buildReportCsv(rows);
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerDownload(blob, filename);
};

export const exportReportXlsx = async (
  rows: readonly ReportRow[],
  filename = 'kassandra-report.xlsx',
): Promise<void> => {
  const sheetData = buildXlsxRows(rows);
  const excelFile = await writeXlsxFile(sheetData, { sheet: 'Report' });
  const blob = await excelFile.toBlob();
  triggerDownload(blob, filename);
};
