import { ReportTable } from './ReportTable';
import { ReportToolbar } from './ReportToolbar';
import type { ReportFailureState } from '../api/errors';
import type { ReportRow } from '../api/types';
import type { CenterOption } from '../lib/report';

interface ReportScreenProps {
  rows: readonly ReportRow[];
  totalRowCount: number;
  centerOptions: readonly CenterOption[];
  selectedCenterName: string;
  isLoading: boolean;
  error: ReportFailureState | null;
  onCenterChange: (centerName: string) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  onLogout: () => void;
}

const errorMessage: Record<ReportFailureState, string> = {
  session_expired: 'Session expired. Please sign in again.',
  backend_unavailable: 'Backend unavailable right now. Please retry.',
  network_error: 'Unable to reach the server. Check network and retry.',
  unexpected: 'Unexpected error while loading report. Retry.',
};

const formatRowCount = (count: number): string => `${count} ${count === 1 ? 'row' : 'rows'}`;

export function ReportScreen({
  rows,
  totalRowCount,
  centerOptions,
  selectedCenterName,
  isLoading,
  error,
  onCenterChange,
  onRefresh,
  onExportCsv,
  onExportXlsx,
  onLogout,
}: ReportScreenProps) {
  const filteredRowCount = rows.length;
  const hasFilteredRows = filteredRowCount > 0;
  const reportSubtitle =
    filteredRowCount === totalRowCount
      ? `${formatRowCount(totalRowCount)} loaded.`
      : `${formatRowCount(filteredRowCount)} of ${formatRowCount(totalRowCount)} shown.`;

  if (isLoading) {
    return (
      <section className="report-panel">
        <p role="status" aria-live="polite" className="message message--status">
          Loading report…
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="report-panel">
        <ReportToolbar
          disableRefresh={false}
          hasData={false}
          centerOptions={centerOptions}
          selectedCenterName={selectedCenterName}
          totalRowCount={totalRowCount}
          filteredRowCount={filteredRowCount}
          onCenterChange={onCenterChange}
          onRefresh={onRefresh}
          onExportCsv={onExportCsv}
          onExportXlsx={onExportXlsx}
          onLogout={onLogout}
        />
        <p role="alert" aria-live="assertive" className="message message--error">
          {errorMessage[error]}
        </p>
      </section>
    );
  }

  if (!hasFilteredRows) {
    return (
      <section className="report-panel">
        <ReportToolbar
          disableRefresh={false}
          hasData={false}
          centerOptions={centerOptions}
          selectedCenterName={selectedCenterName}
          totalRowCount={totalRowCount}
          filteredRowCount={filteredRowCount}
          onCenterChange={onCenterChange}
          onRefresh={onRefresh}
          onExportCsv={onExportCsv}
          onExportXlsx={onExportXlsx}
          onLogout={onLogout}
        />
        <p role="status" aria-live="polite" className="message message--status">
          {totalRowCount === 0 ? 'No rows returned from report endpoint.' : 'No rows match the selected Center.'}
        </p>
      </section>
    );
  }

  return (
    <section className="report-panel">
      <header className="report-heading">
        <h1 id="report-title">Student Info Report</h1>
        <p className="report-subtitle">{reportSubtitle}</p>
      </header>

      <ReportToolbar
        disableRefresh={false}
        hasData={hasFilteredRows}
        centerOptions={centerOptions}
        selectedCenterName={selectedCenterName}
        totalRowCount={totalRowCount}
        filteredRowCount={filteredRowCount}
        onCenterChange={onCenterChange}
        onRefresh={onRefresh}
        onExportCsv={onExportCsv}
        onExportXlsx={onExportXlsx}
        onLogout={onLogout}
      />

      <ReportTable rows={rows} />
    </section>
  );
}
