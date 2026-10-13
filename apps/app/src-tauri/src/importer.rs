// First-run import: find the installed game, check Python, run tools/importer/import_all.py with live log.
// The importer scripts ship as app resources ("importer/"); debug builds use the repo's tools/importer.
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::AppState;

const GAME_DIR: &str = "Journeys in Middle-earth";

pub struct ImportState {
    running: AtomicBool,
}

impl ImportState {
    pub fn new() -> Self {
        Self { running: AtomicBool::new(false) }
    }
}

fn importer_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tools/importer");
        if repo.join("import_all.py").is_file() {
            return Some(repo);
        }
    }
    let res = app.path().resource_dir().ok()?.join("importer");
    res.join("import_all.py").is_file().then_some(res)
}

/// JiME_Data folder of a game install (accepts the game folder or JiME_Data itself)
fn data_dir(game: &Path) -> Option<PathBuf> {
    [game.join("JiME_Data"), game.to_path_buf(), game.join("JiME.app/Contents/Resources/Data")]
        .into_iter()
        .find(|d| d.join("resources.assets").is_file())
}

/// Steam library roots from libraryfolders.vdf ("path" entries)
fn steam_libraries(steam: &Path) -> Vec<PathBuf> {
    let mut out = vec![steam.to_path_buf()];
    if let Ok(vdf) = std::fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
        for line in vdf.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("\"path\"") {
                let p = rest.trim().trim_matches('"').replace("\\\\", "\\");
                if !p.is_empty() {
                    out.push(PathBuf::from(p));
                }
            }
        }
    }
    out
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashing for each Python call
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameCandidate {
    path: String,
    data_dir: String,
}

/// Installed copies of the game found in the usual Steam locations
#[tauri::command]
pub fn detect_game() -> Vec<GameCandidate> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for base in ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"] {
            roots.extend(steam_libraries(Path::new(base)));
        }
        for d in b'C'..=b'Z' {
            roots.push(PathBuf::from(format!("{}:\\SteamLibrary", d as char)));
            roots.push(PathBuf::from(format!("{}:\\Steam", d as char)));
        }
    } else if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.extend(steam_libraries(&home.join("Library/Application Support/Steam")));
        roots.extend(steam_libraries(&home.join(".steam/steam")));
        roots.extend(steam_libraries(&home.join(".local/share/Steam")));
    }
    let mut out: Vec<GameCandidate> = Vec::new();
    for r in roots {
        let game = r.join("steamapps").join("common").join(GAME_DIR);
        if let Some(d) = data_dir(&game) {
            let path = game.to_string_lossy().into_owned();
            if !out.iter().any(|c| c.path.eq_ignore_ascii_case(&path)) {
                out.push(GameCandidate { path, data_dir: d.to_string_lossy().into_owned() });
            }
        }
    }
    out
}

