import React from "react";

type AtlasConfig = {
  title: string;
  owner: string;
  tagline: string;
  version: string;
  legacyLabelSupport?: boolean;
};

const fallback: AtlasConfig = {
  title: "XUAN",
  owner: "Wasim",
  tagline: "Quiet power at the center of your digital realm.",
  version: "3.1.0",
  legacyLabelSupport: true,
};

export function useConfig() {
  const [config, setConfig] = React.useState(fallback);

  React.useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Config unavailable");
        return response.json() as Promise<AtlasConfig>;
      })
      .then(setConfig)
      .catch(() => setConfig(fallback));
  }, []);

  return config;
}
