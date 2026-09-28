import React from "react";
import ReactDOM from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  AppWindow,
  Bell,
  BellRing,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Box,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Container,
  Copy,
  Cpu,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Film,
  Folder,
  Gauge,
  HardDrive,
  HeartPulse,
  Images,
  LayoutDashboard,
  ArchiveRestore,
  ShieldCheck,
  User,
  Eye,
  EyeOff,
  LogIn,
  Boxes,
  LockKeyhole,
  MemoryStick,
  Monitor,
  Network,
  Pause,
  Play,
  PlayCircle,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Settings,
  Shield,
  Square,
  Terminal,
  Thermometer,
  Utensils,
  Wrench,
  X,
} from "lucide-react";

import { useApps } from "./hooks/useApps";
import { useConfig } from "./hooks/useConfig";
import { useMetrics } from "./hooks/useMetrics";
import { atlasFetch } from "./lib/api";
import type { AtlasApp } from "./types/apps";
import type { StorageItem } from "./types/metrics";
import "./styles.css";
import "./refresh.css";
import { visiblePoll } from "./lib/visiblePoll";

const glass =
  "border border-white/10 bg-[#13141d] shadow-lg";

const categoryOrder = [
  "Core",
  "Cloud",
  "Media",
  "Photos",
  "Monitoring",
  "Security",
  "Documents",
  "Utilities",
  "Applications",
];

type BackupProfile = {
  id: string;
  name: string;
  description: string;
  category: string;
  sourceCount: number;
  state: "ready" | "needs_recipe" | "no_sources";
  stateMessage: string;
  lastBackupAt: string | null;
  lastBackupSizeBytes: number | null;
  lastSnapshotId: string | null;
  canRun: boolean;
};

type BackupCenterStatus = {
  engine: string;
  target: {
    engineAvailable: boolean;
    keyConfigured: boolean;
    targetConfigured: boolean;
    targetPath: string;
    targetSource: string | null;
    repositoryInitialized: boolean;
    message: string;
  };
  profiles: BackupProfile[];
  timestamp: string;
};

type NotificationSeverity = "critical" | "warning" | "info";

type AtlasNotification = {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  source: string;
  createdAt: string;
  actionUrl: string | null;
};

type NotificationCenterStatus = {
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
  notifications: AtlasNotification[];
  timestamp: string;
};

type UpdateState = "unknown" | "current" | "available" | "pinned" | "local" | "error";

type UpdateItem = {
  id: string;
  name: string;
  category: string;
  container: string;
  image: string;
  runningImageId: string | null;
  candidateImageId: string | null;
  state: UpdateState;
  stateMessage: string;
  checkedAt: string | null;
  canCheck: boolean;
};

type UpdateCenterStatus = {
  summary: {
    total: number;
    current: number;
    available: number;
    unchecked: number;
    protected: number;
    errors: number;
  };
  items: UpdateItem[];
  timestamp: string;
};

type SecurityLevel = "good" | "warning" | "critical" | "info";

type SecurityFinding = {
  id: string;
  level: SecurityLevel;
  title: string;
  message: string;
  detail: string | null;
};

type SecurityPublishedPort = {
  container: string;
  image: string;
  privatePort: number;
  publicPort: number;
  protocol: string;
  ip: string | null;
  allInterfaces: boolean;
};

type SecurityCenterStatus = {
  summary: {
    good: number;
    warning: number;
    critical: number;
    info: number;
  };
  firewall: {
    state: "configured" | "not_detected" | "unknown";
    provider: string | null;
    message: string;
  };
  remoteAccess: {
    cloudflared: boolean;
    cloudflaredState: string | null;
    tailscale: boolean;
    sshListening: boolean;
  };
  docker: {
    controlAccess: boolean;
    publishedPorts: SecurityPublishedPort[];
    allInterfacePorts: number;
  };
  findings: SecurityFinding[];
  timestamp: string;
};

type DashboardSectionKey =
  | "metrics"
  | "notifications"
  | "security"
  | "updates"
  | "backups"
  | "storage"
  | "applications";

type DashboardSectionState = Record<DashboardSectionKey, boolean>;

const defaultDashboardSections: DashboardSectionState = {
  metrics: false,
  notifications: false,
  security: false,
  updates: false,
  backups: false,
  storage: false,
  applications: true,
};

