#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod idle;
mod queue;

use chrono::Utc;
use idle::{get_os_idle_seconds, IdleDebouncer, PresenceState};
use keyring::Entry;
use queue::{OfflineHeartbeatQueue, QueuedHeartbeat};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

const KEYCHAIN_SERVICE: &str = "com.zaviroq.workforce.agent";
const KEYCHAIN_TOKEN_USER: &str = "device_token";
const KEYCHAIN_DEVICE_ID_USER: &str = "device_id";
const DEFAULT_API_BASE: &str = "https://zaviroq-attendence.vercel.app";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatus {
    pub signed_in: bool,
    pub api_base: String,
    pub employee_name: Option<String>,
    pub employee_code: Option<String>,
    pub device_id: Option<String>,
    pub clocked_in: bool,
    pub presence_state: String,
    pub active_seconds: u64,
    pub idle_seconds: u64,
    pub idle_threshold_seconds: u64,
    pub queued_heartbeats: usize,
    pub last_error: Option<String>,
}

struct SharedState {
    api_base: String,
    device_token: Option<String>,
    device_id: Option<String>,
    employee_name: Option<String>,
    employee_code: Option<String>,
    clocked_in: bool,
    on_break: bool,
    screen_locked: bool,
    active_seconds: u64,
    idle_seconds: u64,
    idle_threshold_seconds: u64,
    debouncer: IdleDebouncer,
    offline_queue: OfflineHeartbeatQueue,
    last_error: Option<String>,
    http: Client,
}

impl SharedState {
    fn new() -> Self {
        let token = load_secret(KEYCHAIN_TOKEN_USER);
        let device_id = load_secret(KEYCHAIN_DEVICE_ID_USER);
        Self {
            api_base: std::env::var("ZAVIROQ_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string()),
            device_token: token,
            device_id,
            employee_name: None,
            employee_code: None,
            clocked_in: false,
            on_break: false,
            screen_locked: false,
            active_seconds: 0,
            idle_seconds: 0,
            idle_threshold_seconds: 60,
            debouncer: IdleDebouncer::new(PresenceState::Active),
            offline_queue: OfflineHeartbeatQueue::new(),
            last_error: None,
            http: Client::new(),
        }
    }

    fn snapshot(&self) -> AgentStatus {
        AgentStatus {
            signed_in: self.device_token.is_some(),
            api_base: self.api_base.clone(),
            employee_name: self.employee_name.clone(),
            employee_code: self.employee_code.clone(),
            device_id: self.device_id.clone(),
            clocked_in: self.clocked_in,
            presence_state: self.debouncer.current_state.as_str().to_string(),
            active_seconds: self.active_seconds,
            idle_seconds: self.idle_seconds,
            idle_threshold_seconds: self.idle_threshold_seconds,
            queued_heartbeats: self.offline_queue.len(),
            last_error: self.last_error.clone(),
        }
    }
}

type AppState = Arc<Mutex<SharedState>>;

fn load_secret(user: &str) -> Option<String> {
    Entry::new(KEYCHAIN_SERVICE, user)
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|v| !v.is_empty())
}

fn save_secret(user: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, user).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

fn delete_secret(user: &str) {
    if let Ok(entry) = Entry::new(KEYCHAIN_SERVICE, user) {
        let _ = entry.delete_password();
    }
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn host_device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "Zaviroq Desktop".to_string())
}

#[derive(Deserialize)]
struct PairResponse {
    #[serde(rename = "deviceId")]
    device_id: String,
    #[serde(rename = "deviceToken")]
    device_token: String,
    employee: PairEmployee,
}

#[derive(Deserialize)]
struct PairEmployee {
    name: String,
    code: String,
}

#[derive(Deserialize)]
struct MeResponse {
    employee: PairEmployee,
    attendance: Option<MeAttendance>,
    settings: Option<MeSettings>,
}

