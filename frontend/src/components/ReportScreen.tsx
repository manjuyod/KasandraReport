import { ReportTable } from './ReportTable';
import { ReportToolbar } from './ReportToolbar';
import type { ReportFailureState } from '../api/errors';
import type { ReportRow } from '../api/types';

interface ReportScreenProps {
  rows: ReportRow[];
  isLoading: boolean;
  error: ReportFailureState | null;
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

export function ReportScreen({
  rows,
  isLoading,
  error,
  onRefresh,
  onExportCsv,
  onExportXlsx,
  onLogout,
}: ReportScreenProps) {
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

  if (rows.length === 0) {
    return (
      <section className="report-panel">
        <ReportToolbar
          disableRefresh={false}
          hasData={false}
          onRefresh={onRefresh}
          onExportCsv={onExportCsv}
          onExportXlsx={onExportXlsx}
          onLogout={onLogout}
        />
        <p role="status" aria-live="polite" className="message message--status">
          No rows returned from report endpoint.
        </p>
      </section>
    );
  }

  return (
    <section className="report-panel">
      <header className="report-heading">
        <h1 id="report-title">Kassandra Report</h1>
        <p className="report-subtitle">Signed in and loaded successfully.</p>
      </header>

      <ReportToolbar
        disableRefresh={false}
        hasData={rows.length > 0}
        onRefresh={onRefresh}
        onExportCsv={onExportCsv}
        onExportXlsx={onExportXlsx}
        onLogout={onLogout}
      />

      <ReportTable rows={rows} />
    </section>
  );
}
