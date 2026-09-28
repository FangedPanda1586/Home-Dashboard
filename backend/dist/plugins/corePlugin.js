export const corePlugin = {
    id: "core",
    name: "XUAN Core",
    version: "1.0.0",
    description: "Core API and event plumbing for XUAN.",
    initialize({ app }) {
        app.get("/api/core/status", (_request, response) => {
            response.json({
                status: "ready",
                plugin: "core",
                timestamp: new Date().toISOString(),
            });
        });
    },
};
