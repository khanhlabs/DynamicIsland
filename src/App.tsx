import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Battery, BatteryCharging, Gauge,
  LockKeyhole, Music2, Pause, Play, Power, RotateCcw, Settings,
  SkipBack, SkipForward, Volume2, VolumeX, Zap,
} from "lucide-react";
import "./App.css";

type SystemData = {
  cpuPercent: number; memoryPercent: number; memoryUsedGb: number; memoryTotalGb: number;
  temperatureCelsius: number | null; downloadBytesPerSecond: number; uploadBytesPerSecond: number;
  battery: { percent: number; charging: boolean; remainingMinutes: number | null } | null;
  audio: { volume: number; muted: boolean };
};
type MediaData = {
  title: string; artist: string; source: string; playing: boolean;
  positionSeconds: number; durationSeconds: number;
};
type Hotkeys = { toggleIsland: string; media: string; lock: string; spotify: string };
type Modules = { battery: boolean; media: boolean; pomodoro: boolean };
type NotificationPreferences = { pomodoro: boolean; lowBattery: boolean; fullyCharged: boolean };
type UpdateStatus = "idle" | "checking" | "available" | "installing" | "current" | "error" | "development";
type PomodoroState = {
  mode: "focus" | "break"; running: boolean; secondsLeft: number; endAt: number | null;
};

