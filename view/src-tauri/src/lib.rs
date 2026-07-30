#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use aes_gcm::{aead::{Aead, KeyInit}, AesGcm, Nonce};
use aes_gcm::aes::Aes256;
use aes_gcm::aead::consts::U16;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use scrypt::{scrypt, Params};
use std::{fs, path::PathBuf, process::{Child, Command, Stdio}, sync::Mutex};
use tauri::{AppHandle, Manager, RunEvent};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;


type Aes256Gcm16 = AesGcm<Aes256, U16>;
const ENCRYPTION_PASSWORD: &[u8] = b"vision-system-v1-secret-key";
const ENCRYPTION_SALT: &[u8] = b"vision-salt-2026";

#[derive(Default)]
struct BackendProcess(Mutex<Option<Child>>);

#[derive(Debug, Serialize, Deserialize)]
struct EncryptedPayload {
    iv: String,
    #[serde(rename = "authTag")]
    auth_tag: String,
    data: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("VISION_DATA_DIR") {
        let path = PathBuf::from(path);
        fs::create_dir_all(&path).map_err(|error| format!("创建数据目录失败: {error}"))?;
        return Ok(path);
    }


    let exe_dir = std::env::current_exe()
        .map_err(|error| format!("获取程序目录失败: {error}"))?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "获取程序目录失败".to_string())?;
    let is_portable = std::env::var("VISION_PORTABLE").ok().as_deref() == Some("1")
        || exe_dir.join("portable.flag").exists();
    if is_portable {
        let path = exe_dir.join("data");
        fs::create_dir_all(&path).map_err(|error| format!("创建便携数据目录失败: {error}"))?;
        return Ok(path);
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    fs::create_dir_all(&path).map_err(|error| format!("创建数据目录失败: {error}"))?;
    Ok(path)
}

fn safe_key(key: &str) -> Result<&str, String> {
    if key.is_empty() || !key.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-') {
        return Err("数据键名不合法".to_string());
    }
    Ok(key)
}

fn derive_key() -> Result<[u8; 32], String> {
    let params = Params::new(14, 8, 1, 32)
        .map_err(|error| format!("创建加密参数失败: {error}"))?;
    let mut key = [0_u8; 32];
    scrypt(ENCRYPTION_PASSWORD, ENCRYPTION_SALT, &params, &mut key)
        .map_err(|error| format!("派生加密密钥失败: {error}"))?;
    Ok(key)
}

fn cipher() -> Result<Aes256Gcm16, String> {
    let key = derive_key()?;
    Aes256Gcm16::new_from_slice(&key).map_err(|error| format!("初始化加密器失败: {error}"))
}

#[tauri::command]
fn save_data(app: AppHandle, key: String, data: Value) -> Result<bool, String> {
    let key = safe_key(&key)?;
    let dir = data_dir(&app)?;
    let iv: [u8; 16] = rand_iv();
    let plaintext = serde_json::to_vec(&data).map_err(|error| format!("序列化数据失败: {error}"))?;
    let encrypted = cipher()?
        .encrypt(Nonce::<U16>::from_slice(&iv), plaintext.as_ref())
        .map_err(|error| format!("加密数据失败: {error}"))?;

    if encrypted.len() < 16 {
        return Err("加密结果无效".to_string());
    }
    let split_at = encrypted.len() - 16;
    let payload = EncryptedPayload {
        iv: hex::encode(iv),
        auth_tag: hex::encode(&encrypted[split_at..]),
        data: hex::encode(&encrypted[..split_at]),
    };
    let path = dir.join(format!("{key}.enc"));
    let contents = serde_json::to_string(&payload).map_err(|error| format!("生成存储内容失败: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("写入数据失败: {error}"))?;
    Ok(true)
}

#[tauri::command]
fn load_data(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    let key = safe_key(&key)?;
    let path = data_dir(&app)?.join(format!("{key}.enc"));
    if !path.exists() {
        return Ok(None);
    }

    let result = (|| {
        let payload: EncryptedPayload = serde_json::from_str(
            &fs::read_to_string(&path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let iv = hex::decode(payload.iv).map_err(|error| error.to_string())?;
        if iv.len() != 16 {
            return Err("存储数据的 IV 长度无效".to_string());
        }
        let mut encrypted = hex::decode(payload.data).map_err(|error| error.to_string())?;
        encrypted.extend(hex::decode(payload.auth_tag).map_err(|error| error.to_string())?);
        let decrypted = cipher()?
            .decrypt(Nonce::<U16>::from_slice(&iv), encrypted.as_ref())
            .map_err(|error| format!("解密失败: {error}"))?;
        serde_json::from_slice::<Value>(&decrypted).map_err(|error| error.to_string())
    })();

    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let _ = fs::remove_file(path);
            eprintln!("读取加密数据失败，已删除损坏文件: {error}");
            Ok(None)
        }
    }
}

#[tauri::command]
fn get_data_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

fn rand_iv() -> [u8; 16] {
    let mut iv = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut iv);
    iv
}

fn resolve_backend_path(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| format!("获取资源目录失败: {error}"))?
        .join("backend")
        .join("backend.exe");
    let current = std::env::current_dir().map_err(|error| format!("获取当前目录失败: {error}"))?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from));
    let candidates = [
        packaged,
        current.join("resources").join("backend").join("backend.exe"),
        current.join("..").join("resources").join("backend").join("backend.exe"),
        exe_dir.clone().unwrap_or_default().join("resources").join("backend").join("backend.exe"),
        exe_dir.unwrap_or_default().join("backend").join("backend.exe"),
    ];
    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "找不到 backend.exe 资源，请先运行后端打包或准备脚本".to_string())
}

fn start_backend(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<BackendProcess>();
    if state.0.lock().map_err(|_| "后端状态锁定失败")?.is_some() { return Ok(()); }
    let data_path = data_dir(app)?.to_string_lossy().to_string();
    let backend_path = resolve_backend_path(app)?;
    let mut command = Command::new(&backend_path);
    command.current_dir(backend_path.parent().unwrap_or_else(|| std::path::Path::new(".")))
        .env("VISION_DATA_DIR", data_path)
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("no_proxy", "127.0.0.1,localhost")
        .stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let child = command.spawn().map_err(|error| format!("启动检测后端失败: {error}"))?;
    let result = if let Ok(mut guard) = state.0.lock() {
        *guard = Some(child);
        Ok(())
    } else {
        let mut child = child;
        let _ = child.kill();
        Err("后端状态锁定失败".to_string())
    };
    result
}
fn stop_backend(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<BackendProcess>().0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

pub fn run() {
    tauri::Builder::default()

        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_data, load_data, get_data_path])
        .setup(|app| {
            app.manage(BackendProcess::default());
            if let Err(error) = start_backend(app.handle()) {
                eprintln!("Tauri 启动后端失败: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("创建 Tauri 应用失败")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                stop_backend(app);
            }
        });
}