/// Is `path` a game install? Returns its JiME_Data folder
#[tauri::command]
pub fn check_game(path: String) -> Result<String, String> {
    data_dir(Path::new(path.trim())).map(|d| d.to_string_lossy().into_owned())
        .ok_or_else(|| "в папке нет JiME_Data\\resources.assets — это не папка игры".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonInfo {
    /// Interpreter command that works (python / py / python3), null if none found
    exe: Option<String>,
    version: Option<String>,
    /// pip names of missing packages (requirements.txt)
    missing: Vec<String>,
    importer: Option<String>,
}

fn python_candidates() -> &'static [&'static str] {
    // On Windows "python3" may be the Microsoft Store stub, so it goes last
    if cfg!(windows) { &["python", "py", "python3"] } else { &["python3", "python"] }
}

/// Find Python 3 and check the importer's packages
#[tauri::command]
pub fn python_info<R: Runtime>(app: AppHandle<R>) -> PythonInfo {
    let importer = importer_dir(&app);
    for exe in python_candidates() {
        let Ok(o) = hidden(Command::new(exe).args(["-c", "import sys; print(sys.version_info[0], sys.version.split()[0])"])).output() else { continue };
        let s = String::from_utf8_lossy(&o.stdout).to_string();
        let mut it = s.split_whitespace();
        if !o.status.success() || it.next() != Some("3") {
            continue;
        }
        let version = it.next().map(str::to_string);
        let mut missing = Vec::new();
        if let Some(dir) = &importer {
            if let Ok(c) = hidden(Command::new(exe).arg("-u").arg(dir.join("import_all.py")).arg("--check").current_dir(dir)).output() {
                for line in String::from_utf8_lossy(&c.stdout).lines() {
                    if let Some(m) = line.strip_prefix("@@missing ") {
                        missing = m.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect();
                    }
                }
            }
        }
        return PythonInfo { exe: Some(exe.to_string()), version, missing, importer: importer.map(|d| d.to_string_lossy().into_owned()) };
    }
    PythonInfo { exe: None, version: None, missing: vec![], importer: importer.map(|d| d.to_string_lossy().into_owned()) }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLine {
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    ok: bool,
    code: Option<i32>,
    task: String,
}

/// Run a Python job in the background; output lines go to the "import-log" event, the end to "import-done"
fn spawn_job<R: Runtime>(app: AppHandle<R>, task: &str, exe: String, args: Vec<String>, cwd: PathBuf) -> Result<(), String> {
    let st = app.state::<ImportState>();
    if st.running.swap(true, Ordering::SeqCst) {
        return Err("импорт уже идёт".into());
    }
    let mut cmd = Command::new(&exe);
    cmd.args(&args).current_dir(&cwd).env("PYTHONIOENCODING", "utf-8").env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match hidden(&mut cmd).spawn() {
        Ok(c) => c,
        Err(e) => {
            st.running.store(false, Ordering::SeqCst);
            return Err(format!("{exe}: {e}"));
        }
    };
    let task = task.to_string();
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let a2 = app.clone();
    let t_err = std::thread::spawn(move || {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            let _ = a2.emit("import-log", LogLine { line });
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let _ = app.emit("import-log", LogLine { line });
        }
        let _ = t_err.join();
        let code = child.wait().ok().and_then(|s| s.code());
        app.state::<ImportState>().running.store(false, Ordering::SeqCst);
        let _ = app.emit("import-done", Done { ok: code == Some(0), code, task });
    });
    Ok(())
}

/// pip install --user -r requirements.txt
#[tauri::command]
pub fn install_requirements<R: Runtime>(app: AppHandle<R>, exe: String) -> Result<(), String> {
    let dir = importer_dir(&app).ok_or("не найдены скрипты импортёра")?;
    let args = ["-m", "pip", "install", "--user", "--disable-pip-version-check", "--no-warn-script-location", "-r", "requirements.txt"];
    spawn_job(app, "pip", exe, args.iter().map(|s| s.to_string()).collect(), dir)
}

/// Import the game into <packs folder>/core-ffg (work files go next to the packs folder, like the repo's data/)
#[tauri::command]
pub fn run_import<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>, exe: String, game: String) -> Result<String, String> {
    let dir = importer_dir(&app).ok_or("не найдены скрипты импортёра")?;
    let packs = state.packs.lock().unwrap().path.clone();
    std::fs::create_dir_all(&packs).map_err(|e| e.to_string())?;
    let work = packs.parent().map(Path::to_path_buf).unwrap_or_else(|| packs.clone());
    if work.join("packs") != packs {
        // import_all writes to <work>/packs; a packs folder not named "packs" gets a sibling work folder
        return Err(format!("папка паков должна называться «packs»: {}", packs.display()));
    }
    let args = vec!["-u".into(), "import_all.py".into(), "--game".into(), game, "--work".into(), work.to_string_lossy().into_owned()];
    spawn_job(app, "import", exe, args, dir)?;
    Ok(work.to_string_lossy().into_owned())
}
