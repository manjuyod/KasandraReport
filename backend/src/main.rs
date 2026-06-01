use axum::{
    extract::{ConnectInfo, State},
    http::{
        header::{HeaderMap, HeaderValue, CACHE_CONTROL, COOKIE, SET_COOKIE},
        StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures::TryStreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    env,
    net::SocketAddr,
    path::Component,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use subtle::ConstantTimeEq;
use thiserror::Error;
use tiberius::{AuthMethod, Client, Config, Row};
use tokio::{fs, net::TcpListener, net::TcpStream, signal, sync::RwLock, time::timeout};
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

const SESSION_COOKIE_NAME: &str = "kassandra_report_session";
const SESSION_TTL_SECONDS: u64 = 900;
const LOGIN_FAILURE_WINDOW_SECONDS: u64 = 300;
const LOGIN_FAILURE_MAX: usize = 5;
const DB_OPERATION_TIMEOUT_SECONDS: u64 = 10;
const DEFAULT_LISTEN_PORT: u16 = 8080;

const STATIC_REPORT_SQL: &str = ";WITH CenterIds AS (
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
\tON r.ID = i.FranchiesId
ORDER BY
    i.FranchiesId,
    [Parent Name],
    i.ID;";

#[tokio::main]
async fn main() {
    fmt::Subscriber::builder()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let state = match AppState::from_env() {
        Ok(state) => Arc::new(state),
        Err(err) => {
            match &err {
                AppError::MissingConfig(key) => {
                    error!("backend failed to start: missing required env var: {}", key)
                }
                AppError::InvalidConfig(key) => {
                    error!(
                        "backend failed to start: invalid value for env var: {}",
                        key
                    )
                }
                _ => {
                    error!("backend failed to start: {}", err);
                }
            }
            std::process::exit(1);
        }
    };

    let api_router = Router::new()
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/report", get(report))
        .route("/", any(api_not_found))
        .route("/*path", any(api_not_found));

    let app = Router::new()
        .route("/healthz", get(healthz))
        .nest("/api", api_router)
        .fallback(frontend_fallback)
        .with_state(state)
        .layer(TraceLayer::new_for_http());

    let listen_port = resolve_bind_port();
    let listener = TcpListener::bind((std::net::Ipv4Addr::new(0, 0, 0, 0), listen_port))
        .await
        .expect("failed to bind listener");

    let local_addr = listener
        .local_addr()
        .map_err(|e| {
            error!("failed to read local address: {}", e);
            e
        })
        .ok();
    if let Some(addr) = local_addr {
        info!("listening on {}", addr);
    }

    let result = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await;

    if let Err(e) = result {
        error!("server error: {}", e);
    }
}

async fn shutdown_signal() {
    let _ = signal::ctrl_c().await;
}

fn resolve_bind_port() -> u16 {
    let raw_port = env::var("PORT").ok();
    if let Some(raw_port) = raw_port.as_deref() {
        if raw_port.parse::<u16>().is_err() {
            warn!(
                "Invalid PORT value '{}'; falling back to {}",
                raw_port, DEFAULT_LISTEN_PORT
            );
        }
    }

    parse_bind_port(raw_port.as_deref())
}

fn parse_bind_port(raw_port: Option<&str>) -> u16 {
    raw_port
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_LISTEN_PORT)
}

fn frontend_dist_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        candidates.push(Path::new(&manifest_dir).join("../frontend/dist"));
    }

    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("frontend/dist"));
        candidates.push(current_dir.join("../frontend/dist"));
    }

    candidates
        .into_iter()
        .find(|path| path.join("index.html").is_file())
}

async fn api_not_found() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorResponse { error: "not_found" }),
    )
}