#[derive(Deserialize)]
struct MeAttendance {
    status: Option<String>,
    clock_out: Option<String>,
    active_seconds: Option<u64>,
    idle_seconds: Option<u64>,
}

#[derive(Deserialize)]
struct MeSettings {
    #[serde(rename = "idleThresholdSeconds")]
    idle_threshold_seconds: Option<u64>,
}

async fn sync_me(state: &AppState) {
    let (http, url, token) = {
        let guard = state.lock().await;
        match &guard.device_token {
            Some(t) => (
                guard.http.clone(),
                format!("{}/api/devices/me", guard.api_base),
                t.clone(),
            ),
            None => return,
        }
    };

    match http.get(&url).bearer_auth(&token).send().await {
        Ok(resp) if resp.status().as_u16() == 401 => {
            // Revoked by admin -> sign out immediately
            delete_secret(KEYCHAIN_TOKEN_USER);
            delete_secret(KEYCHAIN_DEVICE_ID_USER);
            let mut guard = state.lock().await;
            guard.device_token = None;
            guard.device_id = None;
            guard.clocked_in = false;
            guard.last_error = Some("Signed out: device access revoked by admin".to_string());
        }
        Ok(resp) if resp.status().is_success() => {
            if let Ok(me) = resp.json::<MeResponse>().await {
                let mut guard = state.lock().await;
                guard.employee_name = Some(me.employee.name);
                guard.employee_code = Some(me.employee.code);
                if let Some(att) = me.attendance {
                    guard.clocked_in = att.clock_out.is_none();
                    guard.on_break = att.status.as_deref() == Some("break");
                    if let Some(a) = att.active_seconds {
                        guard.active_seconds = a;
                    }
                    if let Some(i) = att.idle_seconds {
                        guard.idle_seconds = i;
                    }
                } else {
                    guard.clocked_in = false;
                    guard.on_break = false;
                }
                if let Some(s) = me.settings {
                    if let Some(thresh) = s.idle_threshold_seconds {
                        guard.idle_threshold_seconds = thresh.max(15);
                    }
                }
                guard.last_error = None;
            }
        }
        Ok(_) | Err(_) => {}
    }
}

async fn send_or_queue_heartbeat(state: &AppState, hb: QueuedHeartbeat) {
    let (http, url, token) = {
        let guard = state.lock().await;
        match &guard.device_token {
            Some(t) => (
                guard.http.clone(),
                format!("{}/api/activity/heartbeat", guard.api_base),
                t.clone(),
            ),
            None => return,
        }
    };

    // Replay queued heartbeats first if online
    let queued = {
        let mut guard = state.lock().await;
        guard.offline_queue.drain_for_replay(Utc::now())
    };

    let mut failed = Vec::new();
    for item in queued {
        let res = http
            .post(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "state": item.state,
                "source": "desktop_agent",
                "deviceId": item.device_id,
                "timestamp": item.timestamp.to_rfc3339(),
            }))
            .send()
            .await;

        match res {
            Ok(r) if r.status().as_u16() == 401 => {
                delete_secret(KEYCHAIN_TOKEN_USER);
                delete_secret(KEYCHAIN_DEVICE_ID_USER);
                let mut guard = state.lock().await;
                guard.device_token = None;
                guard.last_error = Some("Signed out".to_string());
                return;
            }
            Ok(r) if r.status().is_success() => {}
            _ => {
                failed.push(item);
            }
        }
    }

    if !failed.is_empty() {
        let mut guard = state.lock().await;
        guard.offline_queue.requeue_front(failed, Utc::now());
        guard.offline_queue.push(hb, Utc::now());
        return;
    }

    let res = http
        .post(&url)
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "state": hb.state,
            "source": "desktop_agent",
            "deviceId": hb.device_id,
            "timestamp": hb.timestamp.to_rfc3339(),
        }))
        .send()
        .await;

    match res {
        Ok(r) if r.status().as_u16() == 401 => {
            delete_secret(KEYCHAIN_TOKEN_USER);
            delete_secret(KEYCHAIN_DEVICE_ID_USER);
            let mut guard = state.lock().await;
            guard.device_token = None;
            guard.last_error = Some("Signed out".to_string());
        }
        Ok(r) if r.status().is_success() => {}
        _ => {
            let mut guard = state.lock().await;
            guard.offline_queue.push(hb, Utc::now());
        }
    }
}

