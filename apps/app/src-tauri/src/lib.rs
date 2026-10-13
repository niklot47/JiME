// JiME Reborn desktop shell: serves content packs from a folder on disk to the web UI.
//
// Packs folder, first match wins:
//   1. JIME_PACKS environment variable;
//   2. "packsDir" in <app config dir>/settings.json (set from the Packs screen);
//   3. debug builds only: <repo>/data/packs if it exists (pnpm tauri dev next to the importer output);
//   4. <app data dir>/packs (created on demand).
// The UI reads files through the "jime-pack" URI scheme: jime-pack://localhost/<pack-id>/<path>
// (http://jime-pack.localhost/... on Windows and Android). FFG content never ships with the app.
use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, State, UriSchemeContext};

const SCHEME: &str = "jime-pack";

#[derive(Clone, Serialize)]
struct PacksDir {
    path: PathBuf,
    /// Where the path came from: "env", "settings", "repo" or "default"
    source: &'static str,
}

struct AppState {
    packs: Mutex<PacksDir>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    packs_dir: Option<String>,
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Settings {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_settings<R: Runtime>(app: &AppHandle<R>, s: &Settings) -> Result<(), String> {
    let p = settings_path(app).ok_or("no app config dir")?;
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())
}

fn resolve_packs_dir<R: Runtime>(app: &AppHandle<R>) -> PacksDir {
    if let Ok(p) = std::env::var("JIME_PACKS") {
        if !p.is_empty() {
            return PacksDir { path: PathBuf::from(p), source: "env" };
        }
    }
    if let Some(p) = read_settings(app).packs_dir {
        return PacksDir { path: PathBuf::from(p), source: "settings" };
    }
    if cfg!(debug_assertions) {
        // src-tauri -> app -> apps -> repo
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/packs");
        if repo.is_dir() {
            let path = repo.canonicalize().map(strip_verbatim).unwrap_or(repo);
            return PacksDir { path, source: "repo" };
        }
    }
    let path = app
        .path()
        .app_data_dir()
        .map(|d| d.join("packs"))
        .unwrap_or_else(|_| PathBuf::from("packs"));
    let _ = fs::create_dir_all(&path);
    PacksDir { path, source: "default" }
}

/// Windows canonicalize() returns \\?\C:\... paths; show and store the plain form
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().into_owned();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p,
    }
}

/// Minimal percent-decoding of a URI path (UTF-8)
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// File inside `root` for a request path; None if the path leaves the root
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let mut p = root.to_path_buf();
    for c in Path::new(rel.trim_start_matches(['/', '\\'])).components() {
        match c {
            Component::Normal(x) => p.push(x),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(p)
}

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("json") => "application/json",
        Some("csv") => "text/csv; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("ogg") => "audio/ogg",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn serve_pack<R: Runtime>(ctx: UriSchemeContext<'_, R>, req: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let reply = |status: StatusCode, ctype: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, ctype)
            // the UI origin differs from the scheme's: fetch, FontFace and WebGL textures need CORS
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Cow::Owned(body))
            .unwrap()
    };
    let root = ctx.app_handle().state::<AppState>().packs.lock().unwrap().path.clone();
    let rel = percent_decode(req.uri().path());
    let Some(file) = safe_join(&root, &rel) else {
        return reply(StatusCode::FORBIDDEN, "text/plain", b"outside the packs folder".to_vec());
    };
    match fs::read(&file) {
        Ok(data) => reply(StatusCode::OK, content_type(&file), data),
        Err(_) => reply(StatusCode::NOT_FOUND, "text/plain", format!("not found: {rel}").into_bytes()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PackEntry {
    /// Folder name (what the UI requests)
    dir: String,
    /// pack.json as is (null if missing or invalid)
    manifest: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PacksInfo {
    dir: String,
    source: &'static str,
    exists: bool,
    packs: Vec<PackEntry>,
}

fn info(d: &PacksDir) -> PacksInfo {
    let mut packs = Vec::new();
    if let Ok(rd) = fs::read_dir(&d.path) {
        for e in rd.flatten() {
            if !e.path().is_dir() {
                continue;
            }
            let manifest = fs::read_to_string(e.path().join("pack.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
            packs.push(PackEntry { dir: e.file_name().to_string_lossy().into_owned(), manifest });
        }
    }
    packs.sort_by(|a, b| a.dir.cmp(&b.dir));
    PacksInfo { dir: d.path.to_string_lossy().into_owned(), source: d.source, exists: d.path.is_dir(), packs }
}

/// Current packs folder and the packs in it
#[tauri::command]
fn packs_info(state: State<'_, AppState>) -> PacksInfo {
    info(&state.packs.lock().unwrap())
}

/// Use `path` as the packs folder (saved in settings.json); None = back to the default
#[tauri::command]
fn set_packs_dir(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> Result<PacksInfo, String> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    if let Some(p) = &path {
        if !Path::new(p).is_dir() {
            return Err(format!("folder not found: {p}"));
        }
    }
    let mut s = read_settings(&app);
    s.packs_dir = path;
    write_settings(&app, &s)?;
    let d = resolve_packs_dir(&app);
    let out = info(&d);
    *state.packs.lock().unwrap() = d;
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let d = resolve_packs_dir(app.handle());
            app.manage(AppState { packs: Mutex::new(d) });
            Ok(())
        })
        .register_uri_scheme_protocol(SCHEME, serve_pack)
        .invoke_handler(tauri::generate_handler![packs_info, set_packs_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
