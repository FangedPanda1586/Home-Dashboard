import React from "react";
import { visiblePoll } from "../lib/visiblePoll";
import { atlasFetch } from "../lib/api";
import type { AtlasApp } from "../types/apps";

export function useApps() {
  const [apps, setApps] = React.useState<AtlasApp[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await atlasFetch("/api/apps", { cache: "no-store" });
      if (!response.ok) throw new Error(`Application discovery failed (${response.status}).`);
      const body = (await response.json()) as { apps: AtlasApp[] };
      setApps(body.apps ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load applications.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let first = true;
    return visiblePoll(async () => { await load(first); first = false; }, 30000);
  }, [load]);

  return { apps, loading, error, refresh: () => load(false) };
}