async fn frontend_fallback(State(state): State<Arc<AppState>>, uri: axum::http::Uri) -> Response {
    let Some(frontend_dist) = state.frontend_dist.as_deref() else {
        return (
            StatusCode::NOT_FOUND,
            "Frontend assets were not found at ../frontend/dist. Build the frontend and retry.",
        )
            .into_response();
    };

    let requested = match frontend_relative_path(uri.path()) {
        Some(path) => path,
        None => {
            return (StatusCode::BAD_REQUEST, "Invalid frontend path").into_response();
        }
    };

    let requested_path = frontend_dist.join(requested);
    let index_path = frontend_dist.join("index.html");

    let requested_is_file = match fs::metadata(&requested_path).await {
        Ok(metadata) => metadata.is_file(),
        Err(_) => false,
    };
    let target_path = if requested_is_file {
        requested_path
    } else {
        index_path
    };

    let body = match fs::read(&target_path).await {
        Ok(body) => body,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                "Frontend assets were not found at ../frontend/dist. Build the frontend and retry.",
            )
                .into_response();
        }
    };

    let content_type = content_type_for(&target_path);
    let headers = [(axum::http::header::CONTENT_TYPE, content_type)];
    (StatusCode::OK, headers, body).into_response()
}

fn frontend_relative_path(uri_path: &str) -> Option<PathBuf> {
    let path = uri_path.trim_start_matches('/');
    if path.is_empty() {
        return Some(PathBuf::from("index.html"));
    }

    let mut sanitized = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(segment) => sanitized.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    if sanitized.as_os_str().is_empty() {
        Some(PathBuf::from("index.html"))
    } else {
        Some(sanitized)
    }
}

fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "application/javascript",
        Some("mjs") => "application/javascript",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("txt") => "text/plain; charset=utf-8",
        Some("map") => "application/json",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("webmanifest") => "application/manifest+json",
        Some("xml") => "application/xml",
        Some("pdf") => "application/pdf",
        Some("zip") => "application/zip",
        _ => "application/octet-stream",
    }
}

#[derive(Clone)]
struct AppState {
    db: DbConfig,
    report_secret: String,
    sessions: Arc<RwLock<HashMap<String, Instant>>>,
    failed_logins: Arc<RwLock<HashMap<String, VecDeque<Instant>>>>,
    cookie_secure: bool,
    frontend_dist: Option<PathBuf>,
}

impl AppState {
    fn from_env() -> Result<Self, AppError> {
        let db = DbConfig::from_env()?;
        let cookie_secure = db.cookie_secure;
        Ok(Self {
            report_secret: db.report_secret.clone(),
            db,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            failed_logins: Arc::new(RwLock::new(HashMap::new())),
            cookie_secure,
            frontend_dist: frontend_dist_dir(),
        })
    }
}

#[derive(Clone)]
struct DbConfig {
    address: CrmAddress,
    db: String,
    username: String,
    password: String,
    report_secret: String,
    trust_cert: bool,
    cookie_secure: bool,
}

impl DbConfig {
    fn from_env() -> Result<Self, AppError> {
        let get = |key: &str| env::var(key).ok();
        Self::from_map(&get)
    }

    fn from_map(get: &impl Fn(&str) -> Option<String>) -> Result<Self, AppError> {
        let address_raw = required_env_non_empty(get, "CRMSrvAddress")?;
        let address = parse_crm_address(&address_raw)?;
        let db = required_env_non_empty(get, "CRMSrvDb")?;
        let username = required_env_non_empty(get, "CRMSrvUs")?;
        let password = required_env_non_empty(get, "CRMSrvPs")?;
        let report_secret = required_env_non_empty(get, "REPORT_SECRET")?;
        let trust_cert = parse_trust_cert(get("SQLSERVER_TRUST_CERT").as_deref())?;
        let cookie_secure = parse_cookie_secure(get("COOKIE_SECURE").as_deref())?;

        Ok(Self {
            address,
            db,
            username,
            password,
            report_secret,
            trust_cert,
            cookie_secure,
        })
    }

    fn to_tiberius_config(&self) -> Result<Config, AppError> {
        let mut config = Config::new();

        match &self.address {
            CrmAddress::Host(host) => {
                config.host(host);
            }
            CrmAddress::HostPort { host, port } => {
                config.host(host);
                config.port(*port);
            }
            CrmAddress::HostInstance { host, instance } => {
                config.host(host);
                config.instance_name(instance);
            }
        }

        config.database(&self.db);
        config.authentication(AuthMethod::sql_server(&self.username, &self.password));

        if self.trust_cert {
            config.trust_cert();
        }

        Ok(config)
    }
}

#[derive(Clone)]
enum CrmAddress {
    Host(String),
    HostPort { host: String, port: u16 },
    HostInstance { host: String, instance: String },
}