function loadDashboardSections(): DashboardSectionState {
  try {
    const saved = window.localStorage.getItem("atlas.dashboard.sections.v1");
    if (!saved) return defaultDashboardSections;
    const parsed = JSON.parse(saved) as Partial<DashboardSectionState>;
    return { ...defaultDashboardSections, ...parsed };
  } catch {
    return defaultDashboardSections;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function CollapsibleSection({
  id,
  eyebrow,
  title,
  summary,
  icon,
  open,
  badge,
  onToggle,
  children,
}: {
  id: DashboardSectionKey;
  eyebrow: string;
  title: string;
  summary: React.ReactNode;
  icon: React.ReactNode;
  open: boolean;
  badge?: React.ReactNode;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = `atlas-section-${id}`;

  return (
    <section id={id} className="mb-5 scroll-mt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className={`${glass} group w-full rounded-[26px] px-5 py-4 text-left transition duration-200 hover:border-white/20 hover:bg-white/[0.085]`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-fuchsia-300">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fuchsia-300/65">{eyebrow}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h2>
                {badge}
              </div>
              <div className="mt-1 truncate text-sm text-white/40">{summary}</div>
            </div>
          </div>

          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/10 text-white/45 transition group-hover:text-white/75">
            {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </span>
        </div>
      </button>

      <div
        id={contentId}
        className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${open ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));

  return (
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-pink-400 to-purple-400 transition-[width] duration-700"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

function getAppIcon(iconName: string, size = 30) {
  const requested = iconName.trim();
  if (/^https?:\/\//i.test(requested)) {
    return <img src={requested} alt="" className="atlas-app-brand-image" loading="lazy" referrerPolicy="no-referrer" />;
  }

  const key = requested.replace(/^lucide:/i, "").replace(/^app:/i, "").toLowerCase();
  const icons: Record<string, React.ReactNode> = {
    activity: <Activity size={size} />,
    app: <AppWindow size={size} />,
    applications: <AppWindow size={size} />,
    box: <Box size={size} />,
    book: <BookOpen size={size} />,
    cloud: <Cloud size={size} />,
    nextcloud: <Cloud size={size} />,
    container: <Container size={size} />,
    containers: <Container size={size} />,
    docker: <Container size={size} />,
    portainer: <Container size={size} />,
    crafty: <Server size={size} />,
    minecraft: <Box size={size} />,
    database: <Database size={size} />,
    file: <FileText size={size} />,
    "file-text": <FileText size={size} />,
    archive: <FileArchive size={size} />,
    backup: <FileArchive size={size} />,
    backups: <FileArchive size={size} />,
    folder: <Folder size={size} />,
    gauge: <Gauge size={size} />,
    cpu: <Cpu size={size} />,
    memory: <MemoryStick size={size} />,
    "memory-stick": <MemoryStick size={size} />,
    "hard-drive": <HardDrive size={size} />,
    storage: <HardDrive size={size} />,
    image: <Images size={size} />,
    images: <Images size={size} />,
    immich: <Images size={size} />,
    camera: <Camera size={size} />,
    photos: <Camera size={size} />,
    film: <Film size={size} />,
    jellyfin: <Film size={size} />,
    play: <PlayCircle size={size} />,
    media: <Film size={size} />,
    monitor: <Monitor size={size} />,
    uptime: <HeartPulse size={size} />,
    "uptime-kuma": <HeartPulse size={size} />,
    status: <HeartPulse size={size} />,
    health: <HeartPulse size={size} />,
    network: <Network size={size} />,
    server: <Server size={size} />,
    settings: <Settings size={size} />,
    shield: <Shield size={size} />,
    security: <Shield size={size} />,
    lock: <LockKeyhole size={size} />,
    vault: <LockKeyhole size={size} />,
    terminal: <Terminal size={size} />,
    dozzle: <Terminal size={size} />,
    recipes: <Utensils size={size} />,
    utensils: <Utensils size={size} />,
    wrench: <Wrench size={size} />,
    updates: <Download size={size} />,
  };

  return icons[key] ?? <Box size={size} />;
}

const dashboardIconBase = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg";

function appBrandSlug(app: AtlasApp): string | null {
  const identity = `${app.name} ${app.container} ${app.image} ${app.icon}`.toLowerCase();
  const matches: Array<[RegExp, string]> = [
    [/jellyfin/, "jellyfin"],
    [/nextcloud/, "nextcloud"],
    [/immich/, "immich"],
    [/portainer/, "portainer"],
    [/crafty/, "crafty-controller"],
    [/uptime[ -]?kuma/, "uptime-kuma"],
    [/dozzle/, "dozzle"],
    [/minecraft/, "minecraft"],
    [/cloudflare|cloudflared/, "cloudflare"],
    [/tailscale/, "tailscale"],
    [/qbit|qbittorrent/, "qbittorrent"],
    [/file[ -]?browser/, "filebrowser"],
    [/mariadb/, "mariadb"],
    [/postgres/, "postgresql"],
    [/redis/, "redis"],
    [/docker/, "docker"],
    [/paperless/, "paperless-ngx"],
    [/stremio/, "stremio"],
    [/sonarr/, "sonarr"],
    [/radarr/, "radarr"],
    [/prowlarr/, "prowlarr"],
    [/bazarr/, "bazarr"],
    [/lidarr/, "lidarr"],
    [/home[ -]?assistant/, "home-assistant"],
  ];
  return matches.find(([pattern]) => pattern.test(identity))?.[1] ?? null;
}

function AppVisualIcon({ app, size = 32 }: { app: AtlasApp; size?: number }) {
  const [brandFailed, setBrandFailed] = React.useState(false);
  const requested = app.icon.trim();
  const explicitUrl = /^https?:\/\//i.test(requested) ? requested : null;
  const brandSlug = appBrandSlug(app);
  const brandUrl = explicitUrl ?? (brandSlug ? `${dashboardIconBase}/${brandSlug}.svg` : null);

  React.useEffect(() => { setBrandFailed(false); }, [brandUrl]);

  if (brandUrl && !brandFailed) {
    return (
      <img
        src={brandUrl}
        alt=""
        className="atlas-app-brand-image atlas-app-brand-image--official"
        style={{ width: size, height: size }}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBrandFailed(true)}
      />
    );
  }
  return <>{getAppIcon(app.icon, size)}</>;
}

function XuanSealMark({ className = "" }: { className?: string }) {
  const uid = React.useId().replace(/:/g, "");
  const glowId = `xuan-glow-${uid}`;
  const ringId = `xuan-ring-${uid}`;

  return (
    <svg
      className={`atlas-myth-mark xuan-seal-mark ${className}`.trim()}
      viewBox="0 0 72 72"
      role="img"
      aria-label="XUAN seal"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="42%" r="66%">
          <stop offset="0%" stopColor="#d8b4fe" stopOpacity=".36" />
          <stop offset="48%" stopColor="#8b5cf6" stopOpacity=".16" />
          <stop offset="100%" stopColor="#09070d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ringId} x1="10" y1="8" x2="62" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d8d4de" stopOpacity=".78" />
          <stop offset=".42" stopColor="#9d6bdb" stopOpacity=".78" />
          <stop offset=".72" stopColor="#c04dff" stopOpacity=".9" />
          <stop offset="1" stopColor="#5e7d73" stopOpacity=".7" />
        </linearGradient>
      </defs>
      <circle cx="36" cy="36" r="32" fill={`url(#${glowId})`} />
      <circle cx="36" cy="36" r="27.4" fill="#0b090f" fillOpacity=".92" stroke={`url(#${ringId})`} strokeWidth="1.25" />
      <circle cx="36" cy="36" r="23.1" fill="none" stroke="#ffffff" strokeOpacity=".08" strokeWidth=".7" strokeDasharray="2 4" />
      <path d="M36 4v7M36 61v7M4 36h7M61 36h7" stroke="#c04dff" strokeOpacity=".7" strokeWidth="1.3" strokeLinecap="round" />
      <text
        x="36"
        y="46.2"
        textAnchor="middle"
        fontSize="31"
        fontWeight="650"
        fill="#f0edf4"
        fontFamily="'Songti SC','Noto Serif CJK SC','Microsoft YaHei','PingFang SC',serif"
        style={{ filter: "drop-shadow(0 0 7px rgba(192,77,255,.45))" }}
      >玄</text>
      <rect x="29.5" y="57.5" width="13" height="8.5" rx="1.5" fill="#0b090f" stroke="#8d6ab8" strokeOpacity=".62" strokeWidth=".75" />
      <path d="M32 60h8M32 63h8M34 58.7v6.2M38 58.7v6.2" stroke="#b88ce0" strokeOpacity=".5" strokeWidth=".6" />
    </svg>
  );
}

function StatusPill({ app }: { app: AtlasApp }) {
  const running = app.state === "running";
  const restarting = app.state === "restarting";
  const unhealthy = app.health === "unhealthy";

  const label = unhealthy
    ? "Unhealthy"
    : running
      ? "Running"
      : restarting
        ? "Restarting"
        : "Offline";

  const classes = unhealthy
    ? "border-red-400/20 bg-red-400/10 text-red-300"
    : running
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : restarting
        ? "border-amber-400/20 bg-amber-400/10 text-amber-300"
        : "border-red-400/20 bg-red-400/10 text-red-300";

  const dot = unhealthy
    ? "bg-red-400"
    : running
      ? "bg-emerald-400"
      : restarting
        ? "bg-amber-400"
        : "bg-red-400";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function AppCard({ app, onDetails }: { app: AtlasApp; onDetails: () => void }) {
  const urlAvailable = app.url && app.url !== "#";

  return (
    <article
      className={`${glass} atlas-app-card-clickable group relative min-h-48 overflow-hidden rounded-[28px] p-5 transition duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.085]`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button")) return;
        onDetails();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        {urlAvailable ? (
          <a
            href={app.url}
            aria-label={`Open ${app.name}`}
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.075] text-fuchsia-300 transition hover:scale-105 hover:border-fuchsia-300/30 hover:bg-fuchsia-400/10 hover:text-pink-200"
          >
            {<AppVisualIcon app={app} size={38} />}
          </a>
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.075] text-fuchsia-300">
            {<AppVisualIcon app={app} size={38} />}
          </div>
        )}

        <StatusPill app={app} />
      </div>

      <button
        type="button"
        onClick={onDetails}
        className="mt-5 block w-full text-left"
      >
        <h3 className="truncate text-lg font-semibold tracking-tight">{app.name}</h3>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-white/45">
          {app.description}
        </p>
      </button>

      <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-4">
        <div className="flex gap-4 text-xs text-white/40">
          <span>{app.resources ? `${app.resources.cpuPercent.toFixed(1)}% CPU` : app.category}</span>
          {app.resources && <span>{formatBytes(app.resources.memoryUsageBytes)} RAM</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDetails}
            className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Details
          </button>
          {urlAvailable && (
            <a
              href={app.url}
              aria-label={`Open ${app.name}`}
              className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.045] text-white/55 transition hover:bg-fuchsia-400/15 hover:text-pink-200"
            >
              <ArrowUpRight size={15} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function DetailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-white/30">{label}</p>
      <div className="mt-2 break-words text-sm font-medium text-white/85">{value}</div>
    </div>
  );
}

function StorageHealthPill({ drive }: { drive: StorageItem }) {
  const presentation = drive.health === "critical"
    ? { label: "Critical", classes: "border-red-400/20 bg-red-400/10 text-red-300", dot: "bg-red-400" }
    : drive.health === "warning"
      ? { label: "Attention", classes: "border-amber-400/20 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" }
      : drive.health === "healthy"
        ? { label: "Healthy", classes: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" }
        : { label: "Unknown", classes: "border-white/10 bg-white/[0.04] text-white/45", dot: "bg-white/35" };

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${presentation.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
      {presentation.label}
    </span>
  );
}

function smartLabel(status: StorageItem["smartStatus"]): string {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "standby") return "Standby";
  if (status === "unsupported") return "Unsupported";
  return "Unavailable";
}

function StorageManager({ drives }: { drives: StorageItem[] }) {
  if (drives.length === 0) {
    return (
      <div className={`${glass} rounded-[28px] p-8 text-sm text-white/45`}>
        XUAN could not read the configured storage mounts.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {drives.map((drive) => (
        <article key={`${drive.name}-${drive.mount}`} className={`${glass} overflow-hidden rounded-[28px] p-6`}>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 items-center gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-fuchsia-300">
                {drive.name.toLowerCase().includes("ssd") ? <HardDrive size={27} /> : <Database size={27} />}
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold">{drive.name}</h3>
                <p className="mt-1 truncate text-sm text-white/40">{drive.model ?? drive.device ?? drive.source ?? "Storage device"}</p>
              </div>
            </div>
            <StorageHealthPill drive={drive} />
          </div>

          <div className="mt-7 flex items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-semibold tracking-tight">{formatBytes(drive.availableBytes)}</p>
              <p className="mt-1 text-sm text-white/40">free of {formatBytes(drive.sizeBytes)}</p>
            </div>
            <strong className="text-lg text-white/70">{drive.usage.toFixed(1)}%</strong>
          </div>
          <ProgressBar value={drive.usage} />

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-3">
              <div className="flex items-center gap-2 text-xs text-white/35"><CheckCircle2 size={14} /> SMART</div>
              <strong className="mt-2 block text-sm">{smartLabel(drive.smartStatus)}</strong>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-3">
              <div className="flex items-center gap-2 text-xs text-white/35"><Thermometer size={14} /> Temp</div>
              <strong className="mt-2 block text-sm">{drive.temperature !== null ? `${drive.temperature.toFixed(0)}°C` : "--"}</strong>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-3">
              <div className="text-xs text-white/35">Filesystem</div>
              <strong className="mt-2 block truncate text-sm">{drive.filesystem ?? "Unknown"}</strong>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-3">
              <div className="text-xs text-white/35">Mount</div>
              <strong className="mt-2 block truncate font-mono text-xs">{drive.mount}</strong>
            </div>
          </div>

          <div className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${drive.health === "critical" ? "border-red-400/20 bg-red-400/10 text-red-200" : drive.health === "warning" ? "border-amber-400/20 bg-amber-400/10 text-amber-200" : "border-white/[0.07] bg-white/[0.025] text-white/45"}`}>
            {drive.health === "critical" || drive.health === "warning" ? <AlertTriangle size={17} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <p>{drive.healthMessage}</p>
              <p className="mt-1 break-all text-xs opacity-60">
                {drive.device ?? drive.source ?? "Device unavailable"}
                {drive.protocol ? ` · ${drive.protocol}` : ""}
                {drive.rotationRate ? ` · ${drive.rotationRate} RPM` : ""}
                {drive.powerOnHours !== null ? ` · ${Math.round(drive.powerOnHours)}h powered on` : ""}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function NotificationCenter({
  status,
  loading,
  error,
  browserAlertsEnabled,
  onToggleBrowserAlerts,
  onRefresh,
}: {
  status: NotificationCenterStatus | null;
  loading: boolean;
  error: string | null;
  browserAlertsEnabled: boolean;
  onToggleBrowserAlerts: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const browserSupported = typeof window !== "undefined" && "Notification" in window;
  const permission = browserSupported ? Notification.permission : "unsupported";

  const severityPresentation: Record<NotificationSeverity, {
    label: string;
    classes: string;
    icon: React.ReactNode;
  }> = {
    critical: {
      label: "Critical",
      classes: "border-red-400/20 bg-red-400/[0.08] text-red-200",
      icon: <AlertTriangle size={17} />,
    },
    warning: {
      label: "Warning",
      classes: "border-amber-400/20 bg-amber-400/[0.08] text-amber-200",
      icon: <AlertTriangle size={17} />,
    },
    info: {
      label: "Info",
      classes: "border-blue-400/20 bg-blue-400/[0.07] text-blue-200",
      icon: <Bell size={17} />,
    },
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => void onToggleBrowserAlerts()}
          disabled={!browserSupported || permission === "denied"}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${browserAlertsEnabled && permission === "granted" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white"}`}
        >
          {browserAlertsEnabled && permission === "granted" ? <BellRing size={14} /> : <Bell size={14} />}
          {!browserSupported
            ? "Browser alerts unsupported"
            : permission === "denied"
              ? "Browser alerts blocked"
              : browserAlertsEnabled && permission === "granted"
                ? "Browser alerts on"
                : "Enable browser alerts"}
        </button>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className={`${glass} overflow-hidden rounded-[28px] p-6`}>
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-white/30">Total</p>
            <strong className="mt-2 block text-2xl">{status?.summary.total ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-red-400/10 bg-red-400/[0.035] p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-red-200/50">Critical</p>
            <strong className="mt-2 block text-2xl text-red-200">{status?.summary.critical ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-amber-400/10 bg-amber-400/[0.035] p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-amber-200/50">Warning</p>
            <strong className="mt-2 block text-2xl text-amber-200">{status?.summary.warning ?? 0}</strong>
          </div>
          <div className="rounded-2xl border border-blue-400/10 bg-blue-400/[0.035] p-4">
            <p className="text-xs uppercase tracking-[0.12em] text-blue-200/50">Info</p>
            <strong className="mt-2 block text-2xl text-blue-200">{status?.summary.info ?? 0}</strong>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {loading && !status && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-5 text-sm text-white/40">
              XUAN is checking system, storage, applications, backups and security...
            </div>
          )}

          {!loading && status && status.notifications.length === 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] px-4 py-4 text-emerald-100">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <strong className="text-sm">Nothing needs your attention</strong>
                <p className="mt-1 text-sm text-emerald-100/55">XUAN has not detected any active warnings or critical conditions.</p>
              </div>
            </div>
          )}

          {(status?.notifications ?? []).map((item) => {
            const presentation = severityPresentation[item.severity];
            return (
              <article key={item.id} className={`flex flex-col gap-4 rounded-2xl border px-4 py-4 md:flex-row md:items-start md:justify-between ${presentation.classes}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 shrink-0">{presentation.icon}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm">{item.title}</strong>
                      <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] opacity-70">
                        {presentation.label}
                      </span>
                      <span className="text-[11px] opacity-45">{item.source}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 opacity-70">{item.message}</p>
                  </div>
                </div>

                {item.actionUrl && (
                  <a
                    href={item.actionUrl}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-current/15 px-3 py-2 text-xs font-medium no-underline opacity-80 transition hover:opacity-100"
                  >
                    Open
                    <ExternalLink size={13} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpdateCenter({
  status,
  loading,
  error,
  unlocked,
  controlConfigured,
  busyId,
  onUnlock,
  onCheck,
  onCheckAll,
  onRefresh,
}: {
  status: UpdateCenterStatus | null;
  loading: boolean;
  error: string | null;
  unlocked: boolean;
  controlConfigured: boolean;
  busyId: string | null;
  onUnlock: (password: string) => Promise<void>;
  onCheck: (id: string) => Promise<void>;
  onCheckAll: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  const [unlockError, setUnlockError] = React.useState<string | null>(null);

  const statePresentation: Record<UpdateState, { label: string; classes: string }> = {
    unknown: { label: "Check required", classes: "border-white/10 bg-white/[0.04] text-white/45" },
    current: { label: "Current", classes: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" },
    available: { label: "Update ready", classes: "border-fuchsia-400/25 bg-fuchsia-400/10 text-pink-200" },
    pinned: { label: "Pinned", classes: "border-cyan-400/20 bg-cyan-400/[0.08] text-cyan-200" },
    local: { label: "XUAN updater", classes: "border-violet-400/20 bg-violet-400/[0.08] text-violet-200" },
    error: { label: "Check failed", classes: "border-red-400/20 bg-red-400/[0.08] text-red-200" },
  };

  async function unlock() {
    try {
      setUnlockError(null);
      await onUnlock(password);
      setPassword("");
    } catch (caught) {
      setUnlockError(caught instanceof Error ? caught.message : "Unable to unlock XUAN controls.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <p className="max-w-3xl text-sm leading-6 text-white/40">
          XUAN checks registry image tags and compares them with the image used by each running container. Checking stages image layers only. It does not replace or restart applications.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void onCheckAll()}
            disabled={!unlocked || busyId !== null || !(status?.items.some((item) => item.canCheck) ?? false)}
            className="inline-flex items-center gap-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-3 py-2 text-xs font-semibold text-pink-200 transition hover:bg-fuchsia-400/15 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Download size={14} />
            {busyId === "all" ? "Checking..." : "Check all images"}
          </button>
        </div>
      </div>

      <div className={`${glass} overflow-hidden rounded-[30px] p-5 md:p-6`}>
        {error && (
          <div className="mb-5 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Apps", status?.summary.total ?? 0],
            ["Current", status?.summary.current ?? 0],
            ["Ready", status?.summary.available ?? 0],
            ["Unchecked", status?.summary.unchecked ?? 0],
            ["Protected", status?.summary.protected ?? 0],
            ["Errors", status?.summary.errors ?? 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-white/[0.07] bg-black/10 p-4">
              <p className="text-xs uppercase tracking-[0.11em] text-white/30">{label}</p>
              <strong className="mt-2 block text-2xl">{value}</strong>
            </div>
          ))}
        </div>

        {!unlocked && (
          <div className="mt-5 rounded-2xl border border-amber-400/15 bg-amber-400/[0.05] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
              <LockKeyhole size={15} />
              Registry checks are protected by your XUAN control password
            </div>
            {controlConfigured ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && password) void unlock();
                  }}
                  placeholder="XUAN control password"
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-fuchsia-300/40"
                />
                <button
                  type="button"
                  onClick={() => void unlock()}
                  disabled={!password}
                  className="rounded-xl bg-fuchsia-500 px-4 py-3 text-sm font-semibold transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Unlock checks
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-amber-200">XUAN control password is not configured.</p>
            )}
            {unlockError && <p className="mt-2 text-sm text-red-300">{unlockError}</p>}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(status?.items ?? []).map((item) => {
            const presentation = statePresentation[item.state];
            const isBusy = busyId === item.id || busyId === "all";
            return (
              <article key={item.id} className="rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{item.name}</h3>
                    <p className="mt-1 truncate font-mono text-xs text-white/35">{item.image}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${presentation.classes}`}>
                    {presentation.label}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-black/10 p-3">
                    <p className="text-xs text-white/30">Running image</p>
                    <strong className="mt-1 block font-mono text-xs text-white/70">{item.runningImageId ?? "Unknown"}</strong>
                  </div>
                  <div className="rounded-xl bg-black/10 p-3">
                    <p className="text-xs text-white/30">Registry/local tag</p>
                    <strong className="mt-1 block font-mono text-xs text-white/70">{item.candidateImageId ?? "Unknown"}</strong>
                  </div>
                </div>

                <p className="mt-4 min-h-10 text-xs leading-5 text-white/40">{item.stateMessage}</p>
                <p className="mt-2 text-[11px] text-white/25">
                  {item.checkedAt ? `Checked ${formatDate(item.checkedAt)}` : "Not checked against registry yet"}
                </p>

                {item.canCheck && (
                  <button
                    type="button"
                    onClick={() => void onCheck(item.id)}
                    disabled={!unlocked || busyId !== null}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <RefreshCw size={15} className={isBusy ? "animate-spin" : ""} />
                    {isBusy ? "Checking image..." : item.state === "available" ? "Check again" : "Check registry"}
                  </button>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-fuchsia-400/15 bg-fuchsia-400/[0.05] px-4 py-3 text-sm leading-6 text-fuchsia-100/70">
          <strong className="text-pink-200">Safe staging:</strong> XUAN downloads newer image layers but deliberately leaves the running container untouched. Apply a prepared update from Portainer by redeploying that stack. Automatic compose-aware redeploys belong to the later XUAN app-management engine.
        </div>
      </div>
    </div>
  );
}

function BackupCenter({
  status,
  loading,
  error,
  unlocked,
  controlConfigured,
  onUnlock,
  onRun,
  onRefresh,
}: {
  status: BackupCenterStatus | null;
  loading: boolean;
  error: string | null;
  unlocked: boolean;
  controlConfigured: boolean;
  onUnlock: (password: string) => Promise<void>;
  onRun: (profileId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [password, setPassword] = React.useState("");
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [busyProfile, setBusyProfile] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function unlock() {
    setUnlockError(null);
    try {
      await onUnlock(password);
      setPassword("");
    } catch (caught) {
      setUnlockError(caught instanceof Error ? caught.message : "Unable to unlock XUAN controls.");
    }
  }

  async function run(profile: BackupProfile) {
    setNotice(null);
    setBusyProfile(profile.id);
    try {
      await onRun(profile.id);
      setNotice(`${profile.name} backup completed.`);
      await onRefresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Backup failed.");
    } finally {
      setBusyProfile(null);
    }
  }

  const readyProfiles = status?.profiles.filter((profile) => profile.state === "ready").length ?? 0;
  const recipeProfiles = status?.profiles.filter((profile) => profile.state === "needs_recipe").length ?? 0;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className={`${glass} overflow-hidden rounded-[28px] p-6`}>
        <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="flex items-start gap-4">
            <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl border ${status?.target.targetConfigured ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"}`}>
              <FileArchive size={26} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">Encrypted backup engine</h3>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${status?.target.targetConfigured ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"}`}>
                  {status?.target.targetConfigured ? "Destination ready" : "Destination required"}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/45">
                {status?.target.message ?? "Checking the XUAN backup engine..."}
              </p>
              {status && (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/35">
                  <span>Engine: {status.target.engineAvailable ? "Restic ready" : "Unavailable"}</span>
                  <span>Encryption: {status.target.keyConfigured ? "Configured" : "Missing"}</span>
                  <span>Repository: {status.target.repositoryInitialized ? "Initialized" : "Not initialized"}</span>
                  <span>Profiles: {readyProfiles} ready · {recipeProfiles} recipe pending</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-black/10 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.12em] text-white/30">Backup mount</p>
            <p className="mt-1 font-mono text-xs text-white/70">{status?.target.targetPath ?? "/mnt/atlas-backup"}</p>
            <p className="mt-1 max-w-72 text-xs text-white/30">
              XUAN deliberately refuses to count your normal system or storage filesystem as a disaster-recovery destination.
            </p>
          </div>
        </div>

        {status?.target.targetConfigured && !unlocked && (
          <div className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
            {controlConfigured ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <label className="min-w-0 flex-1">
                  <span className="text-xs text-white/40">XUAN control password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && password) void unlock();
                    }}
                    placeholder="Unlock Backup Now controls"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-fuchsia-300/40"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void unlock()}
                  disabled={!password}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-fuchsia-500 px-4 py-3 text-sm font-semibold transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <LockKeyhole size={16} />
                  Unlock backups
                </button>
              </div>
            ) : (
              <p className="text-sm text-amber-200">XUAN control password is not configured.</p>
            )}
            {unlockError && <p className="mt-2 text-sm text-red-300">{unlockError}</p>}
          </div>
        )}

        {notice && (
          <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${notice.toLowerCase().includes("completed") ? "border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-200" : "border-amber-400/15 bg-amber-400/[0.06] text-amber-200"}`}>
            {notice}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(status?.profiles ?? []).map((profile) => {
            const ready = profile.state === "ready";
            const needsRecipe = profile.state === "needs_recipe";
            const buttonLabel = !status?.target.targetConfigured
              ? "Connect backup drive"
              : needsRecipe
                ? "Recipe required"
                : profile.state === "no_sources"
                  ? "No sources"
                  : !unlocked
                    ? "Unlock first"
                    : busyProfile === profile.id
                      ? "Backing up..."
                      : "Backup now";

            return (
              <article key={profile.id} className="rounded-[24px] border border-white/[0.07] bg-white/[0.03] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{profile.name}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-white/40">{profile.description}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${ready ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : needsRecipe ? "border-amber-400/20 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/[0.04] text-white/40"}`}>
                    {ready ? "Ready" : needsRecipe ? "Recipe required" : "No sources"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-black/10 p-3">
                    <p className="text-xs text-white/30">Last backup</p>
                    <strong className="mt-1 block text-sm text-white/75">{profile.lastBackupAt ? formatDate(profile.lastBackupAt) : "Never"}</strong>
                  </div>
                  <div className="rounded-xl bg-black/10 p-3">
                    <p className="text-xs text-white/30">Protected sources</p>
                    <strong className="mt-1 block text-sm text-white/75">{profile.sourceCount}</strong>
                  </div>
                </div>

                <p className="mt-4 min-h-10 text-xs leading-5 text-white/35">{profile.stateMessage}</p>

                {profile.lastBackupSizeBytes !== null && (
                  <p className="mt-2 text-xs text-white/35">
                    Last processed: {formatBytes(profile.lastBackupSizeBytes)}
                    {profile.lastSnapshotId ? ` · ${profile.lastSnapshotId.slice(0, 8)}` : ""}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void run(profile)}
                  disabled={!profile.canRun || !unlocked || busyProfile !== null}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-4 py-3 text-sm font-semibold text-pink-200 transition hover:bg-fuchsia-400/15 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {busyProfile === profile.id ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                  {buttonLabel}
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function SecurityCenter({
  status,
  loading,
  error,
  onRefresh,
}: {
  status: SecurityCenterStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}) {
  const presentation: Record<SecurityLevel, { label: string; classes: string; icon: React.ReactNode }> = {
    good: {
      label: "Good",
      classes: "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200",
      icon: <CheckCircle2 size={17} />,
    },
    warning: {
      label: "Warning",
      classes: "border-amber-400/20 bg-amber-400/[0.07] text-amber-200",
      icon: <AlertTriangle size={17} />,
    },
    critical: {
      label: "Critical",
      classes: "border-red-400/20 bg-red-400/[0.08] text-red-200",
      icon: <AlertTriangle size={17} />,
    },
    info: {
      label: "Info",
      classes: "border-blue-400/20 bg-blue-400/[0.06] text-blue-200",
      icon: <Shield size={17} />,
    },
  };

  return (
    <div>
      <div className="mb-4 flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <p className="max-w-3xl text-sm leading-6 text-white/40">
          XUAN audits what it can safely observe from inside its container. Firewall runtime enforcement and router port-forwarding cannot be proven from this view, so uncertain checks are labelled rather than guessed.
        </p>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh audit
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-5 py-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className={`${glass} overflow-hidden rounded-[28px] p-6`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Good", status?.summary.good ?? 0, "text-emerald-200"],
            ["Warnings", status?.summary.warning ?? 0, "text-amber-200"],
            ["Critical", status?.summary.critical ?? 0, "text-red-200"],
            ["Info", status?.summary.info ?? 0, "text-blue-200"],
          ].map(([label, value, classes]) => (
            <div key={String(label)} className="rounded-2xl border border-white/[0.07] bg-black/10 p-4">
              <p className="text-xs uppercase tracking-[0.11em] text-white/30">{label}</p>
              <strong className={`mt-2 block text-2xl ${classes}`}>{value}</strong>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-white/30"><Shield size={14} /> Host firewall</div>
            <strong className="mt-2 block text-sm">{status?.firewall.provider ?? (status?.firewall.state === "not_detected" ? "Not detected" : "Checking...")}</strong>
            <p className="mt-2 text-xs leading-5 text-white/35">{status?.firewall.message ?? "XUAN is checking host firewall configuration."}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-white/30"><Cloud size={14} /> Remote access</div>
            <div className="mt-2 space-y-1 text-sm text-white/70">
              <p>Cloudflare Tunnel: {status?.remoteAccess.cloudflared ? "Detected" : "Not detected"}</p>
              <p>Tailscale: {status?.remoteAccess.tailscale ? "Detected" : "Not detected"}</p>
              <p>SSH listener: {status?.remoteAccess.sshListening ? "Port 22 listening" : "Not detected"}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-white/30"><Container size={14} /> Docker exposure</div>
            <strong className="mt-2 block text-sm">{status?.docker.allInterfacePorts ?? 0} all-interface published ports</strong>
            <p className="mt-2 text-xs leading-5 text-white/35">
              XUAN Docker control: {status?.docker.controlAccess ? "Enabled" : "Unavailable"}. Published ports are LAN/host exposure signals, not proof of Internet exposure.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {loading && !status && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-5 text-sm text-white/40">
              Running XUAN security checks...
            </div>
          )}
          {(status?.findings ?? []).map((finding) => {
            const item = presentation[finding.level];
            return (
              <article key={finding.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-4 ${item.classes}`}>
                <div className="mt-0.5 shrink-0">{item.icon}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{finding.title}</strong>
                    <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] opacity-70">{item.label}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 opacity-70">{finding.message}</p>
                  {finding.detail && <p className="mt-1 break-all font-mono text-[11px] opacity-45">{finding.detail}</p>}
                </div>
              </article>
            );
          })}
        </div>

        {(status?.docker.publishedPorts.length ?? 0) > 0 && (
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.07]">
            <div className="border-b border-white/[0.07] bg-black/10 px-4 py-3 text-xs uppercase tracking-[0.11em] text-white/35">Published Docker ports</div>
            <div className="divide-y divide-white/[0.06]">
              {(status?.docker.publishedPorts ?? []).map((port, index) => (
                <div key={`${port.container}-${port.publicPort}-${port.protocol}-${index}`} className="grid gap-2 px-4 py-3 text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <strong className="block truncate text-white/70">{port.container}</strong>
                    <span className="truncate text-white/30">{port.image}</span>
                  </div>
                  <span className="font-mono text-white/55">{port.ip || "0.0.0.0"}:{port.publicPort} → {port.privatePort}/{port.protocol}</span>
                  <span className={`rounded-full border px-2 py-1 text-[10px] ${port.allInterfaces ? "border-amber-400/15 bg-amber-400/[0.05] text-amber-200" : "border-emerald-400/15 bg-emerald-400/[0.05] text-emerald-200"}`}>
                    {port.allInterfaces ? "All interfaces" : "Specific interface"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LiveLogPanel({
  app,
  unlocked,
  fetchLogs,
}: {
  app: AtlasApp;
  unlocked: boolean;
  fetchLogs: (appId: string, lines: number) => Promise<string>;
}) {
  const [logs, setLogs] = React.useState("");
  const [lineCount, setLineCount] = React.useState(100);
  const [query, setQuery] = React.useState("");
  const [paused, setPaused] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [cleared, setCleared] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  const refresh = React.useCallback(async () => {
    if (!unlocked) return;
    setLoading(true);
    setError(null);
    try {
      const nextLogs = await fetchLogs(app.id, lineCount);
      setLogs(nextLogs);
      setCleared(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load container logs.");
    } finally {
      setLoading(false);
    }
  }, [app.id, fetchLogs, lineCount, unlocked]);

  React.useEffect(() => {
    if (!unlocked) {
      setLogs("");
      setError(null);
      return;
    }

    if (paused) { void refresh(); return; }
    const stopPolling = visiblePoll(refresh, 5000);
    return () => stopPolling();
  }, [paused, refresh, unlocked]);

  React.useEffect(() => {
    if (!viewportRef.current || paused || query.trim()) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [logs, paused, query]);

  const visibleText = cleared ? "" : logs;
  const filteredLines = visibleText
    .split("\n")
    .filter((line) => !query.trim() || line.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredText = filteredLines.join("\n");

  async function copyLogs() {
    if (!filteredText) return;
    try {
      await navigator.clipboard.writeText(filteredText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setError("Your browser blocked clipboard access.");
    }
  }

  function downloadLogs() {
    if (!filteredText) return;
    const blob = new Blob([filteredText], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${app.container}-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="mt-5 rounded-[24px] border border-cyan-300/10 bg-cyan-400/[0.035] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Terminal size={17} className="text-cyan-300" />
            <h3 className="font-semibold">Live logs</h3>
            {unlocked && !paused && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-2 py-0.5 text-[10px] text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-white/40">
            Protected Docker output for {app.container}. Refreshes every 2.5 seconds.
          </p>
        </div>

        {unlocked && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={lineCount}
              onChange={(event) => setLineCount(Number(event.target.value))}
              className="rounded-xl border border-white/10 bg-[#0b0d1a] px-3 py-2 text-xs text-white/65 outline-none"
              aria-label="Log line count"
            >
              <option value={50}>50 lines</option>
              <option value={100}>100 lines</option>
              <option value={250}>250 lines</option>
              <option value={500}>500 lines</option>
            </select>
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.045] text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              aria-label="Refresh logs"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>

      {!unlocked ? (
        <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/10 px-4 py-4 text-sm text-white/45">
          Unlock Admin controls above to view logs. Logs can contain private URLs, file paths or tokens, so XUAN keeps them behind the control password.
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter logs..."
                className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-white/25 focus:border-cyan-300/30"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copyLogs()}
                disabled={!filteredText}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <Copy size={14} />
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={downloadLogs}
                disabled={!filteredText}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
              >
                <Download size={14} />
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setCleared(true);
                  setPaused(true);
                }}
                className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white"
              >
                Clear view
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div
            ref={viewportRef}
            className="mt-3 h-72 overflow-auto rounded-2xl border border-white/[0.07] bg-[#05060d] p-3 font-mono text-[11px] leading-5 md:h-80"
          >
            {loading && !visibleText && !error ? (
              <div className="text-white/35">Loading logs...</div>
            ) : filteredLines.length === 0 || !filteredText ? (
              <div className="text-white/30">
                {cleared ? "Log view cleared and paused. Press Resume when you are ready." : query.trim() ? "No log lines match this filter." : "No log output reported yet."}
              </div>
            ) : (
              filteredLines.map((line, index) => {
                const errorLine = /(error|fatal|failed|exception|panic)/i.test(line);
                const warningLine = /(warn|warning|deprecated)/i.test(line);
                return (
                  <div
                    key={`${index}-${line.slice(0, 32)}`}
                    className={`whitespace-pre-wrap break-all ${errorLine ? "text-red-300" : warningLine ? "text-amber-200" : "text-white/62"}`}
                  >
                    {line || " "}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-white/25">
            <span>{query.trim() ? `${filteredLines.length} matching lines` : `Showing the latest ${lineCount} lines`}</span>
            <span>{paused ? "Auto-refresh paused" : "Auto-refresh active"}</span>
          </div>
        </>
      )}
    </div>
  );
}

function AppDetails({
  app,
  onClose,
  controlConfigured,
  controlUnlocked,
  onUnlock,
  onLock,
  onAction,
  onFetchLogs,
}: {
  app: AtlasApp;
  onClose: () => void;
  controlConfigured: boolean;
  controlUnlocked: boolean;
  onUnlock: (password: string) => Promise<void>;
  onLock: () => void;
  onAction: (action: "start" | "stop" | "restart") => Promise<void>;
  onFetchLogs: (appId: string, lines: number) => Promise<string>;
}) {
  const [password, setPassword] = React.useState("");
  const [controlError, setControlError] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<"start" | "stop" | "restart" | "unlock" | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const urlAvailable = app.url && app.url !== "#";

  async function unlockControls(event: React.FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusyAction("unlock");
    setControlError(null);
    setNotice(null);
    try {
      await onUnlock(password);
      setPassword("");
      setNotice("Admin controls unlocked for this browser session.");
    } catch (caught) {
      setControlError(caught instanceof Error ? caught.message : "Unable to unlock XUAN controls.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runAction(action: "start" | "stop" | "restart") {
    if (action === "stop" && !window.confirm(`Stop ${app.name}?`)) return;
    setBusyAction(action);
    setControlError(null);
    setNotice(null);
    try {
      await onAction(action);
      setNotice(
        action === "start"
          ? `${app.name} start requested.`
          : action === "stop"
            ? `${app.name} stop requested.`
            : `${app.name} restart requested.`,
      );
    } catch (caught) {
      setControlError(caught instanceof Error ? caught.message : "XUAN could not complete that action.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${app.name} details`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`${glass} max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-[32px] bg-[#0b0d1a]/95 p-6 md:rounded-[32px] md:p-8`}>
        <div className="flex items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.075] text-fuchsia-300">
              {<AppVisualIcon app={app} size={34} />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="truncate text-2xl font-bold tracking-tight">{app.name}</h2>
                <StatusPill app={app} />
              </div>
              <p className="mt-1 text-sm text-white/45">{app.description}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X size={19} />
          </button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
          <DetailStat label="Container" value={app.container} />
          <DetailStat label="Version" value={app.version} />
          <DetailStat label="CPU" value={app.resources ? `${app.resources.cpuPercent.toFixed(1)}%` : "Unavailable"} />
          <DetailStat label="Memory" value={app.resources ? formatBytes(app.resources.memoryUsageBytes) : "Unavailable"} />
        </div>

        {app.resources && (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/55">CPU usage</span>
                <strong>{app.resources.cpuPercent.toFixed(1)}%</strong>
              </div>
              <ProgressBar value={app.resources.cpuPercent} />
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/55">Memory usage</span>
                <strong>{app.resources.memoryPercent.toFixed(1)}%</strong>
              </div>
              <p className="mt-1 text-xs text-white/35">
                {formatBytes(app.resources.memoryUsageBytes)} of {formatBytes(app.resources.memoryLimitBytes)}
              </p>
              <ProgressBar value={app.resources.memoryPercent} />
            </div>
          </div>
        )}

        <div className="mt-5 rounded-[24px] border border-fuchsia-300/10 bg-fuchsia-400/[0.045] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <LockKeyhole size={17} className="text-fuchsia-300" />
                <h3 className="font-semibold">Admin controls</h3>
              </div>
              <p className="mt-1 text-sm text-white/40">
                Start, stop or restart this application through Docker.
              </p>
            </div>
            {controlUnlocked && (
              <button
                type="button"
                onClick={() => {
                  onLock();
                  setNotice("Admin controls locked.");
                }}
                className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-white/55 transition hover:bg-white/10 hover:text-white"
              >
                Lock controls
              </button>
            )}
          </div>

          {!controlConfigured ? (
            <div className="mt-4 rounded-2xl border border-amber-400/15 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-200">
              Controls are not configured yet. Run the XUAN updater again to create the control password.
            </div>
          ) : !app.controllable ? (
            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/10 px-4 py-3 text-sm text-white/45">
              This application is protected from XUAN control actions.
            </div>
          ) : !controlUnlocked ? (
            <form onSubmit={unlockControls} className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="XUAN control password"
                autoComplete="current-password"
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-fuchsia-300/40"
              />
              <button
                type="submit"
                disabled={!password || busyAction !== null}
                className="rounded-2xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "unlock" ? "Unlocking..." : "Unlock controls"}
              </button>
            </form>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                disabled={app.state === "running" || app.state === "restarting" || busyAction !== null}
                onClick={() => void runAction("start")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Power size={16} />
                {busyAction === "start" ? "Starting..." : "Start"}
              </button>
              <button
                type="button"
                disabled={app.state !== "running" || busyAction !== null}
                onClick={() => void runAction("restart")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/10 px-4 py-3 text-sm font-semibold text-pink-200 transition hover:bg-fuchsia-400/15 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <RotateCw size={16} className={busyAction === "restart" ? "animate-spin" : ""} />
                {busyAction === "restart" ? "Restarting..." : "Restart"}
              </button>
              <button
                type="button"
                disabled={(app.state !== "running" && app.state !== "restarting") || busyAction !== null}
                onClick={() => void runAction("stop")}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Square size={15} />
                {busyAction === "stop" ? "Stopping..." : "Stop"}
              </button>
            </div>
          )}

          {controlError && (
            <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/[0.07] px-4 py-3 text-sm text-red-200">
              {controlError}
            </div>
          )}
          {notice && !controlError && (
            <div className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-3 text-sm text-emerald-200">
              {notice}
            </div>
          )}
        </div>

        <LiveLogPanel app={app} unlocked={controlUnlocked} fetchLogs={onFetchLogs} />

        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] p-5">
            <h3 className="font-semibold">Application</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-white/35">Image</dt>
                <dd className="break-all text-white/75">{app.image}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-white/35">Status</dt>
                <dd className="text-white/75">{app.status}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-white/35">Created</dt>
                <dd className="text-white/75">{formatDate(app.createdAt)}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-24 shrink-0 text-white/35">Category</dt>
                <dd className="text-white/75">{app.category}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[24px] border border-white/[0.07] bg-white/[0.035] p-5">
            <h3 className="font-semibold">Network</h3>
            <div className="mt-4 space-y-2">
              {app.ports.length > 0 ? (
                app.ports.map((port, index) => (
                  <div key={`${port.privatePort}-${port.publicPort}-${index}`} className="flex items-center justify-between rounded-xl bg-black/15 px-3 py-2 text-sm">
                    <span className="text-white/45">{port.protocol.toUpperCase()}</span>
                    <span className="font-mono text-white/75">
                      {port.publicPort ? `${port.publicPort} → ` : ""}{port.privatePort}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/35">No published ports reported.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-white/[0.07] bg-white/[0.035] p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Storage mounts</h3>
            <span className="text-xs text-white/30">{app.mounts.length}</span>
          </div>
          <div className="mt-4 space-y-2">
            {app.mounts.length > 0 ? (
              app.mounts.map((mount, index) => (
                <div key={`${mount.destination}-${index}`} className="grid gap-1 rounded-xl bg-black/15 px-3 py-3 text-sm md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-3">
                  <span className="break-all text-white/55">{mount.source}</span>
                  <span className="hidden text-white/20 md:inline">→</span>
                  <span className="break-all font-mono text-xs text-white/75">{mount.destination}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-white/35">No mounts reported for this container.</p>
            )}
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.045] px-5 py-3 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
          {urlAvailable && (
            <a
              href={app.url}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white no-underline transition hover:bg-fuchsia-400"
            >
              Open {app.name}
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </section>
    </div>
  );
}


type PerformancePoint = {
  cpu: number;
  memory: number;
  at: number;
};

function chartPoints(values: number[]): string {
  if (values.length < 2) return "0,28 100,28";
  return values
    .map((rawValue, index) => {
      const value = Math.min(100, Math.max(0, Number.isFinite(rawValue) ? rawValue : 0));
      const x = (index / (values.length - 1)) * 100;
      const y = 40 - (value / 100) * 40;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function OverviewMetricCard({
  label,
  value,
  note,
  progress,
  icon,
  ring = false,
}: {
  label: string;
  value: string;
  note: string;
  progress: number;
  icon: React.ReactNode;
  ring?: boolean;
}) {
  const safeProgress = Math.min(100, Math.max(0, Number.isFinite(progress) ? progress : 0));

  return (
    <article className="atlas-overview-card">
      <div className="atlas-overview-card__top">
        {ring ? (
          <div
            className="atlas-ring"
            style={{
              background: `conic-gradient(#f472b6 ${safeProgress}%, rgba(255,255,255,0.07) ${safeProgress}% 100%)`,
            }}
          >
            <span className="atlas-ring__inner">{icon}</span>
          </div>
        ) : (
          <div className="atlas-card-icon">{icon}</div>
        )}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
      {!ring && (
        <div className="atlas-progress">
          <span style={{ width: `${safeProgress}%` }} />
        </div>
      )}
    </article>
  );
}

type RouteKey =
  | "dashboard"
  | "system"
  | "applications"
  | "containers"
  | "storage"
  | "network"
  | "backups"
  | "security"
  | "updates"
  | "notifications"
  | "settings";

type WidgetSize = "small" | "medium" | "wide";
type WidgetAccent = "pink" | "purple" | "blue" | "amber" | "slate";
type WidgetKind =
  | "cpu"
  | "memory"
  | "uptime"
  | "storage"
  | "services"
  | "network"
  | "containers"
  | "performance"
  | "notifications"
  | "backup"
  | "security"
  | "app";

type DashboardWidget = {
  id: string;
  kind: WidgetKind;
  size: WidgetSize;
  accent: WidgetAccent;
  icon: string;
  iconUrl?: string;
  title?: string;
  appContainer?: string;
};

const widgetStorageKey = "xuan.dashboard.widgets.v3";
const legacyWidgetStorageKey = "atlas.dashboard.widgets.v2";

const defaultWidgets: DashboardWidget[] = [
  { id: "cpu", kind: "cpu", size: "small", accent: "purple", icon: "cpu" },
  { id: "memory", kind: "memory", size: "small", accent: "purple", icon: "memory-stick" },
  { id: "uptime", kind: "uptime", size: "small", accent: "slate", icon: "activity" },
  { id: "services", kind: "services", size: "small", accent: "slate", icon: "status" },
  { id: "storage", kind: "storage", size: "medium", accent: "purple", icon: "hard-drive" },
];

const widgetIconOptions = [
  "auto",
  "gauge",
  "server",
  "activity",
  "status",
  "hard-drive",
  "database",
  "network",
  "container",
  "cloud",
  "media",
  "play",
  "images",
  "camera",
  "folder",
  "file-text",
  "shield",
  "lock",
  "terminal",
  "wrench",
];

function loadWidgets(): DashboardWidget[] {
  try {
    const raw = window.localStorage.getItem(widgetStorageKey) ?? window.localStorage.getItem(legacyWidgetStorageKey);
    if (!raw) return defaultWidgets;
    const parsed = JSON.parse(raw) as DashboardWidget[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultWidgets;
  } catch {
    return defaultWidgets;
  }
}

function routeFromPath(pathname: string): RouteKey {
  const first = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const routes: RouteKey[] = [
    "dashboard",
    "system",
    "applications",
    "containers",
    "storage",
    "network",
    "backups",
    "security",
    "updates",
    "notifications",
    "settings",
  ];
  return routes.includes(first as RouteKey) ? (first as RouteKey) : "dashboard";
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function nextWidgetSize(size: WidgetSize): WidgetSize {
  if (size === "small") return "medium";
  if (size === "medium") return "wide";
  return "small";
}

function WidgetIcon({
  widget,
  fallback,
  size = 20,
}: {
  widget: DashboardWidget;
  fallback: string;
  size?: number;
}) {
  if (widget.iconUrl?.trim()) {
    return <img src={widget.iconUrl.trim()} alt="" className="atlas-widget-custom-icon" />;
  }
  const icon = widget.icon === "auto" ? fallback : widget.icon;
  return <>{getAppIcon(icon || fallback, size)}</>;
}

function WidgetEditor({
  widget,
  app,
  onChange,
  onRemove,
  onClose,
}: {
  widget: DashboardWidget;
  app: AtlasApp | null;
  onChange: (patch: Partial<DashboardWidget>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div className="atlas-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="atlas-widget-editor" role="dialog" aria-modal="true" aria-label="Customize widget">
        <div className="atlas-modal-title">
          <div>
            <span>Widget settings</span>
            <h2>{widget.title || app?.name || widget.kind}</h2>
          </div>
          <button type="button" onClick={onClose} className="atlas-icon-button"><X size={17} /></button>
        </div>

        <label className="atlas-field">
          <span>Title</span>
          <input
            value={widget.title ?? ""}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder={app?.name ?? widget.kind.charAt(0).toUpperCase() + widget.kind.slice(1)}
          />
        </label>

        <div className="atlas-field-grid">
          <label className="atlas-field">
            <span>Size</span>
            <select value={widget.size} onChange={(event) => onChange({ size: event.target.value as WidgetSize })}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="wide">Wide</option>
            </select>
          </label>
          <label className="atlas-field">
            <span>Accent</span>
            <select value={widget.accent} onChange={(event) => onChange({ accent: event.target.value as WidgetAccent })}>
              <option value="pink">Pink</option>
              <option value="purple">Purple</option>
              <option value="blue">Blue</option>
              <option value="amber">Amber</option>
              <option value="slate">Slate</option>
            </select>
          </label>
        </div>

        <label className="atlas-field">
          <span>Built-in icon</span>
          <select value={widget.icon} onChange={(event) => onChange({ icon: event.target.value })}>
            {widgetIconOptions.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
          </select>
        </label>

        <label className="atlas-field">
          <span>Custom icon URL <small>optional</small></span>
          <input
            value={widget.iconUrl ?? ""}
            onChange={(event) => onChange({ iconUrl: event.target.value })}
            placeholder="https://.../icon.png"
          />
        </label>

        <div className="atlas-widget-editor__footer">
          <button type="button" className="atlas-danger-button" onClick={onRemove}>Remove widget</button>
          <button type="button" className="atlas-primary-button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  );
}

function WidgetLibrary({
  apps,
  existing,
  onAdd,
  onClose,
}: {
  apps: AtlasApp[];
  existing: DashboardWidget[];
  onAdd: (widget: DashboardWidget) => void;
  onClose: () => void;
}) {
  const existingIds = new Set(existing.map((item) => item.id));
  const systemWidgets: Array<{ kind: WidgetKind; title: string; description: string; icon: string; size: WidgetSize; accent: WidgetAccent }> = [
    { kind: "cpu", title: "CPU", description: "Live processor load and temperature", icon: "gauge", size: "small", accent: "pink" },
    { kind: "memory", title: "Memory", description: "RAM usage at a glance", icon: "server", size: "small", accent: "purple" },
    { kind: "uptime", title: "Uptime", description: "How long XUAN has been online", icon: "activity", size: "small", accent: "slate" },
    { kind: "storage", title: "Storage", description: "System SSD and storage HDD usage", icon: "hard-drive", size: "medium", accent: "purple" },
    { kind: "services", title: "Services", description: "Online and unhealthy XUAN apps", icon: "status", size: "small", accent: "pink" },
    { kind: "network", title: "Network", description: "Live upload and download rates", icon: "network", size: "medium", accent: "blue" },
    { kind: "containers", title: "Containers", description: "Docker running and stopped counts", icon: "container", size: "small", accent: "purple" },
    { kind: "performance", title: "Performance", description: "Live CPU and memory graph", icon: "activity", size: "wide", accent: "pink" },
    { kind: "notifications", title: "Attention", description: "Critical and warning notifications", icon: "status", size: "small", accent: "amber" },
    { kind: "backup", title: "Backups", description: "Backup destination and profile status", icon: "archive", size: "medium", accent: "purple" },
    { kind: "security", title: "Security", description: "Security findings summary", icon: "shield", size: "small", accent: "pink" },
  ];

  return (
    <div className="atlas-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="atlas-widget-library" role="dialog" aria-modal="true" aria-label="Widget library">
        <div className="atlas-modal-title">
          <div><span>Customize dashboard</span><h2>Widget Library</h2></div>
          <button type="button" onClick={onClose} className="atlas-icon-button"><X size={17} /></button>
        </div>

        <div className="atlas-library-section">
          <h3>System</h3>
          <div className="atlas-library-grid">
            {systemWidgets.map((item) => {
              const id = `system:${item.kind}`;
              const already = existingIds.has(id) || existing.some((widget) => widget.kind === item.kind && widget.kind !== "app");
              return (
                <article key={item.kind} className="atlas-library-item">
                  <span className="atlas-library-icon">{getAppIcon(item.icon, 18)}</span>
                  <div><strong>{item.title}</strong><p>{item.description}</p></div>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => onAdd({ id, kind: item.kind, size: item.size, accent: item.accent, icon: item.icon })}
                  >{already ? "Added" : "+ Add"}</button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="atlas-library-section">
          <h3>Installed applications <span>{apps.length}</span></h3>
          <div className="atlas-library-grid">
            {apps.map((app) => {
              const id = `app:${app.container}`;
              const already = existingIds.has(id);
              return (
                <article key={app.container} className="atlas-library-item">
                  <span className="atlas-library-icon"><AppVisualIcon app={app} size={20} /></span>
                  <div><strong>{app.name}</strong><p>{app.category} · {app.state === "running" ? "Online" : "Offline"}</p></div>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => onAdd({
                      id,
                      kind: "app",
                      size: "small",
                      accent: "purple",
                      icon: "auto",
                      appContainer: app.container,
                    })}
                  >{already ? "Added" : "+ Add"}</button>
                </article>
              );
            })}
            {apps.length === 0 && <p className="atlas-empty-note">No XUAN/Atlas-labelled applications are available yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function XuanDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [route, setRoute] = React.useState<RouteKey>(() => routeFromPath(window.location.pathname));
  const [query, setQuery] = React.useState("");
  const [applicationsIssuesOnly, setApplicationsIssuesOnly] = React.useState(false);
  const [selectedApp, setSelectedApp] = React.useState<AtlasApp | null>(null);
  const [controlConfigured, setControlConfigured] = React.useState(false);
  const [controlKey, setControlKey] = React.useState(() => window.sessionStorage.getItem("xuan.controlKey") ?? window.sessionStorage.getItem("atlas.controlKey") ?? "");
  const [backupStatus, setBackupStatus] = React.useState<BackupCenterStatus | null>(null);
  const [backupLoading, setBackupLoading] = React.useState(true);
  const [backupError, setBackupError] = React.useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = React.useState<NotificationCenterStatus | null>(null);
  const [notificationsLoading, setNotificationsLoading] = React.useState(true);
  const [notificationsError, setNotificationsError] = React.useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = React.useState<UpdateCenterStatus | null>(null);
  const [updatesLoading, setUpdatesLoading] = React.useState(true);
  const [updatesError, setUpdatesError] = React.useState<string | null>(null);
  const [busyUpdateId, setBusyUpdateId] = React.useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = React.useState<SecurityCenterStatus | null>(null);
  const [securityLoading, setSecurityLoading] = React.useState(true);
  const [securityError, setSecurityError] = React.useState<string | null>(null);
  const [browserAlertsEnabled, setBrowserAlertsEnabled] = React.useState(() => (window.localStorage.getItem("xuan.browserAlerts") ?? window.localStorage.getItem("atlas.browserAlerts")) === "true");
  const [widgets, setWidgets] = React.useState<DashboardWidget[]>(loadWidgets);
  const [customizing, setCustomizing] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const [editingWidgetId, setEditingWidgetId] = React.useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [performanceHistory, setPerformanceHistory] = React.useState<PerformancePoint[]>([]);
  const [clock, setClock] = React.useState(() => new Date());
  const draggedWidgetId = React.useRef<string | null>(null);
  const previousNotificationIds = React.useRef<Set<string> | null>(null);

  const config = useConfig();
  const { apps, loading: appsLoading, error: appsError, refresh: refreshApps } = useApps();
  const { metrics, error: metricsError } = useMetrics();

  React.useEffect(() => {
    return visiblePoll(async () => { setClock(new Date()); }, 30000);
  }, []);

  React.useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(widgetStorageKey, JSON.stringify(widgets));
    } catch {
      // Local dashboard preferences are best effort.
    }
  }, [widgets]);

  React.useEffect(() => {
    if (!metrics.system) return;
    setPerformanceHistory((current) => [
      ...current,
      { cpu: metrics.system!.cpu.usage, memory: metrics.system!.memory.usage, at: Date.now() },
    ].slice(-72));
  }, [metrics.system?.cpu.usage, metrics.system?.memory.usage]);

  React.useEffect(() => {
    let active = true;
    atlasFetch("/api/control/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Control status unavailable.");
        return response.json() as Promise<{ configured: boolean }>;
      })
      .then((body) => { if (active) setControlConfigured(Boolean(body.configured)); })
      .catch(() => { if (active) setControlConfigured(false); });
    return () => { active = false; };
  }, []);

  const loadSecurityStatus = React.useCallback(async (): Promise<void> => {
    setSecurityLoading(true);
    try {
      const response = await atlasFetch("/api/security", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as SecurityCenterStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Security status failed (${response.status}).`);
      setSecurityStatus(body);
      setSecurityError(null);
    } catch (caught) {
      setSecurityError(caught instanceof Error ? caught.message : "Unable to load Security Center.");
    } finally {
      setSecurityLoading(false);
    }
  }, []);

  React.useEffect(() => {
    return visiblePoll(loadSecurityStatus, 60000);
  }, [loadSecurityStatus]);

  const loadNotifications = React.useCallback(async (): Promise<void> => {
    setNotificationsLoading(true);
    try {
      const response = await atlasFetch("/api/notifications", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as NotificationCenterStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Notification status failed (${response.status}).`);

      const currentIds = new Set((body.notifications ?? []).map((item) => item.id));
      if (
        previousNotificationIds.current !== null && browserAlertsEnabled &&
        "Notification" in window && Notification.permission === "granted"
      ) {
        for (const item of body.notifications ?? []) {
          if (item.severity === "info" || previousNotificationIds.current.has(item.id)) continue;
          try { new Notification(`XUAN · ${item.title}`, { body: item.message, tag: item.id }); } catch { /* best effort */ }
        }
      }
      previousNotificationIds.current = currentIds;
      setNotificationStatus(body);
      setNotificationsError(null);
    } catch (caught) {
      setNotificationsError(caught instanceof Error ? caught.message : "Unable to load Notification Center.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [browserAlertsEnabled]);

  React.useEffect(() => {
    return visiblePoll(loadNotifications, 30000, browserAlertsEnabled);
  }, [loadNotifications]);

  const loadUpdateStatus = React.useCallback(async (): Promise<void> => {
    setUpdatesLoading(true);
    try {
      const response = await atlasFetch("/api/updates/status", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as UpdateCenterStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Update status failed (${response.status}).`);
      setUpdateStatus(body);
      setUpdatesError(null);
    } catch (caught) {
      setUpdatesError(caught instanceof Error ? caught.message : "Unable to load Update Center.");
    } finally {
      setUpdatesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    return visiblePoll(loadUpdateStatus, 120000);
  }, [loadUpdateStatus]);

  const loadBackupStatus = React.useCallback(async (): Promise<void> => {
    setBackupLoading(true);
    try {
      const response = await atlasFetch("/api/backups/status", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as BackupCenterStatus & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Backup status failed (${response.status}).`);
      setBackupStatus(body);
      setBackupError(null);
    } catch (caught) {
      setBackupError(caught instanceof Error ? caught.message : "Unable to load Backup Center.");
    } finally {
      setBackupLoading(false);
    }
  }, []);

  React.useEffect(() => {
    return visiblePoll(loadBackupStatus, 60000);
  }, [loadBackupStatus]);

  function navigate(next: RouteKey): void {
    setMobileMenuOpen(false);
    setCustomizing(false);
    setLibraryOpen(false);
    const path = `/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleBrowserAlerts(): Promise<void> {
    if (!("Notification" in window)) return;
    if (browserAlertsEnabled && Notification.permission === "granted") {
      window.localStorage.setItem("xuan.browserAlerts", "false");
      setBrowserAlertsEnabled(false);
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    window.localStorage.setItem("xuan.browserAlerts", enabled ? "true" : "false");
    setBrowserAlertsEnabled(enabled);
  }

  async function unlockControls(password: string): Promise<void> {
    const response = await atlasFetch("/api/control/verify", { method: "POST", headers: { "x-xuan-control-key": password } });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Unlock failed (${response.status}).`);
    window.sessionStorage.setItem("xuan.controlKey", password);
    setControlKey(password);
  }

  function lockControls(): void {
    window.sessionStorage.removeItem("xuan.controlKey");
      window.sessionStorage.removeItem("atlas.controlKey");
    setControlKey("");
  }

  async function controlSelectedApp(action: "start" | "stop" | "restart"): Promise<void> {
    if (!selectedApp) return;
    if (!controlKey) throw new Error("Unlock XUAN controls first.");
    const response = await atlasFetch(`/api/apps/${selectedApp.id}/actions/${action}`, {
      method: "POST",
      headers: { "x-xuan-control-key": controlKey },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401 || response.status === 429) lockControls();
    if (!response.ok) throw new Error(body.error ?? `Action failed (${response.status}).`);
    await refreshApps();
    window.setTimeout(() => void refreshApps(), 1200);
  }

  async function fetchAppLogs(appId: string, lines: number): Promise<string> {
    if (!controlKey) throw new Error("Unlock XUAN controls first.");
    const response = await atlasFetch(`/api/apps/${appId}/logs?lines=${encodeURIComponent(lines)}`, {
      method: "GET", cache: "no-store", headers: { "x-xuan-control-key": controlKey },
    });
    const body = (await response.json().catch(() => ({}))) as { logs?: string; error?: string };
    if (response.status === 401 || response.status === 429) lockControls();
    if (!response.ok) throw new Error(body.error ?? `Log request failed (${response.status}).`);
    return body.logs ?? "";
  }

  async function runBackup(profileId: string): Promise<void> {
    if (!controlKey) throw new Error("Unlock XUAN controls first.");
    const response = await atlasFetch(`/api/backups/${encodeURIComponent(profileId)}/run`, {
      method: "POST", headers: { "x-xuan-control-key": controlKey },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401 || response.status === 429) lockControls();
    if (!response.ok) throw new Error(body.error ?? `Backup failed (${response.status}).`);
    await loadBackupStatus();
  }

  async function checkUpdate(appId: string): Promise<void> {
    if (!controlKey) throw new Error("Unlock XUAN controls first.");
    setBusyUpdateId(appId);
    try {
      const response = await atlasFetch(`/api/updates/${encodeURIComponent(appId)}/check`, {
        method: "POST", headers: { "x-xuan-control-key": controlKey },
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401 || response.status === 429) lockControls();
      if (!response.ok) throw new Error(body.error ?? `Update check failed (${response.status}).`);
      await loadUpdateStatus();
      await loadNotifications();
    } finally {
      setBusyUpdateId(null);
    }
  }

  async function checkAllUpdates(): Promise<void> {
    if (!controlKey) throw new Error("Unlock XUAN controls first.");
    const ids = (updateStatus?.items ?? []).filter((item) => item.canCheck).map((item) => item.id);
    setBusyUpdateId("all");
    try {
      for (const appId of ids) {
        const response = await atlasFetch(`/api/updates/${encodeURIComponent(appId)}/check`, {
          method: "POST", headers: { "x-xuan-control-key": controlKey },
        });
        if (response.status === 401 || response.status === 429) {
          lockControls();
          throw new Error("XUAN controls were locked. Unlock them and try again.");
        }
      }
      await loadUpdateStatus();
      await loadNotifications();
    } finally {
      setBusyUpdateId(null);
    }
  }

  React.useEffect(() => {
    if (!selectedApp) return;
    const refreshed = apps.find((app) => app.container === selectedApp.container);
    if (refreshed) setSelectedApp(refreshed);
  }, [apps, selectedApp?.container]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setLibraryOpen(false);
        setEditingWidgetId(null);
        setMobileMenuOpen(false);
      }
      if (event.key === "/" && route === "applications") {
        const target = event.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          event.preventDefault();
          document.querySelector<HTMLInputElement>("#atlas-search")?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [route]);

  const filteredApps = apps.filter((app) => {
    const matchesQuery = [
      app.name, app.description, app.category, app.container, app.image, app.state, app.status, ...app.keywords,
    ].join(" ").toLowerCase().includes(query.trim().toLowerCase());
    const hasIssue = app.state !== "running" || app.health === "unhealthy";
    return matchesQuery && (!applicationsIssuesOnly || hasIssue);
  });

  const groupedApps = filteredApps.reduce<Record<string, AtlasApp[]>>((groups, app) => {
    const category = app.category || "Applications";
    groups[category] ??= [];
    groups[category].push(app);
    return groups;
  }, {});
  const appGroups = (Object.entries(groupedApps) as Array<[string, AtlasApp[]]>).sort(([first], [second]) => {
    const firstIndex = categoryOrder.indexOf(first);
    const secondIndex = categoryOrder.indexOf(second);
    if (firstIndex === -1 && secondIndex === -1) return first.localeCompare(second);
    if (firstIndex === -1) return 1;
    if (secondIndex === -1) return -1;
    return firstIndex - secondIndex;
  });

  const systemDrive = metrics.storage.find((drive) => drive.name === "System SSD" || drive.mount === "/host/root");
  const storageDrive = metrics.storage.find((drive) => drive.name === "Storage HDD" || drive.mount === "/host/storage");
  const runningApps = apps.filter((app) => app.state === "running" && app.health !== "unhealthy").length;
  const unhealthyApps = apps.filter((app) => app.state !== "running" || app.health === "unhealthy").length;
  const attentionCount = (notificationStatus?.summary.critical ?? 0) + (notificationStatus?.summary.warning ?? 0);
  const allHealthy = apps.length > 0 && unhealthyApps === 0 && attentionCount === 0;
  const cpuNow = metrics.system?.cpu.usage ?? 0;
  const memoryNow = metrics.system?.memory.usage ?? 0;
  const cpuChart = chartPoints(performanceHistory.map((point) => point.cpu));
  const memoryChart = chartPoints(performanceHistory.map((point) => point.memory));

  const routeMeta: Record<RouteKey, { title: string; subtitle: string }> = {
    dashboard: { title: "Dashboard", subtitle: "Still, focused, and aware of what matters." },
    system: { title: "System", subtitle: "Live processor, memory and host information." },
    applications: { title: "Applications", subtitle: "Everything XUAN discovered from your Docker labels." },
    containers: { title: "Containers", subtitle: "Docker runtime status without the dashboard clutter." },
    storage: { title: "Storage", subtitle: "Capacity, SMART health and filesystem details." },
    network: { title: "Network", subtitle: "Live traffic and remote-access status." },
    backups: { title: "Backups", subtitle: "Your backup destination, profiles and recent snapshots." },
    security: { title: "Security", subtitle: "Warnings, exposure and access checks." },
    updates: { title: "Updates", subtitle: "Check application images without leaving XUAN." },
    notifications: { title: "Notifications", subtitle: "Only the things that deserve your attention." },
    settings: { title: "Settings", subtitle: "Personalize how XUAN behaves on this device." },
  };

  const navItems: Array<{ key: RouteKey; label: string; icon: React.ReactNode }> = [
    { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
    { key: "applications", label: "Applications", icon: <AppWindow size={17} /> },
    { key: "containers", label: "Containers", icon: <Boxes size={17} /> },
    { key: "storage", label: "Storage", icon: <HardDrive size={17} /> },
    { key: "network", label: "Network", icon: <Network size={17} /> },
    { key: "backups", label: "Backups", icon: <ArchiveRestore size={17} /> },
    { key: "security", label: "Security", icon: <ShieldCheck size={17} /> },
    { key: "updates", label: "Updates", icon: <Download size={17} /> },
    { key: "settings", label: "Settings", icon: <Settings size={17} /> },
  ];

  function updateWidget(id: string, patch: Partial<DashboardWidget>): void {
    setWidgets((current) => current.map((widget) => widget.id === id ? { ...widget, ...patch } : widget));
  }

  function removeWidget(id: string): void {
    setWidgets((current) => current.filter((widget) => widget.id !== id));
    setEditingWidgetId(null);
  }

  function addWidget(widget: DashboardWidget): void {
    setWidgets((current) => current.some((item) => item.id === widget.id) ? current : [...current, widget]);
  }

  function moveWidget(id: string, direction: -1 | 1): void {
    setWidgets((current) => {
      const index = current.findIndex((widget) => widget.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  function dropWidget(targetId: string): void {
    const sourceId = draggedWidgetId.current;
    draggedWidgetId.current = null;
    if (!sourceId || sourceId === targetId) return;
    setWidgets((current) => {
      const sourceIndex = current.findIndex((widget) => widget.id === sourceId);
      const targetIndex = current.findIndex((widget) => widget.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const copy = [...current];
      const [moved] = copy.splice(sourceIndex, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  }

  function resetDashboard(): void {
    setWidgets(defaultWidgets);
    setCustomizing(false);
  }

  function openApplications(showIssuesOnly = false): void {
    setApplicationsIssuesOnly(showIssuesOnly);
    if (showIssuesOnly) setQuery("");
    navigate("applications");
  }

  function openWidgetDetails(widget: DashboardWidget, app: AtlasApp | null): void {
    if (customizing) return;
    switch (widget.kind) {
      case "cpu":
      case "memory":
      case "uptime":
      case "performance":
        navigate("system");
        break;
      case "services":
        openApplications(unhealthyApps > 0);
        break;
      case "storage":
        navigate("storage");
        break;
      case "network":
        navigate("network");
        break;
      case "containers":
        navigate("containers");
        break;
      case "notifications":
        navigate("notifications");
        break;
      case "backup":
        navigate("backups");
        break;
      case "security":
        navigate("security");
        break;
      case "app":
        if (app) setSelectedApp(app);
        else openApplications(false);
        break;
    }
  }

  function renderWidget(widget: DashboardWidget): React.ReactNode {
    const app = widget.kind === "app"
      ? apps.find((candidate) => candidate.container === widget.appContainer) ?? null
      : null;
    const title = widget.title?.trim() || app?.name || ({
      cpu: "CPU",
      memory: "Memory",
      uptime: "Uptime",
      storage: "Storage",
      services: "Services",
      network: "Network",
      containers: "Containers",
      performance: "Performance",
      notifications: "Attention",
      backup: "Backups",
      security: "Security",
      app: "Application",
    } as Record<WidgetKind, string>)[widget.kind];

    const iconFallback = app?.icon || ({
      cpu: "gauge", memory: "server", uptime: "activity", storage: "hard-drive", services: "status",
      network: "network", containers: "container", performance: "activity", notifications: "status",
      backup: "archive", security: "shield", app: "box",
    } as Record<WidgetKind, string>)[widget.kind];

    let content: React.ReactNode;
    if (widget.kind === "cpu") {
      content = <><strong className="atlas-widget-value">{metrics.system ? `${metrics.system.cpu.usage.toFixed(0)}%` : "--"}</strong><p>{metrics.system?.cpu.temperature ? `${metrics.system.cpu.temperature.toFixed(0)}°C` : "Temperature unavailable"}</p><ProgressBar value={metrics.system?.cpu.usage ?? 0} /></>;
    } else if (widget.kind === "memory") {
      content = <><strong className="atlas-widget-value">{metrics.system ? `${metrics.system.memory.usage.toFixed(0)}%` : "--"}</strong><p>{metrics.system ? `${formatBytes(metrics.system.memory.usedBytes)} of ${formatBytes(metrics.system.memory.totalBytes)}` : "Memory unavailable"}</p><ProgressBar value={metrics.system?.memory.usage ?? 0} /></>;
    } else if (widget.kind === "uptime") {
      content = <><strong className="atlas-widget-value">{metrics.system ? formatUptime(metrics.system.uptimeSeconds) : "--"}</strong><p>{metrics.system?.hostname ?? "homeserver"}</p></>;
    } else if (widget.kind === "services") {
      content = <><strong className="atlas-widget-value">{apps.length ? `${runningApps}/${apps.length}` : "--"}</strong><p>{unhealthyApps ? `${unhealthyApps} need attention` : "All discovered services healthy"}</p><div className="atlas-mini-status-row"><span className="online">{runningApps} online</span>{unhealthyApps > 0 && <span className="warning">{unhealthyApps} issue{unhealthyApps === 1 ? "" : "s"}</span>}</div></>;
    } else if (widget.kind === "storage") {
      content = <div className="atlas-storage-widget">
        {[systemDrive, storageDrive].filter(Boolean).map((drive) => drive && (
          <div key={drive.mount} className="atlas-storage-widget__row">
            <div><span>{drive.name}</span><strong>{drive.usage.toFixed(0)}%</strong></div>
            <div className="atlas-progress"><span style={{ width: `${drive.usage}%` }} /></div>
            <small>{formatBytes(drive.usedBytes)} of {formatBytes(drive.sizeBytes)}</small>
          </div>
        ))}
        {!systemDrive && !storageDrive && <p>Storage metrics unavailable.</p>}
      </div>;
    } else if (widget.kind === "network") {
      content = <div className="atlas-network-widget">
        <div><span>Download</span><strong>↓ {metrics.system?.network ? formatRate(metrics.system.network.rxBytesPerSecond) : "--"}</strong></div>
        <div><span>Upload</span><strong>↑ {metrics.system?.network ? formatRate(metrics.system.network.txBytesPerSecond) : "--"}</strong></div>
        <small>{metrics.system?.network?.interface ?? "No active interface"}</small>
      </div>;
    } else if (widget.kind === "containers") {
      content = <><strong className="atlas-widget-value">{metrics.docker ? `${metrics.docker.running}/${metrics.docker.total}` : "--"}</strong><p>{metrics.docker ? `${metrics.docker.stopped} stopped · ${metrics.docker.restarting} restarting` : "Docker unavailable"}</p></>;
    } else if (widget.kind === "performance") {
      content = <div className="atlas-mini-chart">
        <div className="atlas-mini-chart__legend"><span>CPU {cpuNow.toFixed(0)}%</span><span>RAM {memoryNow.toFixed(0)}%</span></div>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="CPU and memory performance">
          <polyline className="atlas-chart-line memory" points={memoryChart} />
          <polyline className="atlas-chart-line cpu" points={cpuChart} />
        </svg>
        {performanceHistory.length < 2 && <small>Collecting samples…</small>}
      </div>;
    } else if (widget.kind === "notifications") {
      content = <><strong className="atlas-widget-value">{attentionCount}</strong><p>{attentionCount ? `${notificationStatus?.summary.critical ?? 0} critical · ${notificationStatus?.summary.warning ?? 0} warning` : "Nothing needs attention"}</p></>;
    } else if (widget.kind === "backup") {
      const readyProfiles = backupStatus?.profiles.filter((profile) => profile.canRun).length ?? 0;
      content = <><strong className="atlas-widget-value">{backupStatus?.target.targetConfigured ? "Ready" : "Not ready"}</strong><p>{backupStatus?.target.message ?? "Checking backup destination…"}</p><small>{readyProfiles} runnable profile{readyProfiles === 1 ? "" : "s"}</small></>;
    } else if (widget.kind === "security") {
      const critical = securityStatus?.summary.critical ?? 0;
      const warning = securityStatus?.summary.warning ?? 0;
      content = <><strong className="atlas-widget-value">{critical + warning}</strong><p>{critical ? `${critical} critical finding${critical === 1 ? "" : "s"}` : warning ? `${warning} warning${warning === 1 ? "" : "s"}` : "No active security warnings"}</p></>;
    } else {
      const online = app?.state === "running" && app.health !== "unhealthy";
      content = app ? <>
        <div className="atlas-app-widget-state"><strong>{online ? "Online" : app.state === "restarting" ? "Restarting" : "Offline"}</strong><span className={online ? "online" : "warning"}><i />{app.container}</span></div>
        <p>{app.description}</p>
        <div className="atlas-app-widget-actions">
          <button type="button" onClick={() => setSelectedApp(app)}>Details</button>
          {app.url && app.url !== "#" && <a href={app.url}>Open <ArrowUpRight size={13} /></a>}
        </div>
      </> : <><strong className="atlas-widget-value">Unavailable</strong><p>The application is no longer discovered by XUAN.</p></>;
    }

    return (
      <article
        key={widget.id}
        className={`atlas-dashboard-widget size-${widget.size} ${customizing ? "is-editing" : "is-clickable"}`}
        data-accent={widget.accent}
        draggable={customizing}
        role={customizing ? undefined : "button"}
        tabIndex={customizing ? -1 : 0}
        aria-label={customizing ? undefined : `Open ${title} details`}
        onClick={(event) => {
          if (customizing) return;
          const target = event.target as HTMLElement;
          if (target.closest("button, a, input, select")) return;
          openWidgetDetails(widget, app);
        }}
        onKeyDown={(event) => {
          if (!customizing && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openWidgetDetails(widget, app);
          }
        }}
        onDragStart={() => { draggedWidgetId.current = widget.id; }}
        onDragOver={(event) => customizing && event.preventDefault()}
        onDrop={() => customizing && dropWidget(widget.id)}
      >
        <div className="atlas-widget-head">
          <span className="atlas-widget-icon"><WidgetIcon widget={widget} fallback={iconFallback} /></span>
          <div><h3>{title}</h3>{app && <span>{app.category}</span>}</div>
          {customizing && <div className="atlas-widget-edit-controls">
            <button type="button" title="Move left" onClick={() => moveWidget(widget.id, -1)}>←</button>
            <button type="button" title="Move right" onClick={() => moveWidget(widget.id, 1)}>→</button>
            <button type="button" title="Resize" onClick={() => updateWidget(widget.id, { size: nextWidgetSize(widget.size) })}>↔</button>
            <button type="button" title="Widget settings" onClick={() => setEditingWidgetId(widget.id)}><Settings size={13} /></button>
          </div>}
          {!customizing && <ArrowUpRight size={14} className="atlas-widget-open-hint" aria-hidden="true" />}
        </div>
        <div className="atlas-widget-body">{content}</div>
        {customizing && <div className="atlas-widget-drag-hint">⋮⋮ drag to reorder</div>}
      </article>
    );
  }

  function dashboardPage(): React.ReactNode {
    return <section className="atlas-page atlas-dashboard-page">
      <div className="atlas-dashboard-welcome">
        <div>
          <button
            type="button"
            className={`atlas-health-line ${allHealthy ? "healthy" : "attention"} ${allHealthy ? "" : "is-actionable"}`}
            onClick={() => {
              if (attentionCount > 0) navigate("notifications");
              else if (unhealthyApps > 0) openApplications(true);
            }}
            disabled={allHealthy}
          ><i />{allHealthy ? "Everything looks good" : attentionCount ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention` : unhealthyApps ? `${unhealthyApps} service${unhealthyApps === 1 ? "" : "s"} need attention` : "XUAN is checking your services"}</button>
          <h2>{greetingFor(clock)}, <em>{config.owner}</em></h2>
          <p>Your server. Everything in view.</p>
        </div>
        <div className="atlas-dashboard-actions">
          {customizing && <button type="button" className="atlas-ghost-button" onClick={() => setLibraryOpen(true)}>+ Add widget</button>}
          <button
            type="button"
            className={customizing ? "atlas-primary-button" : "atlas-icon-button atlas-dashboard-customize"}
            aria-label={customizing ? "Finish customizing dashboard" : "Customize dashboard"}
            title={customizing ? "Done" : "Customize dashboard"}
            onClick={() => setCustomizing((value) => !value)}
          ><Wrench size={15} />{customizing && <span>Done</span>}</button>
        </div>
      </div>

      {metricsError && <div className="atlas-inline-warning">{metricsError}</div>}

      {(() => {
        const visibleWidgets = widgets.filter((widget) => widget.kind !== "notifications" || attentionCount > 0 || customizing);
        return visibleWidgets.length > 0
          ? <div className="atlas-widget-grid">{visibleWidgets.map(renderWidget)}</div>
          : <div className="atlas-empty-dashboard"><Gauge size={28} /><h3>Your dashboard is empty</h3><p>Add only the widgets that matter to you.</p><button type="button" className="atlas-primary-button" onClick={() => { setCustomizing(true); setLibraryOpen(true); }}>Add a widget</button></div>;
      })()}

      {!customizing && (() => {
        const preferredNames = ["jellyfin", "nextcloud", "immich", "portainer", "crafty", "uptime", "dozzle"];
        const dashboardApps = [...apps]
          .sort((a, b) => {
            const aText = `${a.name} ${a.container}`.toLowerCase();
            const bText = `${b.name} ${b.container}`.toLowerCase();
            const aRank = preferredNames.findIndex((name) => aText.includes(name));
            const bRank = preferredNames.findIndex((name) => bText.includes(name));
            return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank) || a.name.localeCompare(b.name);
          })
          .slice(0, 6);
        const diskIssue = metrics.storage.some((drive) => drive.health === "critical" || drive.health === "warning");
        const networkOnline = Boolean(metrics.system?.network?.interface);
        const securityIssues = (securityStatus?.summary.critical ?? 0) + (securityStatus?.summary.warning ?? 0);

        return <div className="xuan-dashboard-main-grid">
          <section className="xuan-apps-panel atlas-panel">
            <div className="xuan-section-heading">
              <div><span>Quick launch</span><h3>Applications</h3><p>Your most-used XUAN services, at a glance.</p></div>
              <button type="button" onClick={() => openApplications(false)}>View all <ArrowUpRight size={14} /></button>
            </div>
            <div className="xuan-app-launch-grid">
              {dashboardApps.map((app) => {
                const online = app.state === "running" && app.health !== "unhealthy";
                const urlAvailable = app.url && app.url !== "#";
                return <article
                  key={app.container}
                  className="xuan-app-launch-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => urlAvailable ? window.location.assign(app.url) : setSelectedApp(app)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); urlAvailable ? window.location.assign(app.url) : setSelectedApp(app); } }}
                >
                  <span className="xuan-app-launch-icon"><AppVisualIcon app={app} size={42} /></span>
                  <strong>{app.name}</strong>
                  <span className={online ? "online" : "warning"}><i />{online ? "Running" : app.state === "restarting" ? "Restarting" : "Offline"}</span>
                  <button type="button" aria-label={`View ${app.name} details`} onClick={(event) => { event.stopPropagation(); setSelectedApp(app); }}><ArrowUpRight size={13} /></button>
                </article>;
              })}
              {dashboardApps.length === 0 && <button type="button" className="xuan-app-launch-empty" onClick={() => openApplications(false)}><AppWindow size={22} /><span>No labelled applications yet</span></button>}
            </div>
          </section>

          <aside className="xuan-health-panel atlas-panel">
            <div className="xuan-health-emblem">
              <span><ShieldCheck size={34} /></span>
            </div>
            <div className="xuan-health-copy"><span>System health</span><h3>{allHealthy ? "All Systems Operational" : "Review Required"}</h3><p>{allHealthy ? "Your realm is calm and running smoothly." : `${unhealthyApps + attentionCount} item${unhealthyApps + attentionCount === 1 ? "" : "s"} need your attention.`}</p></div>
            <div className="xuan-health-list">
              <button type="button" onClick={() => navigate("storage")}><span><HardDrive size={15} />Disk health</span><strong className={diskIssue ? "warning" : "online"}>{diskIssue ? "Attention" : "Healthy"}</strong></button>
              <button type="button" onClick={() => navigate("network")}><span><Network size={15} />Network</span><strong className={networkOnline ? "online" : "warning"}>{networkOnline ? "Online" : "Checking"}</strong></button>
              <button type="button" onClick={() => openApplications(unhealthyApps > 0)}><span><Boxes size={15} />Services</span><strong className={unhealthyApps ? "warning" : "online"}>{unhealthyApps ? `${unhealthyApps} issue${unhealthyApps === 1 ? "" : "s"}` : "All running"}</strong></button>
              <button type="button" onClick={() => navigate("security")}><span><ShieldCheck size={15} />Security</span><strong className={securityIssues ? "warning" : "online"}>{securityIssues ? `${securityIssues} finding${securityIssues === 1 ? "" : "s"}` : "Protected"}</strong></button>
            </div>
          </aside>
        </div>;
      })()}

      {customizing && <div className="atlas-customize-tip"><span>Customization mode</span><p>Drag widgets to reorder them. Use the arrows on touch devices, resize with ↔, or open ⚙ to change the icon and accent.</p><button type="button" onClick={resetDashboard}>Restore minimal defaults</button></div>}
    </section>;
  }

  function systemPage(): React.ReactNode {
    const cpuUsage = metrics.system?.cpu.usage ?? 0;
    const memoryUsage = metrics.system?.memory.usage ?? 0;
    return <section className="atlas-page">
      <div className="atlas-system-summary">
        <article className="atlas-panel atlas-system-metric-card">
          <div className="atlas-system-metric-card__head"><Gauge size={18} /><span>CPU</span></div>
          <strong>{metrics.system ? `${cpuUsage.toFixed(0)}%` : "--"}</strong>
          <p>{metrics.system?.cpu.temperature ? `${metrics.system.cpu.temperature.toFixed(0)}°C` : "Temperature unavailable"}</p>
          <ProgressBar value={cpuUsage} />
        </article>
        <article className="atlas-panel atlas-system-metric-card">
          <div className="atlas-system-metric-card__head"><MemoryStick size={18} /><span>Memory</span></div>
          <strong>{metrics.system ? `${memoryUsage.toFixed(0)}%` : "--"}</strong>
          <p>{metrics.system ? `${formatBytes(metrics.system.memory.usedBytes)} of ${formatBytes(metrics.system.memory.totalBytes)}` : "Memory unavailable"}</p>
          <ProgressBar value={memoryUsage} />
        </article>
        <article className="atlas-panel atlas-system-metric-card">
          <div className="atlas-system-metric-card__head"><Activity size={18} /><span>Uptime</span></div>
          <strong>{metrics.system ? formatUptime(metrics.system.uptimeSeconds) : "--"}</strong>
          <p>{metrics.system?.hostname ?? "homeserver"}</p>
        </article>
      </div>

      <div className="atlas-page-grid-2 atlas-system-detail-grid">
        <article className="atlas-panel atlas-system-performance">
          <div className="atlas-panel__header"><div><h2>Live performance</h2><p>CPU and memory samples collected while XUAN is open.</p></div></div>
          <div className="atlas-mini-chart atlas-system-chart">
            <div className="atlas-mini-chart__legend"><span>CPU {cpuNow.toFixed(0)}%</span><span>RAM {memoryNow.toFixed(0)}%</span></div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-label="CPU and memory performance">
              <polyline className="atlas-chart-line memory" points={memoryChart} />
              <polyline className="atlas-chart-line cpu" points={cpuChart} />
            </svg>
            {performanceHistory.length < 2 && <small>Collecting samples…</small>}
          </div>
        </article>
        <article className="atlas-panel">
          <div className="atlas-panel__header"><div><h2>Host information</h2><p>Details reported by the XUAN host.</p></div></div>
          <dl className="atlas-system-list">
            <div><dt>Hostname</dt><dd>{metrics.system?.hostname ?? "--"}</dd></div>
            <div><dt>Operating system</dt><dd>{metrics.system?.operatingSystem ?? "--"}</dd></div>
            <div><dt>Uptime</dt><dd>{metrics.system ? formatUptime(metrics.system.uptimeSeconds) : "--"}</dd></div>
            <div><dt>Memory</dt><dd>{metrics.system ? formatBytes(metrics.system.memory.totalBytes) : "--"}</dd></div>
            <div><dt>Network interface</dt><dd>{metrics.system?.network?.interface ?? "--"}</dd></div>
          </dl>
        </article>
      </div>
    </section>;
  }

  function applicationsPage(): React.ReactNode {
    return <section className="atlas-page">
      <div className="atlas-page-toolbar">
        <label className="atlas-search-box"><Search size={16} /><input id="atlas-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications…" /><kbd>/</kbd></label>
        <div className="atlas-page-toolbar__actions">
          <button
            type="button"
            className={`atlas-filter-chip ${applicationsIssuesOnly ? "active" : ""}`}
            onClick={() => setApplicationsIssuesOnly((value) => !value)}
          >{applicationsIssuesOnly ? "Showing issues" : "Issues only"}</button>
          <span>{appsLoading ? "Discovering…" : `${filteredApps.length}/${apps.length} applications`}</span>
        </div>
      </div>
      {applicationsIssuesOnly && unhealthyApps > 0 && <div className="atlas-context-banner"><AlertTriangle size={15} /><span>Showing only applications that need attention.</span><button type="button" onClick={() => setApplicationsIssuesOnly(false)}>Show all</button></div>}
      {appsError && <div className="atlas-inline-warning">{appsError}</div>}
      {appGroups.map(([category, groupApps]) => <section key={category} className="atlas-app-group"><div className="atlas-app-group__title"><h2>{category}</h2><span>{groupApps.length}</span></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">{groupApps.map((app) => <AppCard key={app.id} app={app} onDetails={() => setSelectedApp(app)} />)}</div></section>)}
      {!appsLoading && filteredApps.length === 0 && <div className="atlas-empty-dashboard"><Search size={24} /><h3>No applications found</h3><p>Try another search or check your XUAN/Atlas Docker labels.</p></div>}
    </section>;
  }

  function containersPage(): React.ReactNode {
    const containers = metrics.docker?.containers ?? [];
    return <section className="atlas-page">
      <div className="atlas-stat-strip"><div><span>Total</span><strong>{metrics.docker?.total ?? "--"}</strong></div><div><span>Running</span><strong>{metrics.docker?.running ?? "--"}</strong></div><div><span>Stopped</span><strong>{metrics.docker?.stopped ?? "--"}</strong></div><div><span>Restarting</span><strong>{metrics.docker?.restarting ?? "--"}</strong></div></div>
      <div className="atlas-table-card">
        <div className="atlas-table-head"><span>Container</span><span>Image</span><span>Status</span><span>Action</span></div>
        {containers.map((container) => {
          const app = apps.find((candidate) => candidate.container === container.name);
          return <div key={container.id} className="atlas-table-row"><div><strong>{container.name}</strong><small>{container.id.slice(0, 12)}</small></div><code>{container.image}</code><span className={`atlas-state-pill ${container.state === "running" ? "online" : container.state === "restarting" ? "warning" : "offline"}`}><i />{container.state}</span><div>{app ? <button type="button" onClick={() => setSelectedApp(app)}>Details</button> : <span className="atlas-muted">System container</span>}</div></div>;
        })}
        {containers.length === 0 && <p className="atlas-empty-note">Docker container data is unavailable.</p>}
      </div>
    </section>;
  }

  function networkPage(): React.ReactNode {
    const cloudflared = metrics.docker?.containers.find((container) => container.name === "cloudflared");
    const net = metrics.system?.network;
    return <section className="atlas-page">
      <div className="atlas-network-hero"><article><ArrowDown size={18} /><span>Download</span><strong>{net ? formatRate(net.rxBytesPerSecond) : "--"}</strong></article><article><ArrowUp size={18} /><span>Upload</span><strong>{net ? formatRate(net.txBytesPerSecond) : "--"}</strong></article><article><Network size={18} /><span>Interface</span><strong>{net?.interface ?? "--"}</strong></article></div>
      <div className="atlas-page-grid-2">
        <article className="atlas-panel"><div className="atlas-panel__header"><div><h2>Remote access</h2><p>Connectors visible to Docker</p></div></div><div className="atlas-network-status-row"><span><Cloud size={17} />Cloudflare Tunnel</span><strong className={cloudflared?.state === "running" ? "online" : "offline"}>{cloudflared?.state === "running" ? "Connected" : cloudflared ? cloudflared.state : "Not detected"}</strong></div><div className="atlas-network-status-row"><span><Server size={17} />Hostname</span><strong>{metrics.system?.hostname ?? "--"}</strong></div></article>
        <article className="atlas-panel"><div className="atlas-panel__header"><div><h2>Traffic totals</h2><p>Since the active interface started reporting</p></div></div><div className="atlas-network-status-row"><span>Received</span><strong>{net ? formatBytes(net.rxBytes) : "--"}</strong></div><div className="atlas-network-status-row"><span>Transmitted</span><strong>{net ? formatBytes(net.txBytes) : "--"}</strong></div></article>
      </div>
    </section>;
  }

  function settingsPage(): React.ReactNode {
    return <section className="atlas-page"><div className="atlas-settings-grid">
      <article className="atlas-panel"><div className="atlas-panel__header"><div><h2>Dashboard</h2><p>Preferences are saved in this browser.</p></div></div><div className="atlas-settings-row"><div><strong>Visible widgets</strong><span>{widgets.length} configured</span></div><button type="button" onClick={() => { navigate("dashboard"); setCustomizing(true); setLibraryOpen(true); }}>Customize</button></div><div className="atlas-settings-row"><div><strong>Minimal defaults</strong><span>CPU, memory, uptime, services and storage</span></div><button type="button" onClick={resetDashboard}>Reset</button></div></article>
      <article className="atlas-panel"><div className="atlas-panel__header"><div><h2>Notifications</h2><p>Optional browser alerts for warnings and critical events.</p></div></div><div className="atlas-settings-row"><div><strong>Browser alerts</strong><span>{browserAlertsEnabled ? "Enabled" : "Disabled"}</span></div><button type="button" onClick={() => void toggleBrowserAlerts()}>{browserAlertsEnabled ? "Disable" : "Enable"}</button></div></article>
      <article className="atlas-panel"><div className="atlas-panel__header"><div><h2>XUAN</h2><p>Current XUAN interface and host details.</p></div></div><dl className="atlas-system-list"><div><dt>Version</dt><dd>{config.version}</dd></div><div><dt>Hostname</dt><dd>{metrics.system?.hostname ?? "--"}</dd></div><div><dt>OS</dt><dd>{metrics.system?.operatingSystem ?? "--"}</dd></div><div><dt>Control</dt><dd>{controlKey ? "Unlocked" : controlConfigured ? "Locked" : "Not configured"}</dd></div><div><dt>Docker labels</dt><dd>{config.legacyLabelSupport ? "xuan.* + atlas.*" : "xuan.*"}</dd></div></dl></article>
      <article className="atlas-panel atlas-account-panel"><div className="atlas-panel__header"><div><h2>Account</h2><p>Your authenticated XUAN session.</p></div></div><div className="atlas-account-summary"><span className="atlas-account-avatar" aria-hidden="true"><XuanSealMark /></span><div><strong>{config.owner}</strong><span><i className="atlas-profile-status-dot" />Signed in · Administrator</span></div></div><button type="button" className="atlas-signout-button" onClick={() => void onLogout()}><Power size={16} />Sign out of XUAN</button></article>
    </div></section>;
  }

  const pageContent: Record<RouteKey, React.ReactNode> = {
    dashboard: dashboardPage(),
    system: systemPage(),
    applications: applicationsPage(),
    containers: containersPage(),
    storage: <section className="atlas-page"><StorageManager drives={metrics.storage} /></section>,
    network: networkPage(),
    backups: <section className="atlas-page"><BackupCenter status={backupStatus} loading={backupLoading} error={backupError} unlocked={Boolean(controlKey)} controlConfigured={controlConfigured} onUnlock={unlockControls} onRun={runBackup} onRefresh={loadBackupStatus} /></section>,
    security: <section className="atlas-page"><SecurityCenter status={securityStatus} loading={securityLoading} error={securityError} onRefresh={loadSecurityStatus} /></section>,
    updates: <section className="atlas-page"><UpdateCenter status={updateStatus} loading={updatesLoading} error={updatesError} unlocked={Boolean(controlKey)} controlConfigured={controlConfigured} busyId={busyUpdateId} onUnlock={unlockControls} onCheck={checkUpdate} onCheckAll={checkAllUpdates} onRefresh={loadUpdateStatus} /></section>,
    notifications: <section className="atlas-page"><NotificationCenter status={notificationStatus} loading={notificationsLoading} error={notificationsError} browserAlertsEnabled={browserAlertsEnabled} onToggleBrowserAlerts={toggleBrowserAlerts} onRefresh={loadNotifications} /></section>,
    settings: settingsPage(),
  };

  const editingWidget = editingWidgetId ? widgets.find((widget) => widget.id === editingWidgetId) ?? null : null;
  const editingApp = editingWidget?.kind === "app" ? apps.find((app) => app.container === editingWidget.appContainer) ?? null : null;

  return (
    <div className="atlas-app-shell">
      <a className="xuan-skip" href="#main-content">Skip to content</a>
      <aside className="atlas-sidebar">
        <button type="button" className="atlas-brand" onClick={() => navigate("dashboard")} aria-label="Open XUAN dashboard">
          <span className="atlas-logo-mark" aria-hidden="true"><XuanSealMark /></span>
          <span className="atlas-brand-copy"><strong>{config.title}</strong><span>Home Server</span></span>
        </button>
        <nav className="atlas-nav" aria-label="XUAN navigation">
          {navItems.map((item) => <button key={item.key} type="button" className={route === item.key ? "atlas-nav__active" : ""} onClick={() => item.key === "applications" ? openApplications(false) : navigate(item.key)}>{item.icon}<span>{item.label}</span>{item.key === "updates" && (updateStatus?.summary.available ?? 0) > 0 && <i className="atlas-nav-badge">{updateStatus?.summary.available}</i>}</button>)}
        </nav>
        <div className="atlas-sidebar__spacer" />
        <div className="atlas-side-health"><div className="atlas-server-orb"><Server size={35} /></div><span className="atlas-side-health__label"><i className={`atlas-status-dot ${allHealthy ? "" : "is-warning"}`} />System Status</span><strong>{allHealthy ? "Healthy" : "Attention"}</strong><p>{allHealthy ? "All systems operational" : `${unhealthyApps + attentionCount} item${unhealthyApps + attentionCount === 1 ? "" : "s"} to review`}</p></div>
        <button type="button" className="atlas-profile-card" onClick={() => navigate("settings")} aria-label="Open XUAN profile settings">
          <span className="atlas-avatar" aria-hidden="true"><XuanSealMark /></span>
          <span className="atlas-profile-copy"><strong>{config.owner}</strong><span><i className="atlas-profile-status-dot" />XUAN administrator</span></span>
          <span className="atlas-profile-action" aria-hidden="true"><Settings size={14} /></span>
        </button>
      </aside>

      <main className="atlas-main" id="main-content" tabIndex={-1}>
        <header className="atlas-topbar atlas-route-topbar">
          <div><h1>{routeMeta[route].title}</h1><p>{routeMeta[route].subtitle}</p></div>
          <div className="atlas-topbar__tools">
            <button type="button" aria-label="Notifications" className="atlas-icon-button atlas-notification-button" onClick={() => navigate("notifications")}><Bell size={17} />{attentionCount > 0 && <span>{attentionCount > 9 ? "9+" : attentionCount}</span>}</button>
            <div className="atlas-clock"><span>{clock.toLocaleDateString([], { month: "short", day: "numeric" })}</span><i />{clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </header>

        {pageContent[route]}
      </main>

      <nav className="atlas-mobile-nav" aria-label="Mobile navigation">
        <button type="button" className={route === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}><LayoutDashboard size={18} /><span>Home</span></button>
        <button type="button" className={route === "applications" ? "active" : ""} onClick={() => openApplications(false)}><AppWindow size={18} /><span>Apps</span></button>
        <button type="button" className={route === "containers" ? "active" : ""} onClick={() => navigate("containers")}><Boxes size={18} /><span>Docker</span></button>
        <button type="button" className={route === "storage" ? "active" : ""} onClick={() => navigate("storage")}><HardDrive size={18} /><span>Storage</span></button>
        <button type="button" aria-expanded={mobileMenuOpen} aria-controls="mobile-more" className={mobileMenuOpen ? "active" : ""} onClick={() => setMobileMenuOpen((value) => !value)}><Settings size={18} /><span>More</span></button>
      </nav>

      {mobileMenuOpen && <div className="atlas-mobile-more" id="mobile-more"><div className="atlas-mobile-more__head"><strong>More</strong><button type="button" onClick={() => setMobileMenuOpen(false)}><X size={16} /></button></div>{navItems.filter((item) => !["dashboard", "applications", "containers", "storage"].includes(item.key)).map((item) => <button key={item.key} type="button" onClick={() => navigate(item.key)}>{item.icon}<span>{item.label}</span></button>)}<button type="button" onClick={() => navigate("notifications")}><Bell size={17} /><span>Notifications</span>{attentionCount > 0 && <i>{attentionCount}</i>}</button></div>}

      {selectedApp && <AppDetails app={selectedApp} onClose={() => setSelectedApp(null)} controlConfigured={controlConfigured} controlUnlocked={Boolean(controlKey)} onUnlock={unlockControls} onLock={lockControls} onAction={controlSelectedApp} onFetchLogs={fetchAppLogs} />}
      {libraryOpen && <WidgetLibrary apps={apps} existing={widgets} onAdd={addWidget} onClose={() => setLibraryOpen(false)} />}
      {editingWidget && <WidgetEditor widget={editingWidget} app={editingApp} onChange={(patch) => updateWidget(editingWidget.id, patch)} onRemove={() => removeWidget(editingWidget.id)} onClose={() => setEditingWidgetId(null)} />}
    </div>
  );
}


type AtlasAuthStatus = {
  configured: boolean;
  authenticated: boolean;
  username: string | null;
  expiresAt: string | null;
};

function XuanLogin({
  owner,
  title,
  onAuthenticated,
}: {
  owner: string;
  title: string;
  onAuthenticated: () => void;
}) {
  const [username, setUsername] = React.useState(owner);
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, remember }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to sign in to XUAN.");
      setPassword("");
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in to XUAN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="atlas-login-screen">
      <div className="atlas-login-ambient atlas-login-ambient--one" />
      <div className="atlas-login-ambient atlas-login-ambient--two" />
      <section className="atlas-login-shell" aria-label="XUAN sign in">
        <div className="atlas-login-brand">
          <span className="atlas-login-mark" aria-hidden="true"><XuanSealMark /></span>
          <div><strong>{title}</strong><span>Home Server</span></div>
        </div>

        <div className="atlas-login-card">
          <div className="atlas-login-card__heading">
            <span className="atlas-login-lock"><LockKeyhole size={18} /></span>
            <div><p>玄 · Private realm</p><h1>Welcome back</h1><span>Sign in to enter XUAN.</span></div>
          </div>

          <form onSubmit={submit} className="atlas-login-form">
            <label>
              <span>Username</span>
              <span className="xuan-login-field">
                <User size={16} aria-hidden="true" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="XUAN username"
                  disabled={busy}
                />
              </span>
            </label>
            <label>
              <span>Password</span>
              <span className="xuan-login-field">
                <LockKeyhole size={16} aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="XUAN password"
                  disabled={busy}
                  autoFocus
                />
                <button type="button" className="xuan-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((value) => !value)} disabled={busy}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            <div className="atlas-login-options">
              <label className="atlas-login-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} />
                <span>Keep me signed in for 7 days</span>
              </label>
              <span className="atlas-login-secure"><Shield size={13} />Protected session</span>
            </div>

            {error && <div className="atlas-login-error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}

            <button type="submit" className="atlas-login-submit" disabled={busy || !username.trim() || !password}>
              {busy ? <><RefreshCw size={16} className="atlas-spin" />Signing in...</> : <><LogIn size={16} />Enter XUAN<ArrowUpRight size={16} /></>}
            </button>
          </form>
        </div>

        <div className="atlas-login-foot"><span><i />XUAN is online</span><span>Private access only</span></div>
      </section>
    </main>
  );
}

function XuanAuthSetup({ title }: { title: string }) {
  return (
    <main className="atlas-login-screen">
      <section className="atlas-login-shell">
        <div className="atlas-login-brand"><span className="atlas-login-mark" aria-hidden="true"><XuanSealMark /></span><div><strong>{title}</strong><span>Home Server</span></div></div>
        <div className="atlas-login-card atlas-login-card--setup">
          <span className="atlas-login-lock"><AlertTriangle size={18} /></span>
          <h1>Login is not configured</h1>
          <p>Set <code>XUAN_LOGIN_PASSWORD_B64</code> or keep the legacy <code>ATLAS_LOGIN_PASSWORD_B64</code>, then redeploy. The v3.0.7 updater supports both.</p>
        </div>
      </section>
    </main>
  );
}

function XuanRoot() {
  const config = useConfig();
  const [status, setStatus] = React.useState<AtlasAuthStatus | null>(null);
  const [checking, setChecking] = React.useState(true);

  const refreshStatus = React.useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Authentication status unavailable.");
      const body = (await response.json()) as AtlasAuthStatus;
      setStatus(body);
    } catch {
      setStatus({ configured: true, authenticated: false, username: null, expiresAt: null });
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
    const handleAuthRequired = () => {
      window.sessionStorage.removeItem("xuan.controlKey");
      window.sessionStorage.removeItem("atlas.controlKey");
      setStatus((current) => ({
        configured: current?.configured ?? true,
        authenticated: false,
        username: null,
        expiresAt: null,
      }));
    };
    window.addEventListener("atlas:auth-required", handleAuthRequired);
    return () => window.removeEventListener("atlas:auth-required", handleAuthRequired);
  }, [refreshStatus]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.sessionStorage.removeItem("xuan.controlKey");
      window.sessionStorage.removeItem("atlas.controlKey");
      setStatus((current) => ({
        configured: current?.configured ?? true,
        authenticated: false,
        username: null,
        expiresAt: null,
      }));
    }
  }

  if (checking) {
    return <main className="atlas-login-screen"><div className="atlas-auth-splash"><span className="atlas-login-mark"><XuanSealMark /></span><strong>{config.title}</strong><span>Opening the gate...</span></div></main>;
  }

  if (!status?.configured) return <XuanAuthSetup title={config.title} />;
  if (!status.authenticated) {
    return <XuanLogin owner={config.owner} title={config.title} onAuthenticated={() => void refreshStatus()} />;
  }

  return <XuanDashboard onLogout={logout} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <XuanRoot />
  </React.StrictMode>,
);
