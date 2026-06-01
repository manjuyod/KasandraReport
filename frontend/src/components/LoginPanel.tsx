import { FormEvent, useState } from 'react';
import type { LoginFailureState } from '../api/errors';

interface LoginPanelProps {
  isLoading: boolean;
  error: LoginFailureState | null;
  onSubmit: (password: string) => Promise<void>;
}

const loginErrorText: Record<Exclude<LoginFailureState, 'session_expired'>, string> = {
  invalid_password: 'The password is invalid.',
  rate_limited: 'Too many attempts. Please wait a moment and retry.',
  backend_unavailable: 'Backend unavailable. Please retry shortly.',
  network_error: 'Unable to reach the backend. Check your network and retry.',
  unknown: 'Something went wrong. Please retry.',
};

const formatLoginError = (error: LoginFailureState | null): string | null => {
  if (!error) {
    return null;
  }

  if (error === 'session_expired') {
    return 'Your session has ended. Please sign in again.';
  }

  return loginErrorText[error];
};

export function LoginPanel({ isLoading, error, onSubmit }: LoginPanelProps) {
  const [password, setPassword] = useState('');
  const [helpText, setHelpText] = useState('');

  const message = formatLoginError(error);
  const onFormSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim() || isLoading) {
      return;
    }

    setHelpText('Signing in...');
    try {
      await onSubmit(password);
    } finally {
      setHelpText('');
      setPassword('');
    }
  };

  return (
    <section className="card login-panel" aria-labelledby="login-title">
      <h1 id="login-title">Student Info Report</h1>
      <p className="login-subtitle">Sign in with your workspace password to view the report.</p>
      <form className="login-form" onSubmit={onFormSubmit}>
        <label htmlFor="password-input" className="input-label">
          Workspace Password
        </label>
        <input
          id="password-input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isLoading}
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={isLoading || !password.trim()}>
          {isLoading ? 'Signing in…' : 'Open report'}
        </button>
      </form>
      {message ? (
        <p role="alert" aria-live="assertive" className="message message--error">
          {message}
        </p>
      ) : null}
      {isLoading && helpText ? (
        <p role="status" aria-live="polite" className="message message--status">
          {helpText}
        </p>
      ) : null}
    </section>
  );
}