const DEFAULT_HOTKEYS: Hotkeys = {
  toggleIsland: "Ctrl+Alt+Space", media: "Ctrl+Alt+P",
  lock: "Ctrl+Alt+L", spotify: "Ctrl+Alt+S",
};
const DEFAULT_MODULES: Modules = { battery: true, media: true, pomodoro: true };
const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pomodoro: true, lowBattery: true, fullyCharged: false,
};
const AUTOSTART_PREFERENCE_KEY = "dynamic-island-autostart";
const INITIAL_SYSTEM: SystemData = {
  cpuPercent: 10, memoryPercent: 70, memoryUsedGb: 10.6, memoryTotalGb: 15.2,
  temperatureCelsius: null, downloadBytesPerSecond: 287744, uploadBytesPerSecond: 36864,
  battery: { percent: 92, charging: true, remainingMinutes: 180 }, audio: { volume: 32, muted: false },
};
const appWindow = getCurrentWindow();

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch { return fallback; }
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function formatTimer(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function formatMediaTime(seconds?: number) {
  if (!seconds || seconds < 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds}` : `${minutes}:${remainingSeconds}`;
}

function appName(source: string) {
  const lower = source.toLowerCase();
  if (lower.includes("spotify")) return "Spotify";
  if (lower.includes("chrome")) return "Google Chrome";
  if (lower.includes("edge")) return "Microsoft Edge";
  if (!source) return "Microsoft Edge";
  const parts = source.split("!")[0].split(".");
  return parts[parts.length - 1] || source;
}

/* Custom SVG Icons for exact visual matching */
function SpotifyIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.495 17.303a.753.753 0 0 1-1.034.25c-2.83-1.728-6.392-2.119-10.59-1.16a.75.75 0 0 1-.334-1.462c4.597-1.05 8.536-.607 11.708 1.338a.75.75 0 0 1 .25 1.034zm1.467-3.26a.94.94 0 0 1-1.293.312c-3.238-1.99-8.174-2.566-12.004-1.402a.938.938 0 1 1-.548-1.794c4.375-1.332 9.814-.687 13.533 1.59a.94.94 0 0 1 .312 1.294zm.126-3.395c-3.882-2.305-10.29-2.518-14.004-1.39a1.125 1.125 0 1 1-.655-2.153c4.27-1.297 11.34-1.047 15.794 1.597a1.125 1.125 0 0 1-1.135 1.946z"/>
    </svg>
  );
}

function EdgeIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="10" fill="#0284c7" />
      <path d="M12 6C8.7 6 6 8.7 6 12C6 14.5 7.5 16.7 9.8 17.5C9.3 16.2 9.5 14.5 10.5 13.5C11.5 12.5 13 12.5 14 13.5C14.7 14.2 15 15.2 15 16.2C17.4 15.2 18 13.5 18 12C18 8.7 15.3 6 12 6Z" fill="#38bdf8" />
    </svg>
  );
}

function TomatoIcon({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2C12 4.2 10.5 5.5 9 6M12 2C12 4.2 13.5 5.5 15 6M12 2V5.5" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 6C7.6 6 4 9.4 4 13.6C4 18 7.6 21 12 21C16.4 21 20 18 20 13.6C20 9.4 16.4 6 12 6Z" fill="#8b5cf6" />
      <path d="M7 11C7 9.5 8.5 8 10 7.5" stroke="#c4b5fd" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function BatteryWave() {
  return (
    <svg className="battery-wave-svg" viewBox="0 0 140 46" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="batteryGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 36 C 25 36, 40 12, 65 22 C 90 32, 110 8, 140 14 L 140 46 L 0 46 Z" fill="url(#batteryGrad)" />
      <path d="M0 36 C 25 36, 40 12, 65 22 C 90 32, 110 8, 140 14" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PomodoroWave() {
  return (
    <svg className="pomodoro-wave-svg" viewBox="0 0 280 80" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="pomoWaveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 55 C 50 55, 80 25, 140 40 C 200 55, 230 18, 280 30 L 280 80 L 0 80 Z" fill="url(#pomoWaveGrad)" />
      <path d="M0 55 C 50 55, 80 25, 140 40 C 200 55, 230 18, 280 30" fill="none" stroke="rgba(96, 165, 250, 0.45)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function App() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "settings">("home");
  const [system, setSystem] = useState<SystemData>(INITIAL_SYSTEM);
  const [media, setMedia] = useState<MediaData | null>(null);
  const [now, setNow] = useState(new Date());
  const [autostart, setAutostart] = useState(() => readStored(AUTOSTART_PREFERENCE_KEY, true));
  const [hotkeys, setHotkeys] = useState<Hotkeys>(() => readStored("dynamic-island-hotkeys", DEFAULT_HOTKEYS));
  const [hotkeyDraft, setHotkeyDraft] = useState<Hotkeys>(hotkeys);
  const [modules, setModules] = useState<Modules>(() => {
    const stored = readStored<Partial<Modules>>("dynamic-island-modules", {});
    return {
      battery: stored.battery ?? DEFAULT_MODULES.battery,
      media: stored.media ?? DEFAULT_MODULES.media,
      pomodoro: stored.pomodoro ?? DEFAULT_MODULES.pomodoro,
    };
  });
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(() => (
    readStored("dynamic-island-notifications", DEFAULT_NOTIFICATION_PREFERENCES)
  ));
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [availableVersion, setAvailableVersion] = useState("");
  const [focusMinutes, setFocusMinutes] = useState(() => readStored("dynamic-island-focus-minutes", 25));
  const [breakMinutes, setBreakMinutes] = useState(() => readStored("dynamic-island-break-minutes", 5));
  const [pomodoro, setPomodoro] = useState<PomodoroState>(() => readStored("dynamic-island-pomodoro", {
    mode: "focus", running: false, secondsLeft: 25 * 60, endAt: null,
  }));
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<number | null>(null);
  const collapseTimer = useRef<number | null>(null);
  const resizing = useRef(false);
  const desiredOpen = useRef(false);
  const renderedOpen = useRef(false);
  const pendingUpdate = useRef<Update | null>(null);
  const lowBatteryNoticeLevel = useRef<number | null>(null);
  const fullBatteryNotified = useRef(false);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const sendNativeNotification = useCallback(async (title: string, body: string) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = await requestPermission() === "granted";
      if (granted) sendNotification({ title, body });
    } catch (error) {
      showNotice(`Không thể gửi thông báo: ${String(error)}`);
    }
  }, [showNotice]);

  const checkForUpdates = useCallback(async (manual = false) => {
    if (import.meta.env.DEV) {
      setUpdateStatus("development");
      if (manual) showNotice("Cập nhật chỉ kiểm tra trên bản đã cài đặt");
      return;
    }

    setUpdateStatus("checking");
    try {
      const update = await check();
      if (pendingUpdate.current) await pendingUpdate.current.close();
      pendingUpdate.current = update;
      if (update) {
        setAvailableVersion(update.version);
        setUpdateStatus("available");
        showNotice(`Có bản cập nhật ${update.version}`);
      } else {
        setAvailableVersion("");
        setUpdateStatus("current");
        if (manual) showNotice("Bạn đang dùng phiên bản mới nhất");
      }
    } catch (error) {
      setUpdateStatus("error");
      if (manual) showNotice(`Không thể kiểm tra cập nhật: ${String(error)}`);
    }
  }, [showNotice]);

  const installAvailableUpdate = useCallback(async () => {
    if (!pendingUpdate.current) return;
    setUpdateStatus("installing");
    try {
      await pendingUpdate.current.downloadAndInstall();
    } catch (error) {
      setUpdateStatus("available");
      showNotice(`Không thể cài cập nhật: ${String(error)}`);
    }
  }, [showNotice]);

  const resizeIsland = useCallback(async (open: boolean) => {
    try {
      await invoke("animate_island", { open });
    } catch { /* Browser preview remains usable. */ }
  }, []);

  const setOpen = useCallback(async (open: boolean) => {
    desiredOpen.current = open;
    if (resizing.current) return;
    resizing.current = true;
    try {
      while (renderedOpen.current !== desiredOpen.current) {
        const nextOpen = desiredOpen.current;
        renderedOpen.current = nextOpen;
        setExpanded(nextOpen);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await resizeIsland(nextOpen);
      }
    } finally {
      resizing.current = false;
    }
  }, [resizeIsland]);

  const cancelAutoCollapse = useCallback(() => {
    if (collapseTimer.current === null) return;
    window.clearTimeout(collapseTimer.current);
    collapseTimer.current = null;
  }, []);

  const expandOnHeaderHover = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".header-power-button")) return;
    cancelAutoCollapse();
    void setOpen(true);
  }, [cancelAutoCollapse, setOpen]);

  const scheduleAutoCollapse = useCallback(() => {
    cancelAutoCollapse();
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      void setOpen(false);
    }, 180);
  }, [cancelAutoCollapse, setOpen]);

  const toggleVisibility = useCallback(async () => {
    try {
      if (await appWindow.isVisible()) await appWindow.hide();
      else { await appWindow.show(); await appWindow.setFocus(); }
    } catch { showNotice("Hotkey chỉ hoạt động trong ứng dụng desktop"); }
  }, [showNotice]);

  const refreshSystem = useCallback(async () => {
    try { setSystem(await invoke<SystemData>("get_system_snapshot")); }
    catch (error) { showNotice(`Không đọc được hệ thống: ${String(error)}`); }
  }, [showNotice]);

  const refreshMedia = useCallback(async () => {
    try { setMedia(await invoke<MediaData | null>("get_media_snapshot")); }
    catch { setMedia(null); }
  }, []);

  const runCommand = useCallback(async (command: string, args?: Record<string, unknown>) => {
    try {
      await invoke(command, args);
      if (command === "toggle_mute" || command === "set_volume") window.setTimeout(() => void refreshSystem(), 120);
      if (command === "media_control") window.setTimeout(() => void refreshMedia(), 180);
    } catch (error) { showNotice(String(error)); }
  }, [refreshMedia, refreshSystem, showNotice]);

  useEffect(() => {
    void refreshSystem(); void refreshMedia();
    const initializeWindow = async () => {
      try {
        const enabled = await isEnabled();
        const shouldEnable = readStored<boolean | null>(AUTOSTART_PREFERENCE_KEY, null) ?? true;
        if (shouldEnable) await enable();
        else if (enabled) await disable();
        localStorage.setItem(AUTOSTART_PREFERENCE_KEY, JSON.stringify(shouldEnable));
        setAutostart(shouldEnable);
      } catch (error) {
        showNotice(`Không thể đồng bộ khởi động cùng Windows: ${String(error)}`);
      }

      try {
        const monitor = await currentMonitor();
        if (!monitor) return;
        const windowSize = await appWindow.outerSize();
        const storedPosition = readStored<{ y: number } | null>("dynamic-island-position", null);
        const centeredX = monitor.workArea.position.x
          + Math.round((monitor.workArea.size.width - windowSize.width) / 2);
        const minY = monitor.workArea.position.y;
        const maxY = minY + Math.max(0, monitor.workArea.size.height - windowSize.height);
        const y = Math.min(maxY, Math.max(minY, storedPosition?.y ?? minY));
        await appWindow.setPosition(new PhysicalPosition(centeredX, y));
      } catch {
        // Keep Tauri's configured position when monitor information is unavailable.
      }
    };
    void initializeWindow();
    let unlistenMoved: (() => void) | undefined;
    void appWindow.onMoved(({ payload }) => {
      localStorage.setItem("dynamic-island-position", JSON.stringify({ y: payload.y }));
    }).then((unlisten) => { unlistenMoved = unlisten; });
    const systemTimer = window.setInterval(() => void refreshSystem(), 2000);
    const mediaTimer = window.setInterval(() => void refreshMedia(), 2500);
    const clockTimer = window.setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(systemTimer); clearInterval(mediaTimer); clearInterval(clockTimer); unlistenMoved?.(); };
  }, [refreshMedia, refreshSystem, showNotice]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("open-settings", () => {
      cancelAutoCollapse();
      setActiveTab("settings");
      void setOpen(true);
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [cancelAutoCollapse, setOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates(), 4000);
    return () => {
      window.clearTimeout(timer);
      if (pendingUpdate.current) void pendingUpdate.current.close();
    };
  }, [checkForUpdates]);

  useEffect(() => {
    localStorage.setItem("dynamic-island-hotkeys", JSON.stringify(hotkeys));
    let cancelled = false;
    const configure = async () => {
      try {
        await unregisterAll();
        if (cancelled) return;
        await register(hotkeys.toggleIsland, (event) => { if (event.state === "Pressed") void toggleVisibility(); });
        await register(hotkeys.media, (event) => { if (event.state === "Pressed") void runCommand("media_control", { action: "toggle" }); });
        await register(hotkeys.lock, (event) => { if (event.state === "Pressed") void runCommand("lock_computer"); });
        await register(hotkeys.spotify, (event) => { if (event.state === "Pressed") void runCommand("open_spotify"); });
      } catch (error) { showNotice(`Không đăng ký được hotkey: ${String(error)}`); }
    };
    void configure();
    return () => { cancelled = true; };
  }, [hotkeys, runCommand, showNotice, toggleVisibility]);

  useEffect(() => { localStorage.setItem("dynamic-island-modules", JSON.stringify(modules)); }, [modules]);
  useEffect(() => {
    localStorage.setItem("dynamic-island-notifications", JSON.stringify(notificationPreferences));
  }, [notificationPreferences]);
  useEffect(() => {
    localStorage.setItem("dynamic-island-focus-minutes", JSON.stringify(focusMinutes));
    localStorage.setItem("dynamic-island-break-minutes", JSON.stringify(breakMinutes));
  }, [breakMinutes, focusMinutes]);
  useEffect(() => { localStorage.setItem("dynamic-island-pomodoro", JSON.stringify(pomodoro)); }, [pomodoro]);

  useEffect(() => {
    const battery = system.battery;
    if (!battery) return;

    if (battery.charging) {
      lowBatteryNoticeLevel.current = null;
      if (battery.percent < 100) fullBatteryNotified.current = false;
      if (notificationPreferences.fullyCharged && battery.percent >= 100 && !fullBatteryNotified.current) {
        fullBatteryNotified.current = true;
        void sendNativeNotification("Pin đã đầy", "Bạn có thể rút sạc khỏi laptop.");
      }
      return;
    }

    fullBatteryNotified.current = false;
    if (!notificationPreferences.lowBattery) {
      lowBatteryNoticeLevel.current = null;
      return;
    }

    const threshold = battery.percent <= 10 ? 10 : battery.percent <= 20 ? 20 : null;
    if (threshold === null) {
      lowBatteryNoticeLevel.current = null;
      return;
    }
    if (lowBatteryNoticeLevel.current === null || threshold < lowBatteryNoticeLevel.current) {
      lowBatteryNoticeLevel.current = threshold;
      void sendNativeNotification(
        `Pin còn ${battery.percent}%`,
        threshold === 10 ? "Hãy cắm sạc ngay." : "Laptop sắp hết pin.",
      );
    }
  }, [
    notificationPreferences.fullyCharged,
    notificationPreferences.lowBattery,
    sendNativeNotification,
    system.battery?.charging,
    system.battery?.percent,
  ]);

  useEffect(() => {
    if (!pomodoro.running || !pomodoro.endAt) return;
    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((pomodoro.endAt! - Date.now()) / 1000));
      if (secondsLeft > 0) {
        setPomodoro((current) => ({ ...current, secondsLeft }));
        return;
      }
      const nextMode = pomodoro.mode === "focus" ? "break" : "focus";
      const nextSeconds = (nextMode === "focus" ? focusMinutes : breakMinutes) * 60;
      setPomodoro({ mode: nextMode, running: false, secondsLeft: nextSeconds, endAt: null });
      void setOpen(true);
      if (notificationPreferences.pomodoro) {
        void sendNativeNotification(
          pomodoro.mode === "focus" ? "Hoàn thành phiên tập trung" : "Hết giờ nghỉ",
          pomodoro.mode === "focus" ? "Nghỉ một chút nhé." : "Sẵn sàng quay lại tập trung.",
        );
      }
      showNotice(pomodoro.mode === "focus" ? "Hết phiên tập trung — nghỉ một chút nhé" : "Hết giờ nghỉ — sẵn sàng tập trung");
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(.08, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + .5);
      } catch { /* The visual completion notice remains available. */ }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [
    breakMinutes,
    focusMinutes,
    notificationPreferences.pomodoro,
    pomodoro.endAt,
    pomodoro.mode,
    pomodoro.running,
    sendNativeNotification,
    setOpen,
    showNotice,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && expanded) void setOpen(false);
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, [expanded, setOpen]);

  useEffect(() => () => {
    if (collapseTimer.current !== null) window.clearTimeout(collapseTimer.current);
  }, []);

  const togglePomodoro = () => setPomodoro((current) => current.running && current.endAt
    ? { ...current, running: false, secondsLeft: Math.max(0, Math.ceil((current.endAt - Date.now()) / 1000)), endAt: null }
    : { ...current, running: true, endAt: Date.now() + current.secondsLeft * 1000 });
  const resetPomodoro = () => setPomodoro((current) => ({
    ...current, running: false,
    secondsLeft: (current.mode === "focus" ? focusMinutes : breakMinutes) * 60, endAt: null,
  }));
  const changePomodoroMode = (mode: "focus" | "break") => setPomodoro({
    mode, running: false, secondsLeft: (mode === "focus" ? focusMinutes : breakMinutes) * 60, endAt: null,
  });
  const setStartup = async (checked: boolean) => {
    try {
      if (checked) await enable(); else await disable();
      localStorage.setItem(AUTOSTART_PREFERENCE_KEY, JSON.stringify(checked));
      setAutostart(checked);
      showNotice(checked ? "Sẽ khởi động cùng Windows" : "Đã tắt khởi động cùng Windows");
    } catch (error) { showNotice(String(error)); }
  };

  const mediaProgress = useMemo(() => !media || media.durationSeconds <= 0
    ? 0 : Math.min(100, (media.positionSeconds / media.durationSeconds) * 100), [media]);
  const pomodoroDuration = (pomodoro.mode === "focus" ? focusMinutes : breakMinutes) * 60;
  const pomodoroProgress = pomodoroDuration > 0
    ? Math.max(0, Math.min(360, (1 - pomodoro.secondsLeft / pomodoroDuration) * 360))
    : 0;
  const collapsedLabel = pomodoro.running
    ? `${pomodoro.mode === "focus" ? "Tập trung" : "Nghỉ"} · ${formatTimer(pomodoro.secondsLeft)}`
    : media?.title;
  const updateDescription: Record<UpdateStatus, string> = {
    idle: "Tự động kiểm tra qua GitHub Releases",
    checking: "Đang kiểm tra phiên bản mới…",
    available: `Sẵn sàng cài phiên bản ${availableVersion}`,
    installing: "Đang tải và cài đặt…",
    current: "Bạn đang dùng phiên bản mới nhất",
    error: "Chưa thể kết nối máy chủ cập nhật",
    development: "Chỉ khả dụng trong bản đã cài đặt",
  };
  const updateBusy = updateStatus === "checking" || updateStatus === "installing";
  const updateButtonLabel = updateStatus === "available"
    ? "Cài đặt"
    : updateStatus === "installing"
      ? "Đang cài…"
      : updateStatus === "checking"
        ? "Đang kiểm tra…"
        : "Kiểm tra";

  return (
    <main className={`island-shell ${expanded ? "expanded" : "collapsed"}`}>
      <section
        className="island"
        aria-label="Dynamic Island"
        onMouseEnter={cancelAutoCollapse}
        onMouseLeave={scheduleAutoCollapse}
      >
        <header className="island-bar" data-tauri-drag-region onMouseEnter={expandOnHeaderHover}>
          <div className="bar-left" data-tauri-drag-region>
            <div className="battery-pill" title={system.battery ? (system.battery.charging ? "Đang sạc" : "Dùng pin") : "Nguồn AC"}>
              {system.battery ? (system.battery.charging ? <BatteryCharging size={16} /> : <Battery size={16} />) : <Zap size={16} />}
              <span>{system.battery ? `${system.battery.percent}%` : "92%"}</span>
            </div>
          </div>

          <div className="bar-center" data-tauri-drag-region>
            {collapsedLabel && (
              <div className="media-pill">
                {pomodoro.running
                  ? <TomatoIcon size={15} className="pill-pomodoro-icon" />
                  : <Music2 className="pill-music-icon" size={15} />}
                <span className="pill-title" title={collapsedLabel}>{collapsedLabel}</span>
                <span className={`pill-live-dot ${media?.playing || pomodoro.running ? "active" : ""}`} />
              </div>
            )}
          </div>

          <div className="bar-right">
            <div className="clock-group">
              <time className="clock-time">{formatClock(now)}</time>
              <span className="clock-date">{formatDate(now)}</span>
            </div>
            <button
              className="header-power-button"
              aria-label="Tắt Dynamic Island"
              title="Tắt Dynamic Island"
              onClick={() => void appWindow.close()}
            >
              <Power size={15} />
            </button>
          </div>
        </header>

        <div className={`expanded-content ${activeTab}-view`} aria-hidden={!expanded}>
          <nav className="tabs" aria-label="Điều hướng">
            <button className={activeTab === "home" ? "active" : ""} onClick={() => setActiveTab("home")}><Gauge size={16} /> Tổng quan</button>
            <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}><Settings size={16} /> Cài đặt</button>
          </nav>

          {activeTab === "home" ? (
            <div className="dashboard">
              {modules.media && (
                <article className={`media-card ${media ? "" : "media-card-empty"}`}>
                  {media ? (
                    <>
                      <div className="album-art">
                        <Music2 size={32} />
                      </div>
                      <div className="media-info">
                        <div className="media-source-tag">
                          {media.source.toLowerCase().includes("spotify")
                            ? <SpotifyIcon size={14} />
                            : <EdgeIcon size={14} />}
                          <span>{appName(media.source)}</span>
                        </div>
                        <strong className="media-title">{media.title}</strong>
                        {media.artist && <small className="media-artist">{media.artist}</small>}
                        {media.durationSeconds > 0 && (
                          <>
                            <div className="media-progress">
                              <i style={{ width: `${mediaProgress}%` }} />
                            </div>
                            <div className="media-times">
                              <span>{formatMediaTime(media.positionSeconds)}</span>
                              <span>{formatMediaTime(media.durationSeconds)}</span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="media-controls">
                        <button aria-label="Bài trước" onClick={() => void runCommand("media_control", { action: "previous" })}>
                          <SkipBack size={18} />
                        </button>
                        <button
                          className="play"
                          aria-label={media.playing ? "Tạm dừng" : "Phát"}
                          onClick={() => void runCommand("media_control", { action: "toggle" })}
                        >
                          {media.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
                        </button>
                        <button aria-label="Bài tiếp theo" onClick={() => void runCommand("media_control", { action: "next" })}>
                          <SkipForward size={18} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="media-empty-icon"><Music2 size={22} /></div>
                      <div className="media-empty-copy">
                        <strong>Không có nội dung đang phát</strong>
                        <span>Mở Spotify hoặc phát video để điều khiển tại đây</span>
                      </div>
                      <button className="media-empty-action" onClick={() => void runCommand("open_spotify")}>
                        <SpotifyIcon size={16} />
                        <span>Mở Spotify</span>
                      </button>
                    </>
                  )}
                </article>
              )}

              <div className="quick-row">
                <article className="volume-card">
                  <button className="vol-icon-btn" aria-label="Bật hoặc tắt tiếng" onClick={() => void runCommand("toggle_mute")}>
                    {system.audio.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
                  </button>
                  <div className="vol-copy">
                    <span>Âm lượng</span>
                    <strong>{system.audio.muted ? "0%" : `${system.audio.volume}%`}</strong>
                  </div>
                  <div className="vol-slider-wrapper">
                    <input
                      aria-label="Âm lượng"
                      type="range"
                      min="0"
                      max="100"
                      value={system.audio.volume}
                      style={{ "--vol-val": `${system.audio.volume}%` } as React.CSSProperties}
                      onChange={(event) => {
                        const volume = Number(event.target.value);
                        setSystem((current) => ({ ...current, audio: { volume, muted: false } }));
                        void runCommand("set_volume", { volume });
                      }}
                    />
                  </div>
                </article>

                {modules.battery && (
                  <article className="battery-card">
                    <div className="battery-icon-badge">
                      {system.battery?.charging ? <BatteryCharging size={18} /> : <Battery size={18} />}
                    </div>
                    <div className="battery-copy">
                      <span>Pin</span>
                      <strong>{system.battery ? `${system.battery.percent}%` : "92%"}</strong>
                      <div className="battery-status-line">
                        <i className="status-dot green" />
                        <small>{system.battery?.charging ? "Đang sạc" : "Đang sử dụng"}</small>
                      </div>
                    </div>
                    <BatteryWave />
                  </article>
                )}
              </div>

              {modules.pomodoro && (
                <article className={`pomodoro-card ${pomodoro.mode}`}>
                  <div className="pomodoro-ring-wrapper">
                    <div className="pomodoro-ring" style={{ "--progress": `${pomodoroProgress}deg` } as React.CSSProperties}>
                      <div className="pomodoro-ring-center">
                        <TomatoIcon size={28} />
                      </div>
                    </div>
                  </div>
                  <div className="pomodoro-copy">
                    <span className="eyebrow">POMODORO</span>
                    <strong>{pomodoro.mode === "focus" ? "Tập trung" : "Nghỉ ngơi"}</strong>
                    <button
                      className="pomodoro-mode-badge"
                      onClick={() => changePomodoroMode(pomodoro.mode === "focus" ? "break" : "focus")}
                      title="Chuyển chế độ Tập trung / Nghỉ"
                    >
                      <i className={`status-dot ${pomodoro.mode === "focus" ? "purple" : "green"}`} />
                      <span>{pomodoro.running ? "Đang chạy" : pomodoro.mode === "focus" ? "Nghỉ" : "Sẵn sàng tập trung"}</span>
                    </button>
                    <div className="pomodoro-actions">
                      <button className="pomo-btn pomo-btn-primary" onClick={togglePomodoro}>
                        {pomodoro.running ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
                        <span>{pomodoro.running ? "Tạm dừng" : "Bắt đầu"}</span>
                      </button>
                      <button className="pomo-btn pomo-btn-secondary" onClick={resetPomodoro}>
                        <RotateCcw size={14} />
                        <span>Đặt lại</span>
                      </button>
                    </div>
                  </div>

                  <PomodoroWave />

                  <div className="pomodoro-timer-right">
                    <strong className="timer-display">{formatTimer(pomodoro.secondsLeft)}</strong>
                    <button
                      className="pomo-circle-btn"
                      onClick={togglePomodoro}
                      aria-label={pomodoro.running ? "Tạm dừng" : "Bắt đầu"}
                    >
                      {pomodoro.running ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
                    </button>
                  </div>
                </article>
              )}

              <div className="quick-actions-bar">
                <button className="quick-action-item" onClick={() => void runCommand("lock_computer")}>
                  <div className="qa-icon"><LockKeyhole size={18} /></div>
                  <div className="qa-text">
                    <strong>Khóa máy</strong>
                    <kbd>{hotkeys.lock}</kbd>
                  </div>
                </button>

                <button className="quick-action-item" onClick={() => void runCommand("open_spotify")}>
                  <div className="qa-icon qa-spotify"><SpotifyIcon size={18} /></div>
                  <div className="qa-text">
                    <strong>Mở Spotify</strong>
                    <kbd>{hotkeys.spotify}</kbd>
                  </div>
                </button>

                <button className="quick-action-item" onClick={() => setActiveTab("settings")}>
                  <div className="qa-icon"><Settings size={18} /></div>
                  <div className="qa-text">
                    <strong>Cài đặt nhanh</strong>
                    <small>Wi-Fi • Bluetooth • Âm thanh</small>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-panel">
              <div className="settings-column settings-column-left">
                <section className="notification-settings">
                  <div className="section-title"><strong>Thông báo Windows</strong><span>Chỉ báo những sự kiện quan trọng</span></div>
                  <div className="notification-list">
                    {([
                      ["pomodoro", "Pomodoro", "Khi kết thúc một phiên"],
                      ["lowBattery", "Pin yếu", "Khi pin còn 20% hoặc 10%"],
                      ["fullyCharged", "Pin đầy", "Khi pin sạc đạt 100%"],
                    ] as Array<[keyof NotificationPreferences, string, string]>).map(([key, label, description]) => (
                      <div className="notification-option" key={key}>
                        <label htmlFor={`notification-${key}`}>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </label>
                        <label className="switch" htmlFor={`notification-${key}`}>
                          <input
                            id={`notification-${key}`}
                            type="checkbox"
                            checked={notificationPreferences[key]}
                            onChange={(event) => setNotificationPreferences((current) => ({
                              ...current, [key]: event.target.checked,
                            }))}
                          />
                          <i />
                        </label>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="module-settings">
                  <div className="section-title"><strong>Mô-đun hiển thị</strong><span>Chọn nội dung trong bảng mở rộng</span></div>
                  <div className="module-grid">
                    {(Object.keys(modules) as Array<keyof Modules>).map((key) => (
                      <label key={key} className={modules[key] ? "selected" : ""}>
                        <input
                          type="checkbox"
                          checked={modules[key]}
                          onChange={(event) => setModules((current) => ({ ...current, [key]: event.target.checked }))}
                        />
                        {key === "battery" ? "Pin" : key === "media" ? "Media" : "Pomodoro"}
                      </label>
                    ))}
                  </div>
                </section>
                <section className="duration-settings">
                  <div className="section-title"><strong>Thời lượng Pomodoro</strong><span>Đơn vị phút</span></div>
                  <div className="duration-row">
                    <label htmlFor="focus-duration">
                      Tập trung
                      <input
                        id="focus-duration"
                        type="number"
                        min="1"
                        max="120"
                        value={focusMinutes}
                        onChange={(event) => setFocusMinutes(Math.max(1, Number(event.target.value)))}
                      />
                    </label>
                    <label htmlFor="break-duration">
                      Nghỉ
                      <input
                        id="break-duration"
                        type="number"
                        min="1"
                        max="60"
                        value={breakMinutes}
                        onChange={(event) => setBreakMinutes(Math.max(1, Number(event.target.value)))}
                      />
                    </label>
                  </div>
                </section>
              </div>

              <div className="settings-column settings-column-right">
                <section className="startup-settings">
                  <div className="section-heading">
                    <div><strong>Khởi động</strong><span>Chạy nền cùng Windows</span></div>
                    <label className="switch">
                      <input type="checkbox" checked={autostart} onChange={(event) => void setStartup(event.target.checked)} />
                      <i />
                    </label>
                  </div>
                </section>
                <section className="update-settings">
                  <div className="section-heading update-heading">
                    <div><strong>Cập nhật</strong><span>{updateDescription[updateStatus]}</span></div>
                    <button
                      className="update-button"
                      disabled={updateBusy}
                      onClick={() => void (updateStatus === "available" ? installAvailableUpdate() : checkForUpdates(true))}
                    >
                      {updateButtonLabel}
                    </button>
                  </div>
                </section>
                <section className="hotkey-settings">
                  <div className="section-title"><strong>Phím tắt toàn cục</strong><span>Dùng định dạng Ctrl+Alt+K</span></div>
                  <div className="hotkey-list">
                    {([
                      ["toggleIsland", "Mở / ẩn Island"], ["media", "Play / pause"],
                      ["lock", "Khóa máy"], ["spotify", "Mở Spotify"],
                    ] as Array<[keyof Hotkeys, string]>).map(([key, label]) => (
                      <label key={key} htmlFor={`hotkey-${key}`}>
                        <span>{label}</span>
                        <input
                          id={`hotkey-${key}`}
                          value={hotkeyDraft[key]}
                          onChange={(event) => setHotkeyDraft((current) => ({ ...current, [key]: event.target.value }))}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="hotkey-actions">
                    <button className="save-hotkeys" onClick={() => { setHotkeys(hotkeyDraft); showNotice("Đã lưu phím tắt"); }}>Lưu phím tắt</button>
                    <button className="reset-hotkeys" onClick={() => { setHotkeyDraft(DEFAULT_HOTKEYS); setHotkeys(DEFAULT_HOTKEYS); }}>Khôi phục mặc định</button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </section>
      {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}
    </main>
  );
}

export default App;
