import { REPORT_COLUMNS } from '../api/types';
import type { ReportRow } from '../api/types';
import type { ReportColumnKey } from '../api/types';

type WrappedReportColumn =
  | 'studentName'
  | 'parentName'
  | 'phoneNumber'
  | 'email'
  | 'centerName'
  | 'accountNumber';

function getCellClassName(key: ReportColumnKey): string {
  const className = key as WrappedReportColumn;
  return `report-cell report-cell--${className}`;
}

interface ReportTableProps {
  rows: readonly ReportRow[];
}

export function ReportTable({ rows }: ReportTableProps) {
  return (
    <div className="report-table-wrap" role="region" aria-live="polite" aria-label="Report table">
      <table className="report-table">
        <thead>
          <tr>
            {REPORT_COLUMNS.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row.accountNumber}-${rowIndex}`}>
              {REPORT_COLUMNS.map((column) => {
                const value = row[column.key];
                return (
                  <td
                    key={`${row.accountNumber}-${column.key}-${rowIndex}`}
                    className={getCellClassName(column.key)}
                    title={value}
                  >
                    {value}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