fn parse_crm_address(raw: &str) -> Result<CrmAddress, AppError> {
    let value = raw.trim();
    if value.is_empty() {
        return Err(AppError::InvalidConfig("CRMSrvAddress"));
    }

    let backslashes: Vec<&str> = value.split('\\').collect();
    if backslashes.len() > 1 {
        if backslashes.len() != 2 {
            return Err(AppError::InvalidConfig("CRMSrvAddress"));
        }

        let host = backslashes[0];
        let instance = backslashes[1];
        if host.is_empty() || instance.is_empty() {
            return Err(AppError::InvalidConfig("CRMSrvAddress"));
        }

        return Ok(CrmAddress::HostInstance {
            host: host.to_string(),
            instance: instance.to_string(),
        });
    }

    if value.contains(':') {
        let mut split = value.splitn(2, ':');
        let host = split
            .next()
            .filter(|host| !host.is_empty())
            .ok_or(AppError::InvalidConfig("CRMSrvAddress"))?;
        let port_str = split
            .next()
            .filter(|port| !port.is_empty())
            .ok_or(AppError::InvalidConfig("CRMSrvAddress"))?;
        if split.next().is_some() {
            return Err(AppError::InvalidConfig("CRMSrvAddress"));
        }
        let port = port_str
            .parse::<u16>()
            .map_err(|_| AppError::InvalidConfig("CRMSrvAddress"))?;

        return Ok(CrmAddress::HostPort {
            host: host.to_string(),
            port,
        });
    }

    Ok(CrmAddress::Host(value.to_string()))
}

fn required_env_non_empty(
    get: &impl Fn(&str) -> Option<String>,
    key: &'static str,
) -> Result<String, AppError> {
    let value = get(key).ok_or(AppError::MissingConfig(key))?;
    if value.trim().is_empty() {
        Err(AppError::InvalidConfig(key))
    } else {
        Ok(value)
    }
}

fn parse_bool_env(raw: Option<&str>, key: &'static str, default: bool) -> Result<bool, AppError> {
    match raw {
        None => Ok(default),
        Some(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(AppError::InvalidConfig(key)),
        },
    }
}

fn parse_trust_cert(raw: Option<&str>) -> Result<bool, AppError> {
    parse_bool_env(raw, "SQLSERVER_TRUST_CERT", false)
}

fn parse_cookie_secure(raw: Option<&str>) -> Result<bool, AppError> {
    parse_bool_env(raw, "COOKIE_SECURE", true)
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
}

#[derive(Serialize, Deserialize)]
struct LoginRequest {
    password: String,
}

#[derive(Serialize)]
struct ReportRow {
    #[serde(rename = "centerName")]
    center_name: String,
    #[serde(rename = "accountNumber")]
    account_number: i64,
    #[serde(rename = "studentName")]
    student_name: String,
    #[serde(rename = "parentName")]
    parent_name: String,
    #[serde(rename = "phoneNumber")]
    phone_number: String,
    #[serde(rename = "email")]
    email: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: &'static str,
}

