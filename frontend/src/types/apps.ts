export type AtlasApp = {
  id: string;
  name: string;
  description: string;
  url: string;
  icon: string;
  category: string;
  keywords: string[];
  container: string;
  image: string;
  version: string;
  state: string;
  status: string;
  health: "healthy" | "unhealthy" | "starting" | "unknown";
  createdAt: string | null;
  ports: Array<{
    privatePort: number;
    publicPort: number | null;
    protocol: string;
    ip: string | null;
  }>;
  mounts: Array<{
    type: string;
    source: string;
    destination: string;
    readWrite: boolean;
  }>;
  controllable: boolean;
  resources: {
    cpuPercent: number;
    memoryUsageBytes: number;
    memoryLimitBytes: number;
    memoryPercent: number;
  } | null;
};
