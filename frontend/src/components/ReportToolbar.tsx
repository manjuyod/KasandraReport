interface ReportToolbarProps {
  disableRefresh: boolean;
  hasData: boolean;
  onRefresh: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  onLogout: () => void;
}

export function ReportToolbar({
  disableRefresh,
  hasData,
  onRefresh,
  onExportCsv,
  onExportXlsx,
  onLogout,
}: ReportToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Report toolbar">
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
