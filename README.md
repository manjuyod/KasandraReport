# Student Info Report

Student Info Report is a single-binary Rust API with a React/Vite frontend.
The backend exposes authenticated API routes and can serve the compiled frontend for single-page-app (SPA) usage when `frontend/dist` is present.

## Project overview

- Backend: Rust 2021 + Axum.
- Database access: `tiberius` over SQL Server (`rustls`, no ODBC driver dependency at runtime).
- Frontend: React + TypeScript + Vite.
- Auth: simple cookie-based login using a secret (`REPORT_SECRET`).
- Session storage: in-memory on the backend process.

## Stack

- **Backend**
  - Axum web framework
  - Tiberius SQL client (using `Config` + `Client::connect`)
  - Tracing + tracing-subscriber for logs
- **Frontend**
  - React 18 + TypeScript
  - Vite build/dev tooling
  - ESLint / TypeScript checks / Vitest
- **Export**
  - CSV and XLSX export from report data

## Why Tiberius (no ODBC)

This project intentionally uses `tiberius` and does not require ODBC native packages. The previous ODBC note is preserved for history, but the current implementation is pure Rust and does not need `unixODBC` in Replit.

## Environment variables

### Required

- `CRMSrvAddress` — SQL Server host, host:port, or host\instance.
- `CRMSrvDb` — database name.
- `CRMSrvUs` — SQL username.
- `CRMSrvPs` — SQL password.
- `REPORT_SECRET` — shared secret for login cookies.

### Optional

- `SQLSERVER_TRUST_CERT` — enable certificate trust for SQL connection (`true`/`false`, default `false`).
- `COOKIE_SECURE` — set `Secure` flag on session cookie (`true`/`false`, default `true`).
- `PORT` — server port, default `8080`. Backend binds `0.0.0.0`.

## Replit setup

Backend is configured to:

- listen on `0.0.0.0`.
- use `PORT` when provided.

Create a minimal Replit workflow around:

1. Install frontend dependencies.
2. Build frontend (`frontend/dist`).
3. Run backend from the repo root with Rust.

### `.replit`

Use root `.replit` with a command that installs/builds the frontend and runs the backend (no ODBC packages).

### `replit.nix`

Keep toolchain minimal:

- `rustc`
- `cargo`
- `nodejs_20`
- `npm`

No `unixODBC` or other ODBC runtime packages are needed.

## Local development commands

### Frontend (from root)

- `npm --prefix frontend install`
- `npm --prefix frontend run dev`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run test`
- `npm --prefix frontend run build`

### Backend (from root)

- `cargo run --manifest-path backend/Cargo.toml`
- `cargo test --manifest-path backend/Cargo.toml`

If the backend is not listening on `8080`, set `BACKEND_PORT` or `BACKEND_URL` before starting the frontend dev server. The Vite `/api` proxy uses `BACKEND_URL`, then `BACKEND_PORT`, then `PORT`, and finally defaults to `8080`.

## Build / run commands

### Build

- Frontend: `npm --prefix frontend install && npm --prefix frontend run build`
- Backend: `cargo build --manifest-path backend/Cargo.toml`

### Run

- `cargo run --manifest-path backend/Cargo.toml`

If environment provides `PORT`, backend will bind that port; otherwise it binds `8080`.

## Test commands

### Backend

- `cargo fmt --check --manifest-path backend/Cargo.toml`
- `cargo test --manifest-path backend/Cargo.toml`
- `cargo clippy --all-targets --all-features --manifest-path backend/Cargo.toml -- -D warnings`

### Frontend

- `npm --prefix frontend run lint`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run build`
- `npm --prefix frontend run test`
- `npm --prefix frontend audit --json`

## API behavior

- `GET /healthz` — health check.
- `/api/login`, `/api/logout`, `/api/report` — protected routes.
- Unknown `/api/*` paths return JSON 404 (`{"error":"not_found"}`).
- Non-API unknown routes:
  - serve `frontend/dist/index.html` when the built frontend exists.
  - return clear `404` when `frontend/dist` is not present.

## Read-only SQL/account requirement

The `/api/report` query is read-only by design. Keep the exact SQL in source control out of public-facing documentation, use a read-only database account for runtime, and keep destructive SQL out of deployment.

## Export behavior

- **CSV** (`Student Info Run YYYY-MM-DD.csv`)
  - UTF-8 BOM prepended.
  - Every field is CSV-escaped.
  - Cells that look like formulas are prefixed with `'` to reduce spreadsheet formula injection risk.
- **XLSX** (`Student Info Run YYYY-MM-DD.xlsx`)
  - Values are sanitized the same way before writing.
  - Column filters are enabled on the report sheet.
  - Uses `write-excel-file` browser export with a single `Report` sheet.

## Troubleshooting

- `Frontend assets were not found ...`:
  Build the frontend first (`npm --prefix frontend run build`), then restart backend.
- `403` / cookie errors in non-HTTPS environments:
  Set `COOKIE_SECURE=false` if you need local HTTP testing.
- SQL SSL certificate issues:
  Set `SQLSERVER_TRUST_CERT=true` when using self-signed/non-public cert chains.
- Port binding failures:
  Ensure `PORT` is free/valid; otherwise the server defaults to `8080`.
