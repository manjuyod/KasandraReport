import type { CenterOption } from '../lib/report';

interface ReportToolbarProps {
  disableRefresh: boolean;
  hasData: boolean;
  centerOptions: readonly CenterOption[];
  selectedCenterName: string;
  totalRowCount: number;
  filteredRowCount: number;
  onCenterChange: (centerName: string) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  onLogout: () => void;
}

const formatRowCount = (count: number): string => `${count} ${count === 1 ? 'row' : 'rows'}`;

export function ReportToolbar({
  disableRefresh,
  hasData,
  centerOptions,
  selectedCenterName,
  totalRowCount,
  filteredRowCount,
  onCenterChange,
  onRefresh,
  onExportCsv,
  onExportXlsx,
  onLogout,
}: ReportToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Report toolbar">
      <label className="toolbar-filter" htmlFor="center-filter">
        <span>Center</span>
        <select
          id="center-filter"
          value={selectedCenterName}
          onChange={(event) => onCenterChange(event.target.value)}
          disabled={centerOptions.length <= 1}
        >
          {centerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span className="toolbar-count" aria-live="polite">
        {filteredRowCount === totalRowCount
          ? formatRowCount(totalRowCount)
          : `${formatRowCount(filteredRowCount)} of ${formatRowCount(totalRowCount)}`}
      </span>
      <button type="button" onClick={onRefresh} disabled={disableRefresh}>
        Refresh
      </button>
      <button type="button" onClick={onExportCsv} disabled={!hasData}>
        Export CSV
      </button>
      <button type="button" onClick={onExportXlsx} disabled={!hasData}>
        Export XLSX
      </button>
      <button type="button" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}
