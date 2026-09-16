use serde::Serialize;
use std::sync::{Arc, Mutex};
use sysinfo::{Components, Networks, System};
use tauri::{Emitter, Manager};

struct MonitorState {
    system: System,
    networks: Networks,
    components: Components,
}

struct AppState {
    monitor: Arc<Mutex<Option<MonitorState>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BatterySnapshot {
    percent: u8,
    charging: bool,
    remaining_minutes: Option<u32>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct AudioSnapshot {
    volume: u8,
    muted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemSnapshot {
    cpu_percent: f32,
    memory_percent: f32,
    memory_used_gb: f32,
    memory_total_gb: f32,
    temperature_celsius: Option<f32>,
    download_bytes_per_second: u64,
    upload_bytes_per_second: u64,
    battery: Option<BatterySnapshot>,
    audio: AudioSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaSnapshot {
    title: String,
    artist: String,
    source: String,
    playing: bool,
    position_seconds: i64,
    duration_seconds: i64,
}

#[cfg(windows)]
fn battery_snapshot() -> Option<BatterySnapshot> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status).ok()? };
    if status.BatteryFlag == 128 || status.BatteryLifePercent == 255 {
        return None;
    }

    Some(BatterySnapshot {
        percent: status.BatteryLifePercent.min(100),
        charging: status.ACLineStatus == 1,
        remaining_minutes: (status.BatteryLifeTime != u32::MAX)
            .then_some(status.BatteryLifeTime / 60),
    })
}

#[cfg(not(windows))]
fn battery_snapshot() -> Option<BatterySnapshot> {
    None
}

#[cfg(windows)]
fn with_audio_endpoint<T>(
    operation: impl FnOnce(
        &windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume,
    ) -> windows::core::Result<T>,
) -> Result<T, String> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
    };

    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> windows::core::Result<T> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            operation(&endpoint)
        })()
        .map_err(|error| error.to_string());
        if initialized {
            CoUninitialize();
        }
        result
    }
}

#[cfg(windows)]
fn audio_snapshot() -> AudioSnapshot {
    with_audio_endpoint(|endpoint| unsafe {
        Ok(AudioSnapshot {
            volume: (endpoint.GetMasterVolumeLevelScalar()? * 100.0).round() as u8,
            muted: endpoint.GetMute()?.into(),
        })
    })
    .unwrap_or_default()
}

#[cfg(not(windows))]
fn audio_snapshot() -> AudioSnapshot {
    AudioSnapshot::default()
}

fn collect_system_snapshot(
    state: Arc<Mutex<Option<MonitorState>>>,
) -> Result<SystemSnapshot, String> {
    let mut guard = state
        .lock()
        .map_err(|_| "Không thể đọc trạng thái hệ thống".to_string())?;
    let monitor = guard.get_or_insert_with(|| MonitorState {
        system: System::new_all(),
        networks: Networks::new_with_refreshed_list(),
        components: Components::new_with_refreshed_list(),
    });

    monitor.system.refresh_cpu_usage();
    monitor.system.refresh_memory();
    monitor.networks.refresh(true);
    monitor.components.refresh(true);

    let memory_total = monitor.system.total_memory();
    let memory_used = monitor.system.used_memory();
    let temperature = monitor
        .components
        .iter()
        .filter_map(|component| component.temperature())
        .filter(|value| value.is_finite() && *value > 0.0)
        .max_by(|a, b| a.total_cmp(b));
    let download = monitor.networks.values().map(|data| data.received()).sum();
    let upload = monitor
        .networks
        .values()
        .map(|data| data.transmitted())
        .sum();

    Ok(SystemSnapshot {
        cpu_percent: monitor.system.global_cpu_usage(),
        memory_percent: if memory_total == 0 {
            0.0
        } else {
            memory_used as f32 / memory_total as f32 * 100.0
        },
        memory_used_gb: memory_used as f32 / 1_073_741_824.0,
        memory_total_gb: memory_total as f32 / 1_073_741_824.0,
        temperature_celsius: temperature,
        download_bytes_per_second: download,
        upload_bytes_per_second: upload,
        battery: battery_snapshot(),
        audio: audio_snapshot(),
    })
}

