import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchReport, login, logout } from './api/client';
import {
  getApiErrorCode,
  mapLoginError,
  mapReportError,
  type LoginFailureState,
  type ReportFailureState,
} from './api/errors';
import type { ReportRow } from './api/types';
import { LoginPanel } from './components/LoginPanel';
import { ReportScreen } from './components/ReportScreen';
import { exportReportCsv, exportReportXlsx } from './lib/export';

function App() {
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loginError, setLoginError] = useState<LoginFailureState | null>(null);
  const [reportError, setReportError] = useState<ReportFailureState | null>(null);
  const reportRequestIdRef = useRef(0);
  const isAuthenticatedRef = useRef(isAuthenticated);

  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  const createReportLoadToken = () => {
    reportRequestIdRef.current += 1;
    return reportRequestIdRef.current;
  };

  const loadReport = useCallback(async (options?: { isAuthenticatedContext?: boolean; isInitialCheck?: boolean }) => {
    const requestId = createReportLoadToken();
    const knownAuthenticated = options?.isAuthenticatedContext ?? isAuthenticatedRef.current;
    setIsReportLoading(true);
    setReportError(null);
    if (knownAuthenticated) {
      setLoginError(null);
    }

    try {
      const loaded = await fetchReport();
      if (requestId !== reportRequestIdRef.current) {
        return;
      }

      setRows(loaded);
      setIsAuthenticated(true);
      setLoginError(null);
      setReportError(null);
    } catch (error) {
      if (requestId !== reportRequestIdRef.current) {
        return;
      }
      const code = getApiErrorCode(error);
      const failure = mapReportError(code);

      if (failure === 'session_expired') {
        setIsAuthenticated(false);
        setRows([]);
        setLoginError('session_expired');
        return;
      }

      if (knownAuthenticated) {
        setReportError(failure);
      } else {
        setLoginError(
          failure === 'backend_unavailable'
            ? 'backend_unavailable'
            : failure === 'network_error'
              ? 'network_error'
              : 'unknown',
        );
      }
    } finally {
      const isCurrentRequest = requestId === reportRequestIdRef.current;
      if (isCurrentRequest) {
        setIsReportLoading(false);
        if (options?.isInitialCheck) {
          setIsCheckingSession(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    void loadReport({ isInitialCheck: true });
  }, [loadReport]);

  const handleLogin = async (password: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    setReportError(null);
    try {
      await login(password);
      setIsAuthenticated(true);
      await loadReport({ isAuthenticatedContext: true });
    } catch (error) {
      setLoginError(mapLoginError(getApiErrorCode(error)));
      setIsAuthenticated(false);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    createReportLoadToken();
    setIsAuthenticated(false);
    setRows([]);
    setLoginError(null);
    setReportError(null);
    setIsCheckingSession(false);
    setIsReportLoading(false);
    try {
      await logout();
    } catch {
      // ignore transport failures and clear local state to force login
    }
  };

  const handleExportCsv = () => {
    exportReportCsv(rows);
  };

  const handleExportXlsx = () => {
    void exportReportXlsx(rows);
  };

  if (isCheckingSession) {
    return (
      <main className="app-shell">
        <p role="status" aria-live="polite" className="message message--status">
          Checking current session…
        </p>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="app-shell">
        <LoginPanel isLoading={isLoggingIn} error={loginError} onSubmit={handleLogin} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <ReportScreen
        rows={rows}
        isLoading={isReportLoading}
        error={reportError}
        onRefresh={loadReport}
        onExportCsv={handleExportCsv}
        onExportXlsx={handleExportXlsx}
        onLogout={handleLogout}
      />
    </main>
  );
}

export default App;
