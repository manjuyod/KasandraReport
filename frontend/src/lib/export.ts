import writeXlsxFile from 'write-excel-file/browser';
import type { Feature } from 'write-excel-file/browser';
import {
  findElement,
  getOrderOfSiblings,
  getSelfClosingTagMarkup,
  insertElementMarkupAccordingToOrderOfSiblings,
  replaceElement,
} from 'write-excel-file/utility';
import { REPORT_COLUMNS, type ReportColumnKey, type ReportRow } from '../api/types';

type XlsxCellValue = string | { value: string; type: typeof String };
type BrowserFileContent = File | Blob | ArrayBuffer;
type ReportDownloadExtension = 'csv' | 'xlsx';

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

const padDatePart = (value: number): string => String(value).padStart(2, '0');

const formatLocalDate = (date: Date): string => {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
};

export const buildReportDownloadFilename = (
  extension: ReportDownloadExtension,
  date = new Date(),
): string => {
  return `Student Info Run ${formatLocalDate(date)}.${extension}`;
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

const getExcelColumnName = (oneBasedColumnIndex: number): string => {
  let remaining = oneBasedColumnIndex;
  let columnName = '';

  while (remaining > 0) {
    remaining -= 1;
    columnName = String.fromCharCode(65 + (remaining % 26)) + columnName;
    remaining = Math.floor(remaining / 26);
  }

  return columnName;
};

const buildXlsxAutoFilterRef = (rowCount: number): string => {
  const lastColumn = getExcelColumnName(REPORT_COLUMNS.length);
  const lastRow = Math.max(1, rowCount);
  return `A1:${lastColumn}${lastRow}`;
};

const insertXlsxAutoFilter = (xml: string, ref: string): string => {
  const autoFilterXml = getSelfClosingTagMarkup('autoFilter', { ref });
  const existingAutoFilter = findElement(xml, 'autoFilter');
  const worksheetSiblingOrder = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet') ?? [];

  if (existingAutoFilter) {
    return replaceElement(xml, existingAutoFilter, autoFilterXml);
  }

  return insertElementMarkupAccordingToOrderOfSiblings(
    xml,
    autoFilterXml,
    worksheetSiblingOrder,
    'worksheet',
  );
};

export const createXlsxAutoFilterFeature = (rowCount: number): Feature<BrowserFileContent> => {
  const ref = buildXlsxAutoFilterRef(rowCount);

  return {
    files: {
      transform: {
        'xl/worksheets/sheet{id}.xml': {
          transform: (xml) => insertXlsxAutoFilter(xml, ref),
        },
      },
    },
  };
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

export const exportReportCsv = (
  rows: readonly ReportRow[],
  filename = buildReportDownloadFilename('csv'),
): void => {
  const csv = buildReportCsv(rows);
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;',
  });
  triggerDownload(blob, filename);
};

export const exportReportXlsx = async (
  rows: readonly ReportRow[],
  filename = buildReportDownloadFilename('xlsx'),
): Promise<void> => {
  const sheetData = buildXlsxRows(rows);
  const excelFile = await writeXlsxFile(
    sheetData,
    { sheet: 'Report' },
    { features: [createXlsxAutoFilterFeature(sheetData.length)] },
  );
  const blob = await excelFile.toBlob();
  triggerDownload(blob, filename);
};
