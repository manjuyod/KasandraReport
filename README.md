# Kassandra Report

Kassandra Report is a single-binary Rust API with a React/Vite frontend.
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

The SQL query used by `/api/report` is read-only by design. It intentionally preserves this filter:

`ISNULL(i.IsDeleted, 0) <> 0`

Use a read-only database account for runtime and keep destructive SQL out of deployment.

## Report SQL

```sql
;WITH CenterIds AS (
    SELECT CenterID
    FROM (VALUES
        (6), (8), (11), (13), (15), (16), (19), (20), (22),
        (24), (49), (56), (57), (60), (87), (103), (110)
    ) AS v(CenterID)
),
ActiveStudentFamilies AS (
    SELECT DISTINCT
        s.InquiryId
    FROM dbo.tblStudents AS s
    INNER JOIN dbo.tblInquiry AS i
        ON i.ID = s.InquiryId
    INNER JOIN CenterIds AS c
        ON c.CenterID = i.FranchiesId
    WHERE s.IsDeleted = 0
      AND s.IsTrail = 'Active'
      AND ISNULL(i.IsDeleted, 0) <> 0
)
SELECT
    r.FranchiesName AS CenterName,
    i.ID AS AccountNumber,
    [Student Name] = LTRIM(RTRIM(STUFF((
        SELECT ', ' + LTRIM(RTRIM(CONCAT(
            s2.FirstName,
            CASE
                WHEN ISNULL(s2.LastName, '') <> '' THEN ' ' + s2.LastName
                ELSE ''
            END
        )))
        FROM dbo.tblStudents AS s2
        WHERE s2.InquiryId = i.ID
          AND s2.IsDeleted = 0
          AND s2.IsTrail = 'Active'
        ORDER BY s2.LastName, s2.FirstName, s2.ID
        FOR XML PATH(''), TYPE
    ).value('.', 'nvarchar(max)'), 1, 2, ''))),
    [Parent Name] = LTRIM(RTRIM(
        CASE
            WHEN NULLIF(LTRIM(RTRIM(CONCAT(ISNULL(i.CFirstName, ''), ' ', ISNULL(i.CLastName, '')))), '') IS NOT NULL
                THEN CONCAT(ISNULL(i.CFirstName, ''), ' ', ISNULL(i.CLastName, ''))
            ELSE ISNULL(i.ContactName, '')
        END
    )),
    [Phone Number] = i.ContactPhone,
    [Email] = i.Email
FROM ActiveStudentFamilies AS f
INNER JOIN dbo.tblInquiry AS i
    ON i.ID = f.InquiryId
INNER JOIN dbo.tblFranchies AS r
    ON r.ID = i.FranchiesId
ORDER BY
    i.FranchiesId,
    [Parent Name],
    i.ID;
```

## Export behavior

- **CSV** (`kassandra-report.csv`)
  - UTF-8 BOM prepended.
  - Every field is CSV-escaped.
  - Cells that look like formulas are prefixed with `'` to reduce spreadsheet formula injection risk.
- **XLSX** (`kassandra-report.xlsx`)
  - Values are sanitized the same way before writing.
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