#[tauri::command]
async fn get_system_snapshot(state: tauri::State<'_, AppState>) -> Result<SystemSnapshot, String> {
    let monitor = Arc::clone(&state.monitor);
    tauri::async_runtime::spawn_blocking(move || collect_system_snapshot(monitor))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn current_media_session()
-> Result<windows::Media::Control::GlobalSystemMediaTransportControlsSession, String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .and_then(|operation| operation.join())
        .and_then(|manager| manager.GetCurrentSession())
        .map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(windows)]
async fn get_media_snapshot() -> Result<Option<MediaSnapshot>, String> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

    let session = match current_media_session() {
        Ok(session) => session,
        Err(_) => return Ok(None),
    };
    let properties = session
        .TryGetMediaPropertiesAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| error.to_string())?;
    let playback = session
        .GetPlaybackInfo()
        .map_err(|error| error.to_string())?;
    let playback_status = playback.PlaybackStatus().ok();
    if matches!(
        playback_status,
        Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed)
            | Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped)
    ) {
        return Ok(None);
    }

    let title = properties
        .Title()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let artist = properties
        .Artist()
        .map(|value| value.to_string())
        .unwrap_or_default();
    let source = session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default();
    if title.trim().is_empty() || source.trim().is_empty() {
        return Ok(None);
    }

    let timeline = session.GetTimelineProperties().ok();
    let (position_seconds, duration_seconds) = timeline
        .and_then(|timeline| {
            let start = timeline.StartTime().ok()?.Duration;
            let end = timeline.EndTime().ok()?.Duration;
            let position = timeline.Position().ok()?.Duration;
            Some((position / 10_000_000, (end - start) / 10_000_000))
        })
        .unwrap_or((0, 0));

    Ok(Some(MediaSnapshot {
        title,
        artist,
        source,
        playing: playback_status
            == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing),
        position_seconds,
        duration_seconds,
    }))
}

#[tauri::command]
#[cfg(not(windows))]
async fn get_media_snapshot() -> Result<Option<MediaSnapshot>, String> {
    Ok(None)
}

#[tauri::command]
#[cfg(windows)]
fn toggle_mute() -> Result<(), String> {
    with_audio_endpoint(|endpoint| unsafe {
        endpoint.SetMute(!bool::from(endpoint.GetMute()?), std::ptr::null())
    })
}

#[tauri::command]
#[cfg(not(windows))]
fn toggle_mute() -> Result<(), String> {
    Err("Tính năng này chỉ hỗ trợ Windows".into())
}

#[tauri::command]
#[cfg(windows)]
fn set_volume(volume: u8) -> Result<(), String> {
    with_audio_endpoint(|endpoint| unsafe {
        endpoint.SetMasterVolumeLevelScalar(volume.min(100) as f32 / 100.0, std::ptr::null())
    })
}

#[tauri::command]
#[cfg(not(windows))]
fn set_volume(_volume: u8) -> Result<(), String> {
    Err("Tính năng này chỉ hỗ trợ Windows".into())
}

#[tauri::command]
#[cfg(windows)]
async fn media_control(action: String) -> Result<(), String> {
    let session = current_media_session()?;
    let operation = match action.as_str() {
        "toggle" => session.TryTogglePlayPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "previous" => session.TrySkipPreviousAsync(),
        _ => return Err("Hành động media không hợp lệ".into()),
    }
    .map_err(|error| error.to_string())?;
    operation.join().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
#[cfg(not(windows))]
async fn media_control(_action: String) -> Result<(), String> {
    Err("Tính năng này chỉ hỗ trợ Windows".into())
}

#[tauri::command]
#[cfg(windows)]
fn lock_computer() -> Result<(), String> {
    use windows::Win32::System::Shutdown::LockWorkStation;
    unsafe { LockWorkStation().map_err(|error| error.to_string()) }
}

#[tauri::command]
#[cfg(not(windows))]
fn lock_computer() -> Result<(), String> {
    Err("Tính năng này chỉ hỗ trợ Windows".into())
}

#[tauri::command]
fn open_spotify() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg("spotify:")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Không thể mở Spotify: {error}"))
}

