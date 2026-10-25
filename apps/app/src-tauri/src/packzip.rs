// Packs as zip files: export a pack folder to a .zip (to carry it to a machine without the game, e.g. Android
// or Linux), and load such a .zip into the packs folder.
// Archive layout: "<pack-dir>/pack.json", "<pack-dir>/..." (what export writes); a flat archive with pack.json
// at the root is accepted too (the folder is then named after the manifest id).
// Progress: "pack-zip" events {task: "export" | "import", done, total}.
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::{info, list_files, safe_join, AppState, PacksInfo};

#[derive(Clone, Serialize)]
struct Progress {
    task: &'static str,
    done: usize,
    total: usize,
}

fn progress<R: Runtime>(app: &AppHandle<R>, task: &'static str, done: usize, total: usize) {
    // a few hundred events at most: every 16 files and the last one
    if done % 16 == 0 || done == total {
        let _ = app.emit("pack-zip", Progress { task, done, total });
    }
}

/// Folder names a pack may use (no separators, no dots-only names)
fn valid_dir(d: &str) -> bool {
    !d.is_empty() && d.len() <= 64 && !d.chars().all(|c| c == '.')
        && d.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Already-compressed formats are stored as is: deflating them costs time and gains nothing
fn method_for(name: &str) -> CompressionMethod {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "ogg" | "mp3" | "webp" | "zip" => CompressionMethod::Stored,
        _ => CompressionMethod::Deflated,
    }
}

fn write_zip<R: Runtime>(app: &AppHandle<R>, root: &Path, dir: &str, dest: &Path) -> Result<(), String> {
    let src = safe_join(root, dir).filter(|d| d.is_dir()).ok_or(format!("no pack folder: {dir}"))?;
    let files = list_files(&src);
    if !files.iter().any(|f| f == "pack.json") {
        return Err(format!("{dir}: no pack.json"));
    }
    // write next to the destination first: a failed export must not leave a half-written file under the real name
    let tmp = dest.with_extension("zip.part");
    let out = File::create(&tmp).map_err(|e| format!("{}: {e}", tmp.display()))?;
    let mut zip = ZipWriter::new(BufWriter::new(out));
    let total = files.len();
    let res = (|| -> Result<(), String> {
        for (i, rel) in files.iter().enumerate() {
            let name = format!("{dir}/{rel}");
            let opts = SimpleFileOptions::default().compression_method(method_for(rel)).large_file(false);
            zip.start_file(name.as_str(), opts).map_err(|e| format!("{name}: {e}"))?;
            let mut f = File::open(src.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
            io::copy(&mut f, &mut zip).map_err(|e| format!("{rel}: {e}"))?;
            progress(app, "export", i + 1, total);
        }
        let mut w = zip.finish().map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    })();
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    let _ = fs::remove_file(dest);
    fs::rename(&tmp, dest).map_err(|e| format!("{}: {e}", dest.display()))
}

/// Export the pack folder `dir` to the zip file `dest` (a path from the save dialog)
#[tauri::command]
pub async fn export_pack<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>, dir: String, dest: String) -> Result<String, String> {
    if !valid_dir(&dir) {
        return Err(format!("bad pack folder name: {dir}"));
    }
    let root = state.packs.lock().unwrap().path.clone();
    let dest = PathBuf::from(dest.trim());
    let a = app.clone();
    let d2 = dest.clone();
    tauri::async_runtime::spawn_blocking(move || write_zip(&a, &root, &dir, &d2))
        .await
        .map_err(|e| e.to_string())??;
    Ok(dest.to_string_lossy().into_owned())
}

