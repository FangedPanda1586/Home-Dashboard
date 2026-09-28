import React from "react";
import { atlasFetch } from "../lib/api";
import { io } from "socket.io-client";
import type { DockerMetrics, MetricsState, StorageItem, SystemMetrics } from "../types/metrics";

const initialMetrics: MetricsState = {
  system: null,
  storage: [],
  docker: null,
};

export function useMetrics() {
  const [metrics, setMetrics] = React.useState<MetricsState>(initialMetrics);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadInitialMetrics() {
      try {
        const [systemResponse, storageResponse, dockerResponse] = await Promise.all([
          atlasFetch("/api/system", { cache: "no-store" }),
          atlasFetch("/api/storage", { cache: "no-store" }),
          atlasFetch("/api/docker", { cache: "no-store" }),
        ]);

        if (!systemResponse.ok || !storageResponse.ok || !dockerResponse.ok) {
          throw new Error("One or more XUAN metric endpoints are unavailable.");
        }

        const [system, storage, docker] = await Promise.all([
          systemResponse.json() as Promise<SystemMetrics>,
          storageResponse.json() as Promise<{ drives: StorageItem[] }>,
          dockerResponse.json() as Promise<DockerMetrics>,
        ]);

        if (active) {
          setMetrics({ system, storage: storage.drives ?? [], docker });
          setError(null);
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load server metrics.");
        }
      }
    }



    const socket = io({ transports: ["websocket", "polling"], autoConnect: false });
    socket.on("metrics", (payload: {
      system: SystemMetrics;
      storage: StorageItem[];
      docker: DockerMetrics;
    }) => {
      setMetrics({
        system: payload.system,
        storage: payload.storage ?? [],
        docker: payload.docker,
      });
      setError(null);
    });
    socket.on("connect_error", (caught) => {
      if (/authentication required|login is not configured/i.test(caught.message)) {
        window.dispatchEvent(new CustomEvent("atlas:auth-required"));
        return;
      }
      setError("Live updates are reconnecting. The dashboard will keep trying.");
    });

    function syncVisibility() {
      if (document.hidden) socket.disconnect();
      else { void loadInitialMetrics(); socket.connect(); }
    }
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      active = false;
      socket.disconnect();
    };
  }, []);

  return { metrics, error };
}