#[derive(Error, Debug, PartialEq, Eq)]
enum AppError {
    #[error("unauthorized")]
    Unauthorized,
    #[error("missing config: {0}")]
    MissingConfig(&'static str),
    #[error("invalid config: {0}")]
    InvalidConfig(&'static str),
    #[error("service unavailable")]
    Unavailable,
    #[error("internal error")]
    Internal,
    #[error("session expired")]
    SessionExpired,
    #[error("too many login attempts")]
    TooManyRequests,
    #[error("database timeout")]
    DbTimeout,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::MissingConfig(_) | Self::InvalidConfig(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
            }
            Self::Unavailable => (StatusCode::SERVICE_UNAVAILABLE, "service_unavailable"),
            Self::SessionExpired => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "too_many_requests"),
            Self::DbTimeout => (StatusCode::GATEWAY_TIMEOUT, "gateway_timeout"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        (status, Json(ErrorResponse { error: code })).into_response()
    }
}

async fn healthz() -> Json<Health> {
    Json(Health { status: "ok" })
}

async fn login(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, AppError> {
    let client_key = client_addr.ip().to_string();
    let now = Instant::now();

    {
        let mut failed_logins = state.failed_logins.write().await;
        cleanup_failed_logins(&mut failed_logins, now);

        if is_login_rate_limited(&failed_logins, &client_key) {
            return Err(AppError::TooManyRequests);
        }

        if !constant_time_secret_eq(&state.report_secret, &payload.password) {
            record_login_failure(&mut failed_logins, &client_key, now);
            return Err(AppError::Unauthorized);
        }

        failed_logins.remove(&client_key);
    }

    let token = create_session_token(&state.report_secret);
    let expires_at = now + Duration::from_secs(SESSION_TTL_SECONDS);
    {
        let mut sessions = state.sessions.write().await;
        cleanup_sessions(&mut sessions, now);
        sessions.insert(token.clone(), expires_at);
    }

    let mut response = (StatusCode::OK, Json(serde_json::json!({"ok": true}))).into_response();
    let cookie = issue_cookie(&token, Some(SESSION_TTL_SECONDS), state.cookie_secure);
    response.headers_mut().insert(
        SET_COOKIE,
        HeaderValue::from_str(&cookie).map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> impl IntoResponse {
    if let Some(token) = extract_session_cookie(&headers) {
        let mut sessions = state.sessions.write().await;
        sessions.remove(&token);
    }

    let mut response = (StatusCode::OK, Json(serde_json::json!({"ok": true}))).into_response();
    response.headers_mut().insert(
        SET_COOKIE,
        HeaderValue::from_str(&clear_cookie(state.cookie_secure)).unwrap(),
    );
    response
}

async fn report(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    ensure_authed(&state, &headers).await?;

    let rows = query_report(&state.db).await?;

    let mut response = Json(rows).into_response();
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

fn constant_time_secret_eq(expected: &str, candidate: &str) -> bool {
    let expected_hash = sha256_bytes(expected);
    let candidate_hash = sha256_bytes(candidate);
    expected_hash.ct_eq(&candidate_hash).into()
}

fn is_login_rate_limited(
    failed_logins: &HashMap<String, VecDeque<Instant>>,
    client_key: &str,
) -> bool {
    failed_logins
        .get(client_key)
        .is_some_and(|attempts| attempts.len() >= LOGIN_FAILURE_MAX)
}

fn record_login_failure(
    failed_logins: &mut HashMap<String, VecDeque<Instant>>,
    client_key: &str,
    now: Instant,
) {
    let bucket = failed_logins.entry(client_key.to_string()).or_default();
    bucket.push_back(now);

    while bucket.len() > LOGIN_FAILURE_MAX {
        bucket.pop_front();
    }
}

fn cleanup_failed_logins(failed_logins: &mut HashMap<String, VecDeque<Instant>>, now: Instant) {
    let mut empty = Vec::new();
    let window = Duration::from_secs(LOGIN_FAILURE_WINDOW_SECONDS);

    for (client_key, attempts) in failed_logins.iter_mut() {
        while let Some(expired) = attempts.front() {
            match now.checked_duration_since(*expired) {
                Some(age) if age > window => {
                    attempts.pop_front();
                }
                _ => break,
            }
        }

        if attempts.is_empty() {
            empty.push(client_key.clone());
        }
    }

    for key in empty {
        failed_logins.remove(&key);
    }
}

fn cleanup_sessions(sessions: &mut HashMap<String, Instant>, now: Instant) {
    sessions.retain(|_, expires_at| *expires_at > now);
}

fn create_session_token(secret: &str) -> String {
    let mut nonce = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut nonce);
    let payload = hex::encode(nonce);
    let sig = sign_payload(&payload, secret);
    format!("{}.{}", payload, sig)
}

fn sign_payload(payload: &str, secret: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(payload.as_bytes());
    hasher.update(secret.as_bytes());
    hex::encode(hasher.finalize())
}

fn token_is_valid(cookie: &str, secret: &str) -> bool {
    let mut parts = cookie.splitn(2, '.');
    let payload = match parts.next() {
        Some(v) => v,
        None => return false,
    };
    let sig = match parts.next() {
        Some(v) => v,
        None => return false,
    };

    if payload.is_empty() || sig.is_empty() {
        return false;
    }

    constant_time_secret_eq(&sign_payload(payload, secret), sig)
}

fn issue_cookie(token: &str, max_age_seconds: Option<u64>, secure: bool) -> String {
    let mut cookie = format!(
        "{}={}; HttpOnly; SameSite=Strict; Path=/",
        SESSION_COOKIE_NAME, token
    );

    if secure {
        cookie.push_str("; Secure");
    }

    if let Some(ttl) = max_age_seconds {
        cookie.push_str(&format!("; Max-Age={}", ttl));
    }

    cookie
}

fn clear_cookie(secure: bool) -> String {
    let mut cookie = format!(
        "{}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        SESSION_COOKIE_NAME
    );

    if secure {
        cookie.push_str("; Secure");
    }

    cookie
}

fn extract_session_cookie(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(COOKIE)?.to_str().ok()?;
    for pair in raw.split(';') {
        let mut kv = pair.trim().splitn(2, '=');
        let key = kv.next()?;
        let value = kv.next().unwrap_or_default();
        if key == SESSION_COOKIE_NAME {
            return Some(value.to_string());
        }
    }
    None
}

async fn ensure_authed(state: &Arc<AppState>, headers: &HeaderMap) -> Result<(), AppError> {
    let token = extract_session_cookie(headers).ok_or(AppError::Unauthorized)?;

    if !token_is_valid(&token, &state.report_secret) {
        return Err(AppError::Unauthorized);
    }

    let now = Instant::now();
    let mut sessions = state.sessions.write().await;

    let Some(expires_at) = sessions.get(&token).copied() else {
        return Err(AppError::Unauthorized);
    };

    if now > expires_at {
        sessions.remove(&token);
        return Err(AppError::SessionExpired);
    }

    cleanup_sessions(&mut sessions, now);
    Ok(())
}

async fn query_report(cfg: &DbConfig) -> Result<Vec<ReportRow>, AppError> {
    let config = cfg.to_tiberius_config()?;
    let timeout_dur = Duration::from_secs(DB_OPERATION_TIMEOUT_SECONDS);

    let tcp = timeout(timeout_dur, TcpStream::connect(config.get_addr()))
        .await
        .map_err(|_| AppError::DbTimeout)?
        .map_err(|_| AppError::Unavailable)?;
    tcp.set_nodelay(true).map_err(|_| AppError::Unavailable)?;

    let mut client = timeout(timeout_dur, Client::connect(config, tcp.compat_write()))
        .await
        .map_err(|_| AppError::DbTimeout)?
        .map_err(|_| AppError::Unavailable)?;

    let mut rows_stream = timeout(timeout_dur, async {
        client.query(STATIC_REPORT_SQL, &[]).await
    })
    .await
    .map_err(|_| AppError::DbTimeout)?
    .map_err(|_| AppError::Unavailable)?
    .into_row_stream();

    let mut rows = Vec::new();
    while let Some(row) = timeout(timeout_dur, rows_stream.try_next())
        .await
        .map_err(|_| AppError::DbTimeout)?
        .map_err(|_| AppError::Unavailable)?
    {
        rows.push(map_row(row).map_err(|_| AppError::Internal)?);
    }

    Ok(rows)
}

fn sha256_bytes(value: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hasher.finalize().into()
}

fn map_row(row: Row) -> Result<ReportRow, AppError> {
    let center_name = row
        .try_get::<&str, _>("CenterName")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default()
        .to_string();
    let account_number = row
        .try_get::<i32, _>("AccountNumber")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default() as i64;
    let student_name = row
        .try_get::<&str, _>("Student Name")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default()
        .to_string();
    let parent_name = row
        .try_get::<&str, _>("Parent Name")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default()
        .to_string();
    let phone_number = row
        .try_get::<&str, _>("Phone Number")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default()
        .to_string();
    let email = row
        .try_get::<&str, _>("Email")
        .map_err(|_| AppError::Internal)?
        .unwrap_or_default()
        .to_string();

    Ok(ReportRow {
        center_name,
        account_number,
        student_name,
        parent_name,
        phone_number,
        email,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_db_config(address: CrmAddress) -> DbConfig {
        DbConfig {
            address,
            db: "db".to_string(),
            username: "user".to_string(),
            password: "pass".to_string(),
            report_secret: "secret".to_string(),
            trust_cert: false,
            cookie_secure: true,
        }
    }

    #[test]
    fn parse_host_only() {
        let parsed = parse_crm_address("sql.example.com").unwrap();
        assert!(matches!(parsed, CrmAddress::Host(host) if host == "sql.example.com"));
    }

    #[test]
    fn parse_host_port() {
        let parsed = parse_crm_address("sql.example.com:1433").unwrap();
        assert!(matches!(
            parsed,
            CrmAddress::HostPort { host, port } if host == "sql.example.com" && port == 1433
        ));
    }

    #[test]
    fn parse_host_instance() {
        let parsed = parse_crm_address("sql\\instance01").unwrap();
        assert!(matches!(
            parsed,
            CrmAddress::HostInstance { host, instance } if host == "sql" && instance == "instance01"
        ));
    }

    #[test]
    fn parse_rejects_invalid_addresses() {
        assert!(parse_crm_address("").is_err());
        assert!(parse_crm_address("host:").is_err());
        assert!(parse_crm_address(":1433").is_err());
        assert!(parse_crm_address("host\\").is_err());
        assert!(parse_crm_address("host\\instance\\extra").is_err());
    }

    #[test]
    fn parse_trust_cert_default_false() {
        assert!(!parse_trust_cert(None).unwrap());
    }

    #[test]
    fn parse_trust_cert_parsing() {
        assert!(parse_trust_cert(Some("true")).unwrap());
        assert!(!parse_trust_cert(Some("false")).unwrap());
        assert!(parse_trust_cert(Some("TRUE")).unwrap());
        assert!(!parse_trust_cert(Some("FALSE")).unwrap());
        assert!(parse_trust_cert(Some("true")).unwrap());
    }

    #[test]
    fn parse_cookie_secure_default_true() {
        assert!(parse_cookie_secure(None).unwrap());
        assert!(!parse_cookie_secure(Some("false")).unwrap());
        assert!(parse_cookie_secure(Some("true")).unwrap());
    }

    #[test]
    fn parse_bind_port_defaults_to_8080() {
        assert_eq!(parse_bind_port(None), 8080);
    }

    #[test]
    fn parse_bind_port_accepts_valid_numbers() {
        assert_eq!(parse_bind_port(Some("3000")), 3000);
        assert_eq!(parse_bind_port(Some("  9000  ")), 9000);
    }

    #[test]
    fn parse_bind_port_invalid_values_default_to_8080() {
        assert_eq!(parse_bind_port(Some("not-a-port")), 8080);
        assert_eq!(parse_bind_port(Some("-1")), 8080);
        assert_eq!(parse_bind_port(Some("65536")), 8080);
    }

    #[test]
    fn tiberius_config_uses_typed_server_forms() {
        let host = make_db_config(CrmAddress::Host("sql.host.local".to_string()));
        let host_port = make_db_config(CrmAddress::HostPort {
            host: "sql.host.local".to_string(),
            port: 1433,
        });
        let host_instance = make_db_config(CrmAddress::HostInstance {
            host: "sql.host.local".to_string(),
            instance: "MSSQLSERVER".to_string(),
        });

        assert_eq!(
            host.to_tiberius_config().unwrap().get_addr(),
            "sql.host.local:1433"
        );
        assert_eq!(
            host_port.to_tiberius_config().unwrap().get_addr(),
            "sql.host.local:1433"
        );
        assert_eq!(
            host_instance.to_tiberius_config().unwrap().get_addr(),
            "sql.host.local:1434"
        );
    }

    #[test]
    fn startup_config_missing_report_secret_is_error() {
        let env = |key: &str| match key {
            "CRMSrvAddress" => Some("sql.host.local".to_string()),
            "CRMSrvDb" => Some("db".to_string()),
            "CRMSrvUs" => Some("user".to_string()),
            "CRMSrvPs" => Some("pass".to_string()),
            _ => None,
        };

        assert!(matches!(
            DbConfig::from_map(&env),
            Err(AppError::MissingConfig("REPORT_SECRET"))
        ));
    }

    #[test]
    fn startup_config_empty_report_secret_is_error() {
        let env = |key: &str| match key {
            "CRMSrvAddress" => Some("sql.host.local".to_string()),
            "CRMSrvDb" => Some("db".to_string()),
            "CRMSrvUs" => Some("user".to_string()),
            "CRMSrvPs" => Some("pass".to_string()),
            "REPORT_SECRET" => Some("".to_string()),
            _ => None,
        };

        assert!(matches!(
            DbConfig::from_map(&env),
            Err(AppError::InvalidConfig("REPORT_SECRET"))
        ));
    }

    #[test]
    fn session_token_roundtrip_and_validation() {
        let secret = "report_secret";
        let token = create_session_token(secret);
        assert!(token_is_valid(&token, secret));
        assert!(!token_is_valid(&token, "other_secret"));
    }

    #[test]
    fn sql_keeps_deleted_filter_and_is_read_only_shape() {
        assert!(STATIC_REPORT_SQL.contains("ISNULL(i.IsDeleted, 0) <> 0"));
        assert!(STATIC_REPORT_SQL.contains(";WITH CenterIds AS ("));
        assert!(!STATIC_REPORT_SQL
            .to_ascii_lowercase()
            .contains("drop table"));
        assert!(!STATIC_REPORT_SQL
            .to_ascii_lowercase()
            .contains("insert into"));
        assert!(!STATIC_REPORT_SQL
            .to_ascii_lowercase()
            .contains("delete from"));
        assert!(!STATIC_REPORT_SQL.to_ascii_lowercase().contains("update "));
    }

    #[test]
    fn ensure_cookie_attributes() {
        let token = create_session_token("abc");
        let secure_cookie = issue_cookie(&token, Some(100), true);
        let insecure_cookie = issue_cookie(&token, Some(100), false);

        assert!(secure_cookie.contains("HttpOnly"));
        assert!(secure_cookie.contains("SameSite=Strict"));
        assert!(secure_cookie.contains("Max-Age=100"));
        assert!(secure_cookie.contains("Secure"));
        assert!(!insecure_cookie.contains("Secure"));

        let secure_clear = clear_cookie(true);
        let insecure_clear = clear_cookie(false);
        assert!(secure_clear.contains("Secure"));
        assert!(!insecure_clear.contains("Secure"));
    }

    #[test]
    fn login_attempts_are_throttled_and_cleanup() {
        let mut failed_logins = HashMap::new();
        let client_key = "127.0.0.1";
        let now = Instant::now();

        for _ in 0..(LOGIN_FAILURE_MAX - 1) {
            assert!(!is_login_rate_limited(&failed_logins, client_key));
            record_login_failure(&mut failed_logins, client_key, now);
        }

        assert!(!is_login_rate_limited(&failed_logins, client_key));
        record_login_failure(&mut failed_logins, client_key, now);
        assert!(is_login_rate_limited(&failed_logins, client_key));

        cleanup_failed_logins(
            &mut failed_logins,
            now + Duration::from_secs(LOGIN_FAILURE_WINDOW_SECONDS + 1),
        );

        assert!(!is_login_rate_limited(&failed_logins, client_key));
    }

    #[tokio::test]
    async fn session_lookup_requires_valid_server_entry() {
        let state = Arc::new(AppState {
            db: DbConfig {
                address: CrmAddress::Host("localhost".to_string()),
                db: "db".to_string(),
                username: "u".to_string(),
                password: "p".to_string(),
                report_secret: "x".to_string(),
                trust_cert: false,
                cookie_secure: true,
            },
            report_secret: "x".to_string(),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            failed_logins: Arc::new(RwLock::new(HashMap::new())),
            cookie_secure: true,
            frontend_dist: None,
        });

        let headers = HeaderMap::new();
        assert!(matches!(
            ensure_authed(&state, &headers).await,
            Err(AppError::Unauthorized)
        ));

        let expired_token = create_session_token(&state.report_secret);
        {
            let mut sessions = state.sessions.write().await;
            sessions.insert(
                expired_token.clone(),
                Instant::now() - Duration::from_secs(1),
            );
        }

        let mut headers = HeaderMap::new();
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&format!("{}={}", SESSION_COOKIE_NAME, expired_token)).unwrap(),
        );

        assert!(matches!(
            ensure_authed(&state, &headers).await,
            Err(AppError::SessionExpired)
        ));

        assert_eq!(state.sessions.read().await.len(), 0);
    }
}