/// Where the pack sits inside the archive: (prefix inside the zip, folder name in the packs folder)
fn locate<Z: Read + Seek>(zip: &mut ZipArchive<Z>) -> Result<(String, String), String> {
    let names: Vec<String> = zip.file_names().filter_map(|s| s.ok()).map(|s| s.replace('\\', "/")).collect();
    // "<dir>/pack.json" with a single top folder
    let mut tops: Vec<&str> = names.iter().filter_map(|n| n.split('/').next()).filter(|t| !t.is_empty()).collect();
    tops.sort();
    tops.dedup();
    if tops.len() == 1 && names.iter().any(|n| *n == format!("{}/pack.json", tops[0])) {
        let d = tops[0].to_string();
        if !valid_dir(&d) {
            return Err(format!("bad pack folder name in the archive: {d}"));
        }
        return Ok((format!("{d}/"), d));
    }
    // flat: pack.json at the root, folder = manifest id
    if names.iter().any(|n| n == "pack.json") {
        let mut s = String::new();
        zip.by_name("pack.json").map_err(|e| e.to_string())?.read_to_string(&mut s).map_err(|e| e.to_string())?;
        let m: serde_json::Value = serde_json::from_str(&s).map_err(|e| format!("pack.json: {e}"))?;
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if !valid_dir(&id) {
            return Err(format!("pack.json: bad or missing id \"{id}\""));
        }
        return Ok((String::new(), id));
    }
    Err("not a pack archive: no pack.json (expected <pack>/pack.json)".into())
}

fn read_zip<R: Runtime, Z: Read + Seek>(app: &AppHandle<R>, root: &Path, reader: Z) -> Result<String, String> {
    let mut zip = ZipArchive::new(reader).map_err(|e| format!("not a zip file: {e}"))?;
    let (prefix, dir) = locate(&mut zip)?;
    fs::create_dir_all(root).map_err(|e| format!("{}: {e}", root.display()))?;
    // unpack into a hidden temp folder, then swap it in: an interrupted import keeps the old pack
    let tmp = root.join(format!(".{dir}.part"));
    let _ = fs::remove_dir_all(&tmp);
    let total = zip.len();
    let res = (|| -> Result<(), String> {
        for i in 0..total {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = f.name().map_err(|e| e.to_string())?.replace('\\', "/");
            let Some(rel) = name.strip_prefix(&prefix) else { continue };
            if rel.is_empty() || f.is_dir() {
                continue;
            }
            // enclosed: no absolute paths, no ".." (zip slip)
            let target = safe_join(&tmp, rel).ok_or(format!("unsafe path in the archive: {name}"))?;
            if let Some(p) = target.parent() {
                fs::create_dir_all(p).map_err(|e| format!("{}: {e}", p.display()))?;
            }
            let mut out = BufWriter::new(File::create(&target).map_err(|e| format!("{rel}: {e}"))?);
            io::copy(&mut f, &mut out).map_err(|e| format!("{rel}: {e}"))?;
            out.flush().map_err(|e| format!("{rel}: {e}"))?;
            progress(app, "import", i + 1, total);
        }
        Ok(())
    })();
    if let Err(e) = res {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let dest = root.join(&dir);
    let old = root.join(format!(".{dir}.old"));
    let _ = fs::remove_dir_all(&old);
    if dest.exists() {
        fs::rename(&dest, &old).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::rename(&old, &dest);
        return Err(format!("{}: {e}", dest.display()));
    }
    let _ = fs::remove_dir_all(&old);
    Ok(dir)
}

/// Load a pack zip (a path, or a content:// URI from the Android file picker) into the packs folder
#[tauri::command]
pub async fn import_pack<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>, src: String) -> Result<PacksInfo, String> {
    let root = state.packs.lock().unwrap().path.clone();
    let fp = FilePath::from_str(src.trim()).map_err(|e| format!("{src}: {e}"))?;
    let mut opts = OpenOptions::new();
    opts.read(true);
    let file = app.fs().open(fp, opts).map_err(|e| format!("{src}: {e}"))?;
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || read_zip(&a, &root, BufReader::new(file)))
        .await
        .map_err(|e| e.to_string())??;
    let packs = app.state::<AppState>().packs.lock().unwrap().clone();
    Ok(info(&packs))
}
