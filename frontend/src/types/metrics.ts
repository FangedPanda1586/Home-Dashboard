export type SystemMetrics = {
  cpu: { usage: number; temperature: number | null };
  memory: { usedBytes: number; totalBytes: number; usage: number };
  network: {
    interface: string;
    rxBytes: number;
    txBytes: number;
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
  } | null;
  uptimeSeconds: number;
  operatingSystem: string;
  hostname: string;
};

export type StorageItem = {
  name: string;
  mount: string;
  source: string | null;
  filesystem: string | null;
  device: string | null;
  model: string | null;
  firmware: string | null;
  protocol: string | null;
  temperature: number | null;
  smartStatus: "passed" | "failed" | "standby" | "unsupported" | "unavailable";
  powerOnHours: number | null;
  rotationRate: number | null;
  health: "healthy" | "warning" | "critical" | "unknown";
  healthMessage: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
  usage: number;
};

export type DockerMetrics = {
  total: number;
  running: number;
  stopped: number;
  restarting: number;
  containers: Array<{
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
  }>;
};

export type MetricsState = {
  system: SystemMetrics | null;
  storage: StorageItem[];
  docker: DockerMetrics | null;
};
