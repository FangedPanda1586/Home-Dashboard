import type { Express } from "express";

export type AtlasEvent = {
  pluginId: string;
  type: string;
  timestamp: string;
  payload?: unknown;
};

export type AtlasPluginContext = {
  app: Express;
  emit: (event: Omit<AtlasEvent, "timestamp">) => void;
};

export type AtlasPlugin = {
  id: string;
  name: string;
  version: string;
  description?: string;
  initialize: (context: AtlasPluginContext) => Promise<void> | void;
};

export class PluginManager {
  private readonly plugins = new Map<string, AtlasPlugin>();
  private readonly listeners = new Set<(event: AtlasEvent) => void>();

  constructor(private readonly app: Express) {}

  register(plugin: AtlasPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin already registered: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  list() {
    return [...this.plugins.values()].map(({ id, name, version, description }) => ({
      id,
      name,
      version,
      description: description ?? "",
    }));
  }

  onEvent(listener: (event: AtlasEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Omit<AtlasEvent, "timestamp">): void {
    const completeEvent: AtlasEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) listener(completeEvent);
  }

  async initializeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.initialize({
        app: this.app,
        emit: (event) => this.emit(event),
      });
      this.emit({
        pluginId: plugin.id,
        type: "plugin:initialized",
        payload: { name: plugin.name, version: plugin.version },
      });
    }
  }
}