fn ease_in_out_cubic(progress: f64) -> f64 {
    if progress < 0.5 {
        4.0 * progress * progress * progress
    } else {
        1.0 - (-2.0 * progress + 2.0).powi(3) / 2.0
    }
}

fn show_main_window(app: &tauri::AppHandle, open_settings: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        if open_settings {
            let _ = window.emit("open-settings", ());
        }
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app, false);
        }
    }
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };

    let toggle_item = MenuItem::with_id(app, "toggle", "Mở / ẩn Island", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Cài đặt", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle_item, &settings_item, &separator, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Dynamic Island")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_main_window(app),
            "settings" => show_main_window(app, true),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
#[cfg(windows)]
async fn animate_island(window: tauri::WebviewWindow, open: bool) -> Result<(), String> {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos},
    };

    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let native_handle = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
    let (logical_width, logical_height) = if open { (680.0, 660.0) } else { (328.0, 56.0) };
    let target_width = (logical_width * scale).round() as i32;
    let target_height = (logical_height * scale).round() as i32;
    let start_width = size.width as i32;
    let start_height = size.height as i32;
    let center_x = position.x + start_width / 2;
    let top = position.y;
    let frames = 18;
    let frame_delay = if open { 15 } else { 13 };

    tauri::async_runtime::spawn_blocking(move || {
        let hwnd = HWND(native_handle as *mut std::ffi::c_void);
        for frame in 1..=frames {
            let progress = frame as f64 / frames as f64;
            let eased = ease_in_out_cubic(progress);
            let width =
                (start_width as f64 + (target_width - start_width) as f64 * eased).round() as i32;
            let height = (start_height as f64 + (target_height - start_height) as f64 * eased)
                .round() as i32;
            let left = center_x - width / 2;

            unsafe {
                SetWindowPos(
                    hwnd,
                    None,
                    left,
                    top,
                    width,
                    height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                )
                .map_err(|error| error.to_string())?;
            }

            if frame < frames {
                std::thread::sleep(std::time::Duration::from_millis(frame_delay));
            }
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
#[cfg(not(windows))]
fn animate_island(window: tauri::WebviewWindow, open: bool) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize};

    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let (width, height) = if open { (680.0, 660.0) } else { (328.0, 56.0) };
    let center_x = position.x as f64 / scale + size.width as f64 / scale / 2.0;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(
            center_x - width / 2.0,
            position.y as f64 / scale,
        ))
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_autostart::MacosLauncher;

    let state = AppState {
        monitor: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app, false);
        }))
        .manage(state)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            create_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_snapshot,
            get_media_snapshot,
            toggle_mute,
            set_volume,
            media_control,
            lock_computer,
            open_spotify,
            animate_island
        ])
        .run(tauri::generate_context!())
        .expect("error while running Dynamic Island");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_snapshot_returns_sane_values() {
        let snapshot = collect_system_snapshot(Arc::new(Mutex::new(None)))
            .expect("system snapshot should be available on Windows");

        assert!((0.0..=100.0).contains(&snapshot.cpu_percent));
        assert!((0.0..=100.0).contains(&snapshot.memory_percent));
        assert!(snapshot.memory_total_gb >= snapshot.memory_used_gb);
        assert!(snapshot.audio.volume <= 100);
        if let Some(battery) = snapshot.battery {
            assert!(battery.percent <= 100);
        }
    }
}