#[tauri::command]
async fn get_status(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn login_with_pin(
    state: State<'_, AppState>,
    identifier: String,
    pin: String,
    api_base: Option<String>,
) -> Result<AgentStatus, String> {
    let base = {
        let mut guard = state.lock().await;
        if let Some(b) = api_base.filter(|s| !s.trim().is_empty()) {
            guard.api_base = b.trim_end_matches('/').to_string();
        }
        guard.api_base.clone()
    };

    let http = state.lock().await.http.clone();
    let resp = http
        .post(format!("{}/api/devices/pair", base))
        .json(&serde_json::json!({
            "identifier": identifier.trim(),
            "pin": pin.trim(),
            "deviceName": host_device_name(),
            "platform": platform_name(),
            "appVersion": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_else(|_| "Sign in failed".to_string());
        return Err(msg);
    }

    let paired: PairResponse = resp.json().await.map_err(|e| e.to_string())?;
    save_secret(KEYCHAIN_TOKEN_USER, &paired.device_token)?;
    save_secret(KEYCHAIN_DEVICE_ID_USER, &paired.device_id)?;

    {
        let mut guard = state.lock().await;
        guard.device_token = Some(paired.device_token);
        guard.device_id = Some(paired.device_id);
        guard.employee_name = Some(paired.employee.name);
        guard.employee_code = Some(paired.employee.code);
        guard.last_error = None;
    }
    sync_me(&state).await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn pair_with_code(
    state: State<'_, AppState>,
    code: String,
    api_base: Option<String>,
) -> Result<AgentStatus, String> {
    let base = {
        let mut guard = state.lock().await;
        if let Some(b) = api_base.filter(|s| !s.trim().is_empty()) {
            guard.api_base = b.trim_end_matches('/').to_string();
        }
        guard.api_base.clone()
    };

    let http = state.lock().await.http.clone();
    let resp = http
        .post(format!("{}/api/devices/pair", base))
        .json(&serde_json::json!({
            "code": code.trim(),
            "deviceName": host_device_name(),
            "platform": platform_name(),
            "appVersion": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let msg = resp.text().await.unwrap_or_else(|_| "Invalid or expired pairing code".to_string());
        return Err(msg);
    }

    let paired: PairResponse = resp.json().await.map_err(|e| e.to_string())?;
    save_secret(KEYCHAIN_TOKEN_USER, &paired.device_token)?;
    save_secret(KEYCHAIN_DEVICE_ID_USER, &paired.device_id)?;

    {
        let mut guard = state.lock().await;
        guard.device_token = Some(paired.device_token);
        guard.device_id = Some(paired.device_id);
        guard.employee_name = Some(paired.employee.name);
        guard.employee_code = Some(paired.employee.code);
        guard.last_error = None;
    }
    sync_me(&state).await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn clock_in(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let (http, base, token) = {
        let guard = state.lock().await;
        let token = guard.device_token.clone().ok_or("Not signed in")?;
        (guard.http.clone(), guard.api_base.clone(), token)
    };
    let resp = http
        .post(format!("{}/api/attendance/clock-in", base))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "source": "desktop_agent" }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_else(|_| "Clock in failed".into()));
    }
    sync_me(&state).await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn take_break(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let device_id = {
        let mut guard = state.lock().await;
        guard.on_break = true;
        guard.device_id.clone()
    };
    send_or_queue_heartbeat(
        &state,
        QueuedHeartbeat {
            state: "break".into(),
            timestamp: Utc::now(),
            device_id,
        },
    )
    .await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn resume_work(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let device_id = {
        let mut guard = state.lock().await;
        guard.on_break = false;
        guard.device_id.clone()
    };
    send_or_queue_heartbeat(
        &state,
        QueuedHeartbeat {
            state: "active".into(),
            timestamp: Utc::now(),
            device_id,
        },
    )
    .await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn clock_out(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let (http, base, token) = {
        let guard = state.lock().await;
        let token = guard.device_token.clone().ok_or("Not signed in")?;
        (guard.http.clone(), guard.api_base.clone(), token)
    };
    let resp = http
        .post(format!("{}/api/attendance/clock-out", base))
        .bearer_auth(&token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_else(|_| "Clock out failed".into()));
    }
    sync_me(&state).await;
    Ok(state.lock().await.snapshot())
}

#[tauri::command]
async fn sign_out(state: State<'_, AppState>) -> Result<AgentStatus, String> {
    let (http, base, token) = {
        let guard = state.lock().await;
        (guard.http.clone(), guard.api_base.clone(), guard.device_token.clone())
    };
    if let Some(t) = token {
        let _ = http
            .post(format!("{}/api/devices/revoke-self", base))
            .bearer_auth(&t)
            .send()
            .await;
    }
    delete_secret(KEYCHAIN_TOKEN_USER);
    delete_secret(KEYCHAIN_DEVICE_ID_USER);
    let mut guard = state.lock().await;
    guard.device_token = None;
    guard.device_id = None;
    guard.employee_name = None;
    guard.employee_code = None;
    guard.clocked_in = false;
    Ok(guard.snapshot())
}

#[tauri::command]
fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let version = update.version.clone();
            update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
            Ok(format!("Updated to v{} — restart to apply", version))
        }
        None => Ok("You are on the latest version".to_string()),
    }
}

fn spawn_background_loops(state: AppState) {
    // 5s OS idle sampler
    let idle_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            let os_idle = get_os_idle_seconds();
            let mut guard = idle_state.lock().await;
            if guard.device_token.is_none() || !guard.clocked_in {
                continue;
            }
            let thresh = guard.idle_threshold_seconds;
            let locked = guard.screen_locked;
            let on_break = guard.on_break;
            guard.debouncer.evaluate(os_idle, thresh, locked, on_break, Utc::now());
        }
    });

    // 30s heartbeat + settings sync
    let hb_state = state.clone();
    tauri::async_runtime::spawn(async move {
        sync_me(&hb_state).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            sync_me(&hb_state).await;
            let maybe_hb = {
                let guard = hb_state.lock().await;
                if guard.device_token.is_some() && guard.clocked_in {
                    Some(QueuedHeartbeat {
                        state: guard.debouncer.current_state.as_str().to_string(),
                        timestamp: Utc::now(),
                        device_id: guard.device_id.clone(),
                    })
                } else {
                    None
                }
            };
            if let Some(hb) = maybe_hb {
                send_or_queue_heartbeat(&hb_state, hb).await;
            }
        }
    });
}

fn main() {
    let shared: AppState = Arc::new(Mutex::new(SharedState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(shared.clone())
        .setup(move |app| {
            // Enable auto-start at login by default on first setup
            let _ = app.autolaunch().enable();

            let open_item = MenuItem::with_id(app, "open", "Open Zaviroq Agent", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit (stops tracking)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &sep, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Zaviroq Workforce")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                            let _ = win.eval("window.__confirmQuit && window.__confirmQuit()");
                        } else {
                            app.exit(0);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            spawn_background_loops(shared.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            login_with_pin,
            pair_with_code,
            clock_in,
            take_break,
            resume_work,
            clock_out,
            sign_out,
            get_autostart_enabled,
            set_autostart_enabled,
            check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Zaviroq Desktop Agent");
}
