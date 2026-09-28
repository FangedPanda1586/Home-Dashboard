export class PluginManager {
    app;
    plugins = new Map();
    listeners = new Set();
    constructor(app) {
        this.app = app;
    }
    register(plugin) {
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
    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        const completeEvent = {
            ...event,
            timestamp: new Date().toISOString(),
        };
        for (const listener of this.listeners)
            listener(completeEvent);
    }
    async initializeAll() {
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
