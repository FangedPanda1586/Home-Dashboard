import express from "express";
import Docker from "dockerode";
import { PluginManager } from "./core/PluginManager.js";
import { corePlugin } from "./plugins/corePlugin.js";
import { cpuTemperature, currentLoad, mem, networkStats, osInfo, time, } from "systeminformation";
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { Server as SocketServer } from "socket.io";
const app = express();
const pluginManager = new PluginManager(app);
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { serveClient: false });
const port = Number(process.env.PORT ?? 3000);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const frontendDirectory = path.resolve(currentDirectory, "../frontend-dist");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
function firstEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === "string" && value.trim() !== "")
            return value;
    }
    return "";
}
function decodedBase64Env(...names) {
    const encoded = firstEnv(...names);
    if (!encoded)
        return "";
    try {
        return Buffer.from(encoded, "base64").toString("utf8");
    }
    catch {
        return "";
    }
}
function appLabel(labels, key) {
    return labels[`xuan.${key}`] ?? labels[`atlas.${key}`];
}
function appLabelEnabled(labels) {
    return appLabel(labels ?? {}, "enabled") === "true";
}
const controlPassword = decodedBase64Env("XUAN_CONTROL_PASSWORD_B64", "ATLAS_CONTROL_PASSWORD_B64");
const backupPassword = decodedBase64Env("XUAN_BACKUP_PASSWORD_B64", "ATLAS_BACKUP_PASSWORD_B64");
const loginUsername = firstEnv("XUAN_LOGIN_USERNAME", "ATLAS_LOGIN_USERNAME", "XUAN_OWNER", "ATLAS_OWNER") ||
    "Wasim";
const loginPassword = decodedBase64Env("XUAN_LOGIN_PASSWORD_B64", "ATLAS_LOGIN_PASSWORD_B64");
const sessionHours = (() => {
    const parsed = Number(firstEnv("XUAN_SESSION_HOURS", "ATLAS_SESSION_HOURS") || 12);
    if (!Number.isFinite(parsed))
        return 12;
    return Math.min(168, Math.max(1, Math.floor(parsed)));
})();
const sessionCookieName = "xuan_session";
const defaultSessionMs = sessionHours * 60 * 60 * 1000;
const rememberedSessionMs = 7 * 24 * 60 * 60 * 1000;
const atlasSessions = new Map();
const failedLoginAttempts = new Map();
const loginAttemptWindowMs = 5 * 60 * 1000;
const maxLoginAttempts = 10;
const selfContainerId = process.env.HOSTNAME ?? "";
const failedAuthAttempts = new Map();
const authWindowMs = 60_000;
const maxAuthAttempts = 8;
const updateCheckCache = new Map();
let previousNetworkSample = null;
function round(value, decimals = 1) {
    const multiplier = 10 ** decimals;
    return Math.round(value * multiplier) / multiplier;
}
async function readText(pathname) {
    try {
        return (await fs.readFile(pathname, "utf8")).trim() || null;
    }
    catch {
        return null;
    }
}
async function readHostOsRelease() {
    const content = await readText("/host/root/etc/os-release");
    if (!content)
        return null;
    return (content
        .split("\n")
        .find((line) => line.startsWith("PRETTY_NAME="))
        ?.replace("PRETTY_NAME=", "")
        .replace(/^"|"$/g, "") ?? null);
}
function preferredNetworkInterface(name) {
    return /^(en|eth|eno|ens|enp|wl|wlan)/i.test(name);
}
function ignoredNetworkInterface(name) {
    return /^(lo|docker|br-|veth|virbr|tailscale|zt)/i.test(name);
}
async function getNetworkMetrics() {
    const hostNetwork = await readText("/host/root/proc/net/dev");
    if (hostNetwork) {
        const interfaces = hostNetwork
            .split("\n")
            .slice(2)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
            const [namePart, valuesPart] = line.split(":", 2);
            const values = valuesPart?.trim().split(/\s+/).map(Number) ?? [];
            return {
                interface: namePart?.trim() ?? "",
                rxBytes: Number.isFinite(values[0]) ? values[0] : 0,
                txBytes: Number.isFinite(values[8]) ? values[8] : 0,
            };
        })
            .filter((item) => item.interface && !ignoredNetworkInterface(item.interface));
        const selected = interfaces.find((item) => preferredNetworkInterface(item.interface)) ??
            interfaces.sort((first, second) => second.rxBytes + second.txBytes - (first.rxBytes + first.txBytes))[0];
        if (selected) {
            const now = Date.now();
            let rxBytesPerSecond = 0;
            let txBytesPerSecond = 0;
            if (previousNetworkSample &&
                previousNetworkSample.interface === selected.interface) {
                const elapsedSeconds = (now - previousNetworkSample.timestamp) / 1000;
                if (elapsedSeconds >= 0.5) {
                    rxBytesPerSecond = Math.max(0, (selected.rxBytes - previousNetworkSample.rxBytes) / elapsedSeconds);
                    txBytesPerSecond = Math.max(0, (selected.txBytes - previousNetworkSample.txBytes) / elapsedSeconds);
                }
            }
            previousNetworkSample = { ...selected, timestamp: now };
            return {
                ...selected,
                rxBytesPerSecond: round(rxBytesPerSecond, 0),
                txBytesPerSecond: round(txBytesPerSecond, 0),
            };
        }
    }
    try {
        const stats = await networkStats();
        const selected = stats.find((item) => !ignoredNetworkInterface(item.iface)) ?? stats[0];
        if (!selected)
            return null;
        return {
            interface: selected.iface,
            rxBytes: selected.rx_bytes ?? 0,
            txBytes: selected.tx_bytes ?? 0,
            rxBytesPerSecond: selected.rx_sec ?? 0,
            txBytesPerSecond: selected.tx_sec ?? 0,
        };
    }
    catch {
        return null;
    }
}
async function getSystemMetrics() {
    const [loadData, memoryData, temperatureData, timeData, osData, hostOs, hostname, network] = await Promise.all([
        currentLoad(),
        mem(),
        cpuTemperature(),
        time(),
        osInfo(),
        readHostOsRelease(),
        readText("/host/root/etc/hostname"),
        getNetworkMetrics(),
    ]);
    const temperature = typeof temperatureData.main === "number" && temperatureData.main > 0
        ? round(temperatureData.main)
        : null;
    return {
        cpu: {
            usage: round(loadData.currentLoad),
            temperature,
        },
        memory: {
            usedBytes: memoryData.active,
            totalBytes: memoryData.total,
            usage: memoryData.total > 0
                ? round((memoryData.active / memoryData.total) * 100)
                : 0,
        },
        network,
        uptimeSeconds: timeData.uptime,
        operatingSystem: hostOs ?? `${osData.distro} ${osData.release}`.trim(),
        hostname: hostname ?? osData.hostname ?? "homeserver",
    };
}
const smartCache = new Map();
const smartCacheMs = 60_000;
function decodeMountField(value) {
    return value
        .replace(/\\040/g, " ")
        .replace(/\\011/g, "\t")
        .replace(/\\012/g, "\n")
        .replace(/\\134/g, "\\");
}
async function hostMounts() {
    const content = await readText("/host/root/proc/mounts");
    if (!content)
        return [];
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const parts = line.split(/\s+/);
        return {
            source: decodeMountField(parts[0] ?? ""),
            target: decodeMountField(parts[1] ?? ""),
            filesystem: parts[2] ?? "unknown",
        };
    });
}
function runCommand(command, args, timeoutMs = 6_000) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
            if (finished)
                return;
            child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > 1_500_000)
                stdout = stdout.slice(-1_500_000);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 64_000)
                stderr = stderr.slice(-64_000);
        });
        child.once("error", (error) => {
            finished = true;
            clearTimeout(timer);
            reject(error);
        });
        child.once("close", () => {
            finished = true;
            clearTimeout(timer);
            if (stdout.trim())
                resolve(stdout);
            else
                reject(new Error(stderr.trim() || `${command} returned no output.`));
        });
    });
}
function numeric(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
async function getSmartProbe(devicePath, enabled) {
    const unavailable = {
        status: enabled ? "unavailable" : "unsupported",
        model: null,
        firmware: null,
        protocol: null,
        temperature: null,
        powerOnHours: null,
        rotationRate: null,
    };
    if (!enabled)
        return unavailable;
    const cached = smartCache.get(devicePath);
    if (cached && Date.now() - cached.at < smartCacheMs)
        return cached.value;
    try {
        // -n standby avoids waking a sleeping HDD only to refresh the dashboard.
        const output = await runCommand("smartctl", ["-n", "standby,0", "-a", "-j", devicePath]);
        const data = JSON.parse(output);
        const powerMode = String(data?.power_mode ?? "").toLowerCase();
        const passed = data?.smart_status?.passed;
        const status = powerMode.includes("standby")
            ? "standby"
            : passed === true
                ? "passed"
                : passed === false
                    ? "failed"
                    : "unsupported";
        const value = {
            status,
            model: data?.model_name ?? data?.product ?? null,
            firmware: data?.firmware_version ?? data?.revision ?? null,
            protocol: data?.device?.protocol ?? null,
            temperature: numeric(data?.temperature?.current) ??
                numeric(data?.nvme_smart_health_information_log?.temperature),
            powerOnHours: numeric(data?.power_on_time?.hours),
            rotationRate: numeric(data?.rotation_rate),
        };
        smartCache.set(devicePath, { at: Date.now(), value });
        return value;
    }
    catch {
        smartCache.set(devicePath, { at: Date.now(), value: unavailable });
        return unavailable;
    }
}
function driveHealth(usage, temperature, smart) {
    if (smart === "failed") {
        return { health: "critical", message: "SMART reports a drive health failure." };
    }
    if (usage >= 95) {
        return { health: "critical", message: "Less than 5% storage capacity remains." };
    }
    if (temperature !== null && temperature >= 70) {
        return { health: "critical", message: "Drive temperature is critically high." };
    }
    if (usage >= 85) {
        return { health: "warning", message: "Drive is above 85% capacity." };
    }
    if (temperature !== null && temperature >= 55) {
        return { health: "warning", message: "Drive temperature is running warm." };
    }
    if (smart === "passed") {
        return { health: "healthy", message: "SMART health check passed." };
    }
    if (smart === "standby") {
        return { health: "healthy", message: "Drive is in standby; SMART was not forced to wake it." };
    }
    return { health: "unknown", message: "SMART health information is not available." };
}
async function storageItem(name, containerMount, hostMount, smartDevicePath, hostDevice) {
    try {
        const [stats, mounts] = await Promise.all([fs.statfs(containerMount), hostMounts()]);
        const sizeBytes = Number(stats.blocks) * Number(stats.bsize);
        const availableBytes = Number(stats.bavail) * Number(stats.bsize);
        const usedBytes = Math.max(0, sizeBytes - availableBytes);
        const usage = sizeBytes > 0 ? round((usedBytes / sizeBytes) * 100) : 0;
        const mountEntry = mounts.find((entry) => entry.target === hostMount) ?? null;
        const smartEnabled = Boolean(hostDevice && hostDevice.startsWith("/dev/"));
        const smart = await getSmartProbe(smartDevicePath, smartEnabled);
        const health = driveHealth(usage, smart.temperature, smart.status);
        return {
            name,
            mount: hostMount,
            source: mountEntry?.source ?? null,
            filesystem: mountEntry?.filesystem ?? null,
            device: hostDevice || mountEntry?.source || null,
            model: smart.model,
            firmware: smart.firmware,
            protocol: smart.protocol,
            temperature: smart.temperature,
            smartStatus: smart.status,
            powerOnHours: smart.powerOnHours,
            rotationRate: smart.rotationRate,
            health: health.health,
            healthMessage: health.message,
            sizeBytes,
            usedBytes,
            availableBytes,
            usage,
        };
    }
    catch {
        return null;
    }
}
async function getStorageMetrics() {
    const systemDevice = firstEnv("XUAN_SYSTEM_DEVICE", "ATLAS_SYSTEM_DEVICE");
    const storageDevice = firstEnv("XUAN_STORAGE_DEVICE", "ATLAS_STORAGE_DEVICE");
    const drives = await Promise.all([
        storageItem("System SSD", "/host/root", "/", "/dev/atlas-system", systemDevice),
        storageItem("Storage HDD", "/host/storage", "/mnt/storage", "/dev/atlas-storage", storageDevice),
    ]);
    return drives.filter((drive) => drive !== null);
}
async function getDockerMetrics() {
    const containers = await docker.listContainers({ all: true });
    const mappedContainers = containers.map((container) => ({
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
        image: container.Image,
        state: container.State,
        status: container.Status,
    }));
    return {
        total: mappedContainers.length,
        running: mappedContainers.filter((item) => item.state === "running").length,
        stopped: mappedContainers.filter((item) => item.state === "exited").length,
        restarting: mappedContainers.filter((item) => item.state === "restarting").length,
        containers: mappedContainers,
    };
}
function healthFromStatus(status) {
    const match = status.match(/\((healthy|unhealthy|health: starting|starting)\)/i);
    if (!match)
        return "unknown";
    const value = match[1].toLowerCase();
    if (value === "healthy")
        return "healthy";
    if (value === "unhealthy")
        return "unhealthy";
    return "starting";
}
function versionFromImage(image) {
    const digestIndex = image.indexOf("@sha256:");
    const withoutDigest = digestIndex >= 0 ? image.slice(0, digestIndex) : image;
    const slashIndex = withoutDigest.lastIndexOf("/");
    const colonIndex = withoutDigest.lastIndexOf(":");
    return colonIndex > slashIndex ? withoutDigest.slice(colonIndex + 1) : "latest";
}
async function getContainerResources(id, state) {
    if (state !== "running")
        return null;
    try {
        const stats = await docker.getContainer(id).stats({ stream: false });
        const cpuTotal = stats.cpu_stats?.cpu_usage?.total_usage ?? 0;
        const previousCpuTotal = stats.precpu_stats?.cpu_usage?.total_usage ?? 0;
        const systemTotal = stats.cpu_stats?.system_cpu_usage ?? 0;
        const previousSystemTotal = stats.precpu_stats?.system_cpu_usage ?? 0;
        const cpuDelta = cpuTotal - previousCpuTotal;
        const systemDelta = systemTotal - previousSystemTotal;
        const onlineCpus = stats.cpu_stats?.online_cpus ??
            stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
            1;
        const cpuPercent = systemDelta > 0 && cpuDelta > 0
            ? (cpuDelta / systemDelta) * onlineCpus * 100
            : 0;
        const rawMemoryUsage = stats.memory_stats?.usage ?? 0;
        const cache = stats.memory_stats?.stats?.inactive_file ??
            stats.memory_stats?.stats?.cache ??
            0;
        const memoryUsageBytes = Math.max(0, rawMemoryUsage - cache);
        const memoryLimitBytes = stats.memory_stats?.limit ?? 0;
        const memoryPercent = memoryLimitBytes > 0 ? (memoryUsageBytes / memoryLimitBytes) * 100 : 0;
        return {
            cpuPercent: round(cpuPercent),
            memoryUsageBytes,
            memoryLimitBytes,
            memoryPercent: round(memoryPercent),
        };
    }
    catch {
        return null;
    }
}
function isSelfContainer(id, name) {
    return ((name === "xuan" || name === "atlas") ||
        (selfContainerId.length >= 12 &&
            (id.startsWith(selfContainerId) || selfContainerId.startsWith(id.slice(0, 12)))));
}
function isControllableContainer(container) {
    const labels = container.Labels ?? {};
    const name = container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
    return (appLabelEnabled(labels) &&
        appLabel(labels, "control") !== "false" &&
        !isSelfContainer(container.Id, name));
}
function secureSecretMatches(expectedSecret, candidate) {
    if (!expectedSecret || !candidate)
        return false;
    const expected = createHash("sha256").update(expectedSecret).digest();
    const received = createHash("sha256").update(candidate).digest();
    return timingSafeEqual(expected, received);
}
function controlPasswordMatches(candidate) {
    return secureSecretMatches(controlPassword, candidate);
}
function loginPasswordMatches(candidate) {
    return secureSecretMatches(loginPassword, candidate);
}
function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    return cookieHeader.split(";").reduce((cookies, item) => {
        const separator = item.indexOf("=");
        if (separator <= 0)
            return cookies;
        const key = item.slice(0, separator).trim();
        const value = item.slice(separator + 1).trim();
        if (!key)
            return cookies;
        try {
            cookies[key] = decodeURIComponent(value);
        }
        catch {
            cookies[key] = value;
        }
        return cookies;
    }, {});
}
function validAtlasSession(sessionId) {
    if (!sessionId)
        return null;
    const session = atlasSessions.get(sessionId);
    if (!session)
        return null;
    if (session.expiresAt <= Date.now()) {
        atlasSessions.delete(sessionId);
        return null;
    }
    return session;
}
function atlasSessionFromCookieHeader(cookieHeader) {
    return validAtlasSession(parseCookies(cookieHeader)[sessionCookieName]);
}
function atlasSessionFromRequest(request) {
    return atlasSessionFromCookieHeader(request.header("cookie"));
}
function loginClientKey(request) {
    const cloudflareAddress = request.header("cf-connecting-ip")?.trim();
    return cloudflareAddress || request.ip || request.socket.remoteAddress || "unknown";
}
function requestUsesHttps(request) {
    const forwarded = request.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const cloudflareVisitor = request.header("cf-visitor")?.toLowerCase() ?? "";
    return request.secure || forwarded === "https" || cloudflareVisitor.includes('"scheme":"https"');
}
function setAtlasSessionCookie(request, response, session) {
    const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
    const attributes = [
        `${sessionCookieName}=${encodeURIComponent(session.id)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${maxAgeSeconds}`,
    ];
    if (requestUsesHttps(request))
        attributes.push("Secure");
    response.setHeader("Set-Cookie", attributes.join("; "));
}
function clearAtlasSessionCookie(request, response) {
    const attributes = [
        `${sessionCookieName}=`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=0",
    ];
    if (requestUsesHttps(request))
        attributes.push("Secure");
    response.setHeader("Set-Cookie", attributes.join("; "));
}
function loginAttemptBucket(key) {
    const now = Date.now();
    const current = failedLoginAttempts.get(key);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + loginAttemptWindowMs };
        failedLoginAttempts.set(key, fresh);
        return fresh;
    }
    return current;
}
function canAttemptLogin(key) {
    return loginAttemptBucket(key).count < maxLoginAttempts;
}
function noteFailedLogin(key) {
    const bucket = loginAttemptBucket(key);
    bucket.count += 1;
    failedLoginAttempts.set(key, bucket);
}
function clearFailedLogin(key) {
    failedLoginAttempts.delete(key);
}
function requireAtlasSession(request, response, next) {
    if (!loginPassword) {
        response.setHeader("Cache-Control", "no-store");
        response.status(503).json({
            error: "XUAN login is not configured.",
            code: "XUAN_LOGIN_NOT_CONFIGURED",
        });
        return;
    }
    const session = atlasSessionFromRequest(request);
    if (!session) {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Xuan-Auth-Required", "1");
        response.setHeader("X-Atlas-Auth-Required", "1");
        response.status(401).json({
            error: "Authentication required.",
            code: "XUAN_AUTH_REQUIRED",
        });
        return;
    }
    response.locals.atlasSession = session;
    next();
}
function authBucket(ip) {
    const now = Date.now();
    const current = failedAuthAttempts.get(ip);
    if (!current || current.resetAt <= now) {
        const fresh = { count: 0, resetAt: now + authWindowMs };
        failedAuthAttempts.set(ip, fresh);
        return fresh;
    }
    return current;
}
function canAttemptControlAuth(ip) {
    return authBucket(ip).count < maxAuthAttempts;
}
function noteFailedControlAuth(ip) {
    const bucket = authBucket(ip);
    bucket.count += 1;
    failedAuthAttempts.set(ip, bucket);
}
function clearFailedControlAuth(ip) {
    failedAuthAttempts.delete(ip);
}
function requestedLogLines(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return 100;
    return Math.min(500, Math.max(10, Math.floor(parsed)));
}
function decodeDockerLogs(value) {
    if (typeof value === "string")
        return value.replace(/\u0000/g, "");
    if (!Buffer.isBuffer(value) || value.length === 0)
        return "";
    // Non-TTY Docker logs can use an 8-byte multiplexing header per frame.
    // Parse it when present, otherwise fall back to normal UTF-8 text.
    const chunks = [];
    let offset = 0;
    let framed = false;
    while (offset + 8 <= value.length) {
        const streamType = value[offset];
        const reserved = value[offset + 1] === 0 && value[offset + 2] === 0 && value[offset + 3] === 0;
        const size = value.readUInt32BE(offset + 4);
        if (!(streamType === 0 || streamType === 1 || streamType === 2) || !reserved || size < 0 || offset + 8 + size > value.length) {
            break;
        }
        framed = true;
        chunks.push(value.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size;
    }
    const decoded = framed && offset === value.length
        ? Buffer.concat(chunks).toString("utf8")
        : value.toString("utf8");
    return decoded.replace(/\u0000/g, "");
}
function controlAuthFromRequest(request) {
    if (!controlPassword) {
        return { ok: false, status: 503, error: "XUAN controls are not configured." };
    }
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    if (!canAttemptControlAuth(ip)) {
        return {
            ok: false,
            status: 429,
            error: "Too many failed unlock attempts. Try again in about a minute.",
        };
    }
    const candidate = request.header("x-xuan-control-key") ?? request.header("x-atlas-control-key") ?? "";
    if (!controlPasswordMatches(candidate)) {
        noteFailedControlAuth(ip);
        return { ok: false, status: 401, error: "Invalid XUAN control password." };
    }
    clearFailedControlAuth(ip);
    return { ok: true, status: 200 };
}
async function getAtlasApps() {
    const containers = await docker.listContainers({ all: true });
    const atlasContainers = containers.filter((container) => appLabelEnabled(container.Labels));
    const apps = await Promise.all(atlasContainers.map(async (container) => {
        const labels = container.Labels ?? {};
        const containerName = container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
        const image = container.Image;
        return {
            id: container.Id,
            name: appLabel(labels, "name") ?? containerName,
            description: appLabel(labels, "description") ?? "Docker application",
            url: appLabel(labels, "url") ?? "#",
            icon: appLabel(labels, "icon") ?? "box",
            category: appLabel(labels, "category") ?? "Applications",
            keywords: (appLabel(labels, "keywords") ?? "")
                .split(",")
                .map((keyword) => keyword.trim())
                .filter(Boolean),
            container: containerName,
            image,
            version: appLabel(labels, "version") ?? versionFromImage(image),
            state: container.State,
            status: container.Status,
            health: healthFromStatus(container.Status),
            createdAt: container.Created
                ? new Date(container.Created * 1000).toISOString()
                : null,
            ports: (container.Ports ?? []).map((port) => ({
                privatePort: port.PrivatePort,
                publicPort: port.PublicPort ?? null,
                protocol: port.Type,
                ip: port.IP ?? null,
            })),
            mounts: (container.Mounts ?? []).map((mount) => ({
                type: mount.Type ?? "unknown",
                source: mount.Source ?? mount.Name ?? "unknown",
                destination: mount.Destination ?? "unknown",
                readWrite: mount.RW ?? false,
            })),
            resources: await getContainerResources(container.Id, container.State),
            controllable: isControllableContainer(container),
        };
    }));
    return apps.sort((first, second) => first.name.localeCompare(second.name));
}
function shortImageId(value) {
    if (!value)
        return null;
    return value.replace(/^sha256:/, "").slice(0, 12);
}
function imageIsDigestPinned(reference) {
    return /@sha256:[a-f0-9]{32,}$/i.test(reference);
}
function appUsesLocalAtlasBuild(app) {
    return app.container === "atlas" || app.name.trim().toLowerCase() === "atlas";
}
async function inspectImageId(reference) {
    try {
        const image = await docker.getImage(reference).inspect();
        return typeof image.Id === "string" ? image.Id : null;
    }
    catch {
        return null;
    }
}
async function pullImage(reference) {
    const stream = await docker.pull(reference);
    await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}
function updateItemState(app, runningImageId, candidateImageId, cache) {
    if (appUsesLocalAtlasBuild(app)) {
        return {
            id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
            runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
            state: "local",
            stateMessage: "XUAN is a local build. Install XUAN releases with the updater workflow rather than pulling a registry image.",
            checkedAt: null, canCheck: false,
        };
    }
    if (imageIsDigestPinned(app.image)) {
        return {
            id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
            runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
            state: "pinned",
            stateMessage: "This image is pinned to an immutable digest. Change the digest deliberately when you choose to upgrade it.",
            checkedAt: null, canCheck: false,
        };
    }
    const cacheMatches = Boolean(cache && cache.image === app.image && cache.runningImageId === runningImageId);
    if (cacheMatches && cache?.error) {
        return {
            id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
            runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
            state: "error", stateMessage: cache.error, checkedAt: cache.checkedAt, canCheck: true,
        };
    }
    const available = Boolean(runningImageId && candidateImageId && runningImageId !== candidateImageId);
    if (available) {
        return {
            id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
            runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
            state: "available",
            stateMessage: cacheMatches
                ? "A newer image has been downloaded and is ready for a controlled redeploy through Portainer."
                : "A different image for this tag is already present locally. Redeploy through Portainer to apply it.",
            checkedAt: cacheMatches ? cache?.checkedAt ?? null : null, canCheck: true,
        };
    }
    if (cacheMatches && cache) {
        return {
            id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
            runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
            state: "current",
            stateMessage: "The registry tag currently resolves to the same image used by this container.",
            checkedAt: cache.checkedAt, canCheck: true,
        };
    }
    return {
        id: app.id, name: app.name, category: app.category, container: app.container, image: app.image,
        runningImageId: shortImageId(runningImageId), candidateImageId: shortImageId(candidateImageId),
        state: "unknown", stateMessage: "Registry freshness has not been checked in this XUAN session.",
        checkedAt: null, canCheck: true,
    };
}
async function getUpdateCenterStatus() {
    const [apps, containers] = await Promise.all([getAtlasApps(), docker.listContainers({ all: true })]);
    const items = await Promise.all(apps.map(async (app) => {
        const summary = containers.find((container) => container.Id === app.id);
        const runningImageId = summary?.ImageID ?? null;
        const candidateImageId = await inspectImageId(app.image);
        return updateItemState(app, runningImageId, candidateImageId, updateCheckCache.get(app.id));
    }));
    return {
        summary: {
            total: items.length,
            current: items.filter((item) => item.state === "current").length,
            available: items.filter((item) => item.state === "available").length,
            unchecked: items.filter((item) => item.state === "unknown").length,
            protected: items.filter((item) => item.state === "pinned" || item.state === "local").length,
            errors: items.filter((item) => item.state === "error").length,
        },
        items: items.sort((first, second) => first.name.localeCompare(second.name)),
        timestamp: new Date().toISOString(),
    };
}
async function checkApplicationImageUpdate(appId) {
    const [apps, containers] = await Promise.all([getAtlasApps(), docker.listContainers({ all: true })]);
    const app = apps.find((item) => item.id === appId || item.id.startsWith(appId));
    if (!app)
        throw new Error("Application was not found.");
    if (appUsesLocalAtlasBuild(app))
        throw new Error("XUAN itself is updated through the XUAN release updater.");
    if (imageIsDigestPinned(app.image))
        throw new Error("This application is pinned to an immutable image digest.");
    const summary = containers.find((container) => container.Id === app.id);
    const runningImageId = summary?.ImageID ?? null;
    const checkedAt = new Date().toISOString();
    try {
        await pullImage(app.image);
        const candidateImageId = await inspectImageId(app.image);
        updateCheckCache.set(app.id, { image: app.image, runningImageId, candidateImageId, checkedAt, error: null });
        return updateItemState(app, runningImageId, candidateImageId, updateCheckCache.get(app.id));
    }
    catch (error) {
        const candidateImageId = await inspectImageId(app.image);
        const message = error instanceof Error ? error.message : "Unable to check this image in its registry.";
        updateCheckCache.set(app.id, { image: app.image, runningImageId, candidateImageId, checkedAt, error: message });
        return updateItemState(app, runningImageId, candidateImageId, updateCheckCache.get(app.id));
    }
}
const backupContainerRoot = "/backup-target";
const backupRepository = `${backupContainerRoot}/restic`;
const backupHistoryPath = `${backupContainerRoot}/atlas-history.json`;
function backupHostPath() {
    const configured = (firstEnv("XUAN_BACKUP_HOST_PATH", "ATLAS_BACKUP_HOST_PATH") || "/mnt/atlas-backup").trim();
    return configured.startsWith("/") ? configured : "/mnt/atlas-backup";
}
function hostPathInsideAtlas(source) {
    if (!source.startsWith("/"))
        return null;
    if (source === "/mnt/storage")
        return "/host/storage";
    if (source.startsWith("/mnt/storage/")) {
        return `/host/storage${source.slice("/mnt/storage".length)}`;
    }
    return `/host/root${source}`;
}
function backupProfileId(value) {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return slug || "application";
}
function backupRecipeRequired(app) {
    const searchable = `${app.name} ${app.container} ${app.image}`.toLowerCase();
    return /(nextcloud|immich|paperless|uptime[- ]?kuma|vaultwarden|postgres|mariadb|mysql)/.test(searchable);
}
function excludedBackupMount(mount) {
    const searchable = `${mount.source} ${mount.destination}`.toLowerCase();
    return (!mount.readWrite ||
        mount.source === "/var/run/docker.sock" ||
        /(\/cache(?:\/|$)|\/tmp(?:\/|$)|\/transcode(?:\/|$)|\/logs?(?:\/|$))/.test(searchable));
}
async function pathExists(pathname) {
    try {
        await fs.access(pathname);
        return true;
    }
    catch {
        return false;
    }
}
async function backupTargetState() {
    let engineAvailable = false;
    try {
        await runCommand("restic", ["version"], 4_000);
        engineAvailable = true;
    }
    catch {
        engineAvailable = false;
    }
    const targetPath = backupHostPath();
    const mounts = await hostMounts();
    const targetMount = mounts.find((entry) => entry.target === targetPath) ?? null;
    const rootMount = mounts.find((entry) => entry.target === "/") ?? null;
    const storageMount = mounts.find((entry) => entry.target === "/mnt/storage") ?? null;
    const sameAsPrimary = Boolean(targetMount) &&
        (targetMount?.source === rootMount?.source || targetMount?.source === storageMount?.source);
    const targetConfigured = Boolean(targetMount) && !sameAsPrimary;
    const repositoryInitialized = targetConfigured && (await pathExists(`${backupRepository}/config`));
    let message = "Backup destination is ready.";
    if (!engineAvailable) {
        message = "Restic is not available inside XUAN.";
    }
    else if (!backupPassword) {
        message = "XUAN backup encryption key is not configured.";
    }
    else if (!targetMount) {
        message = `Connect and mount a dedicated backup destination at ${targetPath}. XUAN will not treat a normal folder on the system disk as a backup target.`;
    }
    else if (sameAsPrimary) {
        message = "The selected backup target resolves to the same primary filesystem as XUAN data. Use a separate drive or remote filesystem.";
    }
    else if (!repositoryInitialized) {
        message = "Backup destination detected. XUAN will initialize the encrypted repository on the first backup.";
    }
    return {
        engineAvailable,
        keyConfigured: Boolean(backupPassword),
        targetConfigured,
        targetPath,
        targetSource: targetMount?.source ?? null,
        repositoryInitialized,
        message,
    };
}
async function readBackupHistory() {
    if (!(await pathExists(backupHistoryPath)))
        return {};
    try {
        const parsed = JSON.parse(await fs.readFile(backupHistoryPath, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
async function writeBackupHistory(history) {
    await fs.mkdir(backupContainerRoot, { recursive: true });
    await fs.writeFile(backupHistoryPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
async function getBackupProfiles() {
    const [target, apps, history] = await Promise.all([
        backupTargetState(),
        getAtlasApps(),
        readBackupHistory(),
    ]);
    const profiles = [];
    const atlasProjectPath = firstEnv("XUAN_PROJECT_PATH", "ATLAS_PROJECT_PATH") || "/home/wasim/docker/atlas";
    const atlasSource = hostPathInsideAtlas(atlasProjectPath);
    const atlasSourceReady = Boolean(atlasSource && (await pathExists(atlasSource)));
    const atlasHistory = history["atlas"] ?? null;
    profiles.push({
        id: "atlas",
        name: "XUAN",
        description: "XUAN source, configuration and local deployment files.",
        category: "Core",
        sourceCount: atlasSourceReady ? 1 : 0,
        state: atlasSourceReady ? "ready" : "no_sources",
        stateMessage: atlasSourceReady
            ? "XUAN project files are available for encrypted backup."
            : "XUAN project path could not be located from inside the container.",
        lastBackupAt: atlasHistory?.lastBackupAt ?? null,
        lastBackupSizeBytes: atlasHistory?.lastBackupSizeBytes ?? null,
        lastSnapshotId: atlasHistory?.lastSnapshotId ?? null,
        canRun: atlasSourceReady &&
            target.engineAvailable &&
            target.keyConfigured &&
            target.targetConfigured,
        sources: atlasSourceReady && atlasSource ? [atlasSource] : [],
    });
    for (const atlasApp of apps) {
        if (atlasApp.name.toLowerCase() === "atlas")
            continue;
        const profileId = backupProfileId(atlasApp.name);
        const candidateSources = Array.from(new Set(atlasApp.mounts
            .filter((mount) => !excludedBackupMount(mount))
            .map((mount) => hostPathInsideAtlas(mount.source))
            .filter((source) => Boolean(source)))).filter((source) => source !== atlasSource);
        const sources = [];
        for (const source of candidateSources) {
            if (await pathExists(source))
                sources.push(source);
        }
        const needsRecipe = backupRecipeRequired(atlasApp);
        const state = needsRecipe
            ? "needs_recipe"
            : sources.length > 0
                ? "ready"
                : "no_sources";
        const entry = history[profileId] ?? null;
        const stateMessage = state === "needs_recipe"
            ? "This application stores transactional data. XUAN will not make a live file-copy backup until a database-safe recipe is added."
            : state === "ready"
                ? "Persistent writable application data is available for encrypted backup."
                : "No suitable persistent writable mounts were discovered.";
        profiles.push({
            id: profileId,
            name: atlasApp.name,
            description: atlasApp.description,
            category: atlasApp.category,
            sourceCount: sources.length,
            state,
            stateMessage,
            lastBackupAt: entry?.lastBackupAt ?? null,
            lastBackupSizeBytes: entry?.lastBackupSizeBytes ?? null,
            lastSnapshotId: entry?.lastSnapshotId ?? null,
            canRun: state === "ready" &&
                sources.length > 0 &&
                target.engineAvailable &&
                target.keyConfigured &&
                target.targetConfigured,
            sources,
        });
    }
    return {
        target,
        profiles: profiles.sort((first, second) => {
            if (first.id === "atlas")
                return -1;
            if (second.id === "atlas")
                return 1;
            return first.name.localeCompare(second.name);
        }),
    };
}
function securityFinding(level, id, title, message, detail = null) {
    return { id, level, title, message, detail };
}
async function hostListeningOnPort(portNumber) {
    for (const pathname of ["/host/root/proc/net/tcp", "/host/root/proc/net/tcp6"]) {
        const content = await readText(pathname);
        if (!content)
            continue;
        for (const line of content.split("\n").slice(1)) {
            const columns = line.trim().split(/\s+/);
            if (columns.length < 4 || columns[3] !== "0A")
                continue;
            const localAddress = columns[1] ?? "";
            const hexadecimalPort = localAddress.split(":").at(-1);
            if (!hexadecimalPort)
                continue;
            if (Number.parseInt(hexadecimalPort, 16) === portNumber)
                return true;
        }
    }
    return false;
}
async function detectFirewallConfiguration() {
    try {
        const [ufw, nftables] = await Promise.all([
            readText("/host/root/etc/ufw/ufw.conf"),
            readText("/host/root/etc/nftables.conf"),
        ]);
        if (ufw && /^ENABLED=yes$/im.test(ufw)) {
            return {
                state: "configured",
                provider: "UFW configuration detected",
                message: "UFW is configured as enabled. XUAN cannot verify runtime packet-filter enforcement from inside its container.",
            };
        }
        if (nftables && /\btable\s+(?:inet|ip|ip6|arp|bridge|netdev)\b/i.test(nftables)) {
            return {
                state: "configured",
                provider: "nftables rules detected",
                message: "An nftables ruleset is configured. XUAN cannot verify whether that ruleset is currently loaded on the host.",
            };
        }
        return {
            state: "not_detected",
            provider: null,
            message: "XUAN did not find an enabled UFW configuration or an nftables ruleset. This does not prove that no firewall is active.",
        };
    }
    catch {
        return {
            state: "unknown",
            provider: null,
            message: "XUAN could not inspect host firewall configuration.",
        };
    }
}
async function getSecurityCenterStatus() {
    const [containers, firewall, sshListening, hostNetworkText] = await Promise.all([
        docker.listContainers({ all: true }),
        detectFirewallConfiguration(),
        hostListeningOnPort(22),
        readText("/host/root/proc/net/dev"),
    ]);
    const publishedPorts = [];
    for (const container of containers) {
        const name = container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12);
        for (const port of container.Ports ?? []) {
            if (typeof port.PublicPort !== "number")
                continue;
            const ip = port.IP || null;
            publishedPorts.push({
                container: name,
                image: container.Image,
                privatePort: port.PrivatePort,
                publicPort: port.PublicPort,
                protocol: port.Type,
                ip,
                allInterfaces: !ip || ip === "0.0.0.0" || ip === "::",
            });
        }
    }
    publishedPorts.sort((first, second) => first.publicPort - second.publicPort || first.container.localeCompare(second.container));
    const allInterfacePorts = publishedPorts.filter((item) => item.allInterfaces).length;
    const cloudflaredContainer = containers.find((container) => {
        const name = container.Names[0]?.replace(/^\//, "").toLowerCase() ?? "";
        return name.includes("cloudflared") || container.Image.toLowerCase().includes("cloudflare/cloudflared");
    });
    const cloudflared = cloudflaredContainer?.State === "running";
    const tailscale = Boolean(hostNetworkText?.split("\n").some((line) => /^\s*tailscale\d*:/i.test(line)) ||
        containers.some((container) => {
            const name = container.Names[0]?.replace(/^\//, "").toLowerCase() ?? "";
            const image = container.Image.toLowerCase();
            return (name.includes("tailscale") || image.includes("tailscale/tailscale")) && container.State === "running";
        }));
    const portainerContainerNames = new Set(containers
        .filter((container) => {
        const name = container.Names[0]?.replace(/^\//, "").toLowerCase() ?? "";
        return name.includes("portainer") || container.Image.toLowerCase().includes("portainer/");
    })
        .map((container) => container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12)));
    const portainerWidePorts = publishedPorts.filter((item) => portainerContainerNames.has(item.container) && item.allInterfaces);
    let dockerControlAccess = false;
    try {
        await docker.ping();
        dockerControlAccess = true;
    }
    catch {
        dockerControlAccess = false;
    }
    const findings = [];
    if (firewall.state === "configured") {
        findings.push(securityFinding("good", "firewall:configured", "Host firewall configuration detected", firewall.message, firewall.provider));
    }
    else if (firewall.state === "not_detected") {
        findings.push(securityFinding("warning", "firewall:not-detected", "No host firewall configuration detected", firewall.message, "Consider adding a Docker-aware host firewall after a second remote-access path such as Tailscale is available."));
    }
    else {
        findings.push(securityFinding("info", "firewall:unknown", "Firewall state could not be confirmed", firewall.message));
    }
    if (cloudflared) {
        findings.push(securityFinding("good", "remote:cloudflared", "Cloudflare Tunnel connector is running", "XUAN detected a running cloudflared container. Cloudflare dashboard routes and Access policies remain outside XUAN visibility.", cloudflaredContainer?.Names[0]?.replace(/^\//, "") ?? null));
    }
    else {
        findings.push(securityFinding("info", "remote:cloudflared-missing", "Cloudflare Tunnel connector is not running", "XUAN did not detect a running cloudflared container. Ignore this if remote access is intentionally disabled."));
    }
    if (tailscale) {
        findings.push(securityFinding("good", "remote:tailscale", "Tailscale is available", "A Tailscale interface or running container was detected, giving the server a second private remote-access path."));
    }
    else {
        findings.push(securityFinding("info", "remote:tailscale-missing", "Tailscale is not detected", "Tailscale remains optional, but it is useful as a private fallback for SSH and Portainer before changing firewall rules."));
    }
    if (sshListening) {
        findings.push(securityFinding("info", "ssh:listening", "SSH is listening on port 22", "SSH is reachable on at least one host interface. XUAN cannot determine router port-forwarding from inside the server."));
    }
    else {
        findings.push(securityFinding("good", "ssh:not-listening", "No SSH listener detected on port 22", "XUAN did not find a host TCP listener on port 22."));
    }
    if (portainerWidePorts.length > 0) {
        findings.push(securityFinding("warning", "portainer:all-interfaces", "Portainer is published on all host interfaces", "Portainer is an administrative service with Docker control. Keep it limited to trusted LAN/Tailscale access or place strong access control in front of any remote route.", portainerWidePorts.map((item) => `${item.ip || "0.0.0.0"}:${item.publicPort}/${item.protocol}`).join(", ")));
    }
    else if (portainerContainerNames.size > 0) {
        findings.push(securityFinding("good", "portainer:limited", "Portainer does not have an all-interface published port", "XUAN detected Portainer without a Docker port bound to all host interfaces."));
    }
    if (allInterfacePorts > 0) {
        findings.push(securityFinding("info", "docker:published-ports", "Docker services publish host ports", `${allInterfacePorts} published Docker port${allInterfacePorts === 1 ? " is" : "s are"} bound to all host interfaces. This means LAN/host exposure, not automatically Internet exposure.`, publishedPorts.filter((item) => item.allInterfaces).map((item) => `${item.container}:${item.publicPort}/${item.protocol}`).join(", ")));
    }
    else {
        findings.push(securityFinding("good", "docker:no-wide-ports", "No Docker ports are bound to all interfaces", "XUAN did not detect any published Docker ports listening on every host interface."));
    }
    findings.push(securityFinding(dockerControlAccess ? "info" : "warning", "atlas:docker-control", dockerControlAccess ? "XUAN has Docker control access" : "XUAN cannot reach the Docker daemon", dockerControlAccess
        ? "Start, stop, restart, logs and update checks require elevated Docker access. Keep XUAN authentication and remote access controls strong."
        : "Application controls, logs and update checks may not work until Docker access is restored.", "/var/run/docker.sock"));
    if (controlPassword) {
        findings.push(securityFinding("good", "atlas:control-password", "Privileged XUAN actions are password protected", "XUAN control, logs, backups and image checks require the configured control password."));
    }
    else {
        findings.push(securityFinding("info", "atlas:controls-disabled", "Privileged XUAN actions are disabled", "No XUAN control password is configured, so protected management actions are unavailable."));
    }
    findings.sort((first, second) => {
        const rank = { critical: 0, warning: 1, info: 2, good: 3 };
        return rank[first.level] - rank[second.level] || first.title.localeCompare(second.title);
    });
    return {
        summary: {
            good: findings.filter((item) => item.level === "good").length,
            warning: findings.filter((item) => item.level === "warning").length,
            critical: findings.filter((item) => item.level === "critical").length,
            info: findings.filter((item) => item.level === "info").length,
        },
        firewall,
        remoteAccess: {
            cloudflared,
            cloudflaredState: cloudflaredContainer?.State ?? null,
            tailscale,
            sshListening,
        },
        docker: {
            controlAccess: dockerControlAccess,
            publishedPorts,
            allInterfacePorts,
        },
        findings,
        timestamp: new Date().toISOString(),
    };
}
function notificationRank(severity) {
    if (severity === "critical")
        return 0;
    if (severity === "warning")
        return 1;
    return 2;
}
function makeNotification(severity, id, title, message, source, actionUrl = null) {
    return {
        id,
        severity,
        title,
        message,
        source,
        createdAt: new Date().toISOString(),
        actionUrl,
    };
}
async function getNotificationCenterStatus() {
    const [system, storage, dockerMetrics, apps, backupState, updateState, securityState] = await Promise.all([
        getSystemMetrics(),
        getStorageMetrics(),
        getDockerMetrics(),
        getAtlasApps(),
        getBackupProfiles(),
        getUpdateCenterStatus(),
        getSecurityCenterStatus(),
    ]);
    const notifications = [];
    if (system.cpu.usage >= 95) {
        notifications.push(makeNotification("critical", "system:cpu:critical", "CPU usage is critically high", `CPU usage is ${system.cpu.usage.toFixed(1)}%. Check active workloads and container activity.`, "System"));
    }
    else if (system.cpu.usage >= 85) {
        notifications.push(makeNotification("warning", "system:cpu:warning", "CPU usage is high", `CPU usage is ${system.cpu.usage.toFixed(1)}%. XUAN will keep watching it.`, "System"));
    }
    if (system.cpu.temperature !== null) {
        if (system.cpu.temperature >= 85) {
            notifications.push(makeNotification("critical", "system:cpu-temperature:critical", "CPU temperature is critical", `CPU temperature is ${system.cpu.temperature.toFixed(0)}°C. Check cooling and airflow.`, "System"));
        }
        else if (system.cpu.temperature >= 75) {
            notifications.push(makeNotification("warning", "system:cpu-temperature:warning", "CPU temperature is elevated", `CPU temperature is ${system.cpu.temperature.toFixed(0)}°C.`, "System"));
        }
    }
    if (system.memory.usage >= 97) {
        notifications.push(makeNotification("critical", "system:memory:critical", "Memory is almost exhausted", `${system.memory.usage.toFixed(1)}% of system memory is currently in use.`, "System"));
    }
    else if (system.memory.usage >= 90) {
        notifications.push(makeNotification("warning", "system:memory:warning", "Memory usage is high", `${system.memory.usage.toFixed(1)}% of system memory is currently in use.`, "System"));
    }
    for (const drive of storage) {
        if (drive.health === "critical") {
            notifications.push(makeNotification("critical", `storage:${drive.mount}:critical`, `${drive.name} needs immediate attention`, drive.healthMessage, "Storage"));
        }
        else if (drive.health === "warning") {
            notifications.push(makeNotification("warning", `storage:${drive.mount}:warning`, `${drive.name} needs attention`, drive.healthMessage, "Storage"));
        }
    }
    for (const atlasApp of apps) {
        if (atlasApp.health === "unhealthy") {
            notifications.push(makeNotification("critical", `app:${atlasApp.id}:unhealthy`, `${atlasApp.name} is unhealthy`, `${atlasApp.container} is running but its health check is reporting an unhealthy state.`, "Applications", /^https?:\/\//i.test(atlasApp.url) ? atlasApp.url : null));
            continue;
        }
        if (atlasApp.state === "restarting") {
            notifications.push(makeNotification("warning", `app:${atlasApp.id}:restarting`, `${atlasApp.name} is restarting`, `${atlasApp.container} is currently restarting.`, "Applications", /^https?:\/\//i.test(atlasApp.url) ? atlasApp.url : null));
        }
        else if (atlasApp.state !== "running") {
            notifications.push(makeNotification("warning", `app:${atlasApp.id}:offline`, `${atlasApp.name} is offline`, `${atlasApp.container} is ${atlasApp.state || "not running"}.`, "Applications", /^https?:\/\//i.test(atlasApp.url) ? atlasApp.url : null));
        }
    }
    if (dockerMetrics.restarting > 0 && !notifications.some((item) => item.id.includes(":restarting"))) {
        notifications.push(makeNotification("warning", "docker:restarting", "Docker containers are restarting", `${dockerMetrics.restarting} container${dockerMetrics.restarting === 1 ? " is" : "s are"} currently restarting.`, "Docker"));
    }
    const { target, profiles } = backupState;
    if (!target.engineAvailable) {
        notifications.push(makeNotification("critical", "backup:engine", "Backup engine is unavailable", target.message, "Backup Center"));
    }
    else if (!target.keyConfigured) {
        notifications.push(makeNotification("critical", "backup:key", "Backup encryption key is missing", target.message, "Backup Center"));
    }
    else if (!target.targetConfigured) {
        notifications.push(makeNotification("info", "backup:target", "Backup destination is not connected", "XUAN is ready for backups, but a dedicated destination is not mounted at /mnt/atlas-backup yet.", "Backup Center"));
    }
    else {
        const now = Date.now();
        for (const profile of profiles) {
            if (profile.state !== "ready")
                continue;
            if (!profile.lastBackupAt) {
                notifications.push(makeNotification("warning", `backup:${profile.id}:never`, `${profile.name} has not been backed up yet`, "The backup destination is ready, but this profile does not have a completed snapshot.", "Backup Center"));
                continue;
            }
            const backupAge = now - new Date(profile.lastBackupAt).getTime();
            if (Number.isFinite(backupAge) && backupAge > 48 * 60 * 60 * 1000) {
                notifications.push(makeNotification("warning", `backup:${profile.id}:stale`, `${profile.name} backup is getting old`, `The last successful backup was ${profile.lastBackupAt}.`, "Backup Center"));
            }
        }
        const recipeCount = profiles.filter((profile) => profile.state === "needs_recipe").length;
        if (recipeCount > 0) {
            notifications.push(makeNotification("info", "backup:recipes", "Database-safe backup recipes are still pending", `${recipeCount} application${recipeCount === 1 ? " needs" : "s need"} a database-safe recipe before Atlas can back it up.`, "Backup Center"));
        }
    }
    if (updateState.summary.available > 0) {
        notifications.push(makeNotification("info", "updates:available", "Container image updates are ready", `${updateState.summary.available} application image${updateState.summary.available === 1 ? " is" : "s are"} downloaded and waiting for a controlled redeploy.`, "Update Center", null));
    }
    for (const finding of securityState.findings) {
        if (finding.level !== "warning" && finding.level !== "critical")
            continue;
        notifications.push(makeNotification(finding.level, `security:${finding.id}`, finding.title, finding.message, "Security Center", null));
    }
    notifications.sort((first, second) => {
        const severityDifference = notificationRank(first.severity) - notificationRank(second.severity);
        if (severityDifference !== 0)
            return severityDifference;
        return first.title.localeCompare(second.title);
    });
    return {
        summary: {
            total: notifications.length,
            critical: notifications.filter((item) => item.severity === "critical").length,
            warning: notifications.filter((item) => item.severity === "warning").length,
            info: notifications.filter((item) => item.severity === "info").length,
        },
        notifications,
        timestamp: new Date().toISOString(),
    };
}
function resticEnvironment() {
    return {
        ...process.env,
        RESTIC_REPOSITORY: backupRepository,
        RESTIC_PASSWORD: backupPassword,
        RESTIC_CACHE_DIR: "/tmp/atlas-restic-cache",
    };
}
function runRestic(args, timeoutMs = 60 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const child = spawn("restic", args, {
            env: resticEnvironment(),
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let finished = false;
        const timer = setTimeout(() => {
            if (finished)
                return;
            child.kill("SIGKILL");
        }, timeoutMs);
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > 8_000_000)
                stdout = stdout.slice(-8_000_000);
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 1_000_000)
                stderr = stderr.slice(-1_000_000);
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            finished = true;
            reject(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            finished = true;
            if (code === 0) {
                resolve(stdout);
            }
            else {
                reject(new Error(stderr.trim() || `restic exited with status ${code ?? "unknown"}`));
            }
        });
    });
}
async function ensureResticRepository() {
    if (await pathExists(`${backupRepository}/config`))
        return;
    await fs.mkdir(backupRepository, { recursive: true });
    await runRestic(["init"], 60_000);
}
function parseResticSummary(output) {
    let bytes = null;
    let snapshotId = null;
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{"))
            continue;
        try {
            const item = JSON.parse(trimmed);
            if (item.message_type === "summary") {
                if (typeof item.total_bytes_processed === "number") {
                    bytes = item.total_bytes_processed;
                }
                if (typeof item.snapshot_id === "string") {
                    snapshotId = item.snapshot_id;
                }
            }
        }
        catch {
            // Ignore non-JSON diagnostic output.
        }
    }
    return { bytes, snapshotId };
}
function publicBackupProfile(profile) {
    const { sources: _sources, ...visible } = profile;
    return visible;
}
app.disable("x-powered-by");
app.use(express.json());
pluginManager.register(corePlugin);
app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "xuan", legacyService: "atlas", timestamp: new Date().toISOString() });
});
app.get("/api/config", (_request, response) => {
    const xuanTitle = firstEnv("XUAN_TITLE");
    const legacyTitle = firstEnv("ATLAS_TITLE");
    const xuanTagline = firstEnv("XUAN_TAGLINE");
    const legacyTagline = firstEnv("ATLAS_TAGLINE");
    const title = xuanTitle || (legacyTitle && legacyTitle.trim().toUpperCase() !== "ATLAS" ? legacyTitle : "XUAN");
    const tagline = xuanTagline || (legacyTagline && legacyTagline !== "Your homelab, floating quietly in the glass."
        ? legacyTagline
        : "Quiet power at the center of your digital realm.");
    response.json({
        title,
        owner: firstEnv("XUAN_OWNER", "ATLAS_OWNER") || "Wasim",
        tagline,
        version: "3.1.0",
        legacyLabelSupport: true,
    });
});
app.get("/api/auth/status", (request, response) => {
    const session = atlasSessionFromRequest(request);
    response.setHeader("Cache-Control", "no-store");
    response.json({
        configured: Boolean(loginPassword),
        authenticated: Boolean(session),
        username: session?.username ?? null,
        expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    });
});
app.post("/api/auth/login", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!loginPassword) {
        response.status(503).json({
            error: "XUAN login is not configured on the server.",
            code: "XUAN_LOGIN_NOT_CONFIGURED",
        });
        return;
    }
    const clientKey = loginClientKey(request);
    if (!canAttemptLogin(clientKey)) {
        response.status(429).json({
            error: "Too many sign-in attempts. Try again in a few minutes.",
            code: "XUAN_LOGIN_RATE_LIMITED",
        });
        return;
    }
    const suppliedUsername = typeof request.body?.username === "string" ? request.body.username.trim() : "";
    const suppliedPassword = typeof request.body?.password === "string" ? request.body.password : "";
    const remember = request.body?.remember === true;
    const usernameMatches = suppliedUsername.localeCompare(loginUsername, undefined, { sensitivity: "accent" }) === 0;
    if (!usernameMatches || !loginPasswordMatches(suppliedPassword)) {
        noteFailedLogin(clientKey);
        response.status(401).json({
            error: "Invalid username or password.",
            code: "XUAN_LOGIN_INVALID",
        });
        return;
    }
    clearFailedLogin(clientKey);
    const now = Date.now();
    const session = {
        id: randomBytes(32).toString("base64url"),
        username: loginUsername,
        createdAt: now,
        expiresAt: now + (remember ? rememberedSessionMs : defaultSessionMs),
    };
    atlasSessions.set(session.id, session);
    setAtlasSessionCookie(request, response, session);
    response.json({
        ok: true,
        username: session.username,
        expiresAt: new Date(session.expiresAt).toISOString(),
    });
});
app.post("/api/auth/logout", (request, response) => {
    const sessionId = parseCookies(request.header("cookie"))[sessionCookieName];
    if (sessionId)
        atlasSessions.delete(sessionId);
    clearAtlasSessionCookie(request, response);
    response.setHeader("Cache-Control", "no-store");
    response.json({ ok: true });
});
// Everything below this line is private Atlas API data. The SPA itself remains
// public so it can render the sign-in screen, but no host metrics, applications,
// backups, security findings or controls are returned without an authenticated session.
app.use("/api", requireAtlasSession);
app.get("/api/plugins", (_request, response) => {
    response.json({ plugins: pluginManager.list() });
});
app.get("/api/system", async (_request, response) => {
    try {
        response.json(await getSystemMetrics());
    }
    catch (error) {
        console.error("System metrics error:", error);
        response.status(500).json({ error: "Unable to retrieve system metrics." });
    }
});
app.get("/api/storage", async (_request, response) => {
    try {
        response.json({ drives: await getStorageMetrics() });
    }
    catch (error) {
        console.error("Storage metrics error:", error);
        response.status(500).json({ error: "Unable to retrieve storage metrics." });
    }
});
app.get("/api/docker", async (_request, response) => {
    try {
        response.json(await getDockerMetrics());
    }
    catch (error) {
        console.error("Docker metrics error:", error);
        response.status(500).json({ error: "Unable to retrieve Docker information." });
    }
});
app.get("/api/apps", async (_request, response) => {
    try {
        response.json({ apps: await getAtlasApps() });
    }
    catch (error) {
        console.error("XUAN apps error:", error);
        response.status(500).json({ error: "Unable to discover XUAN applications." });
    }
});
app.get("/api/apps/:id/logs", async (request, response) => {
    const auth = controlAuthFromRequest(request);
    if (!auth.ok) {
        response.status(auth.status).json({ error: auth.error });
        return;
    }
    try {
        const containers = await docker.listContainers({ all: true });
        const summary = containers.find((container) => container.Id === request.params.id || container.Id.startsWith(request.params.id));
        if (!summary) {
            response.status(404).json({ error: "Application container was not found." });
            return;
        }
        if (!appLabelEnabled(summary.Labels)) {
            response.status(403).json({ error: "Logs are available only for XUAN/Atlas-labelled applications." });
            return;
        }
        const lines = requestedLogLines(request.query.lines);
        const rawLogs = await docker.getContainer(summary.Id).logs({
            stdout: true,
            stderr: true,
            tail: lines,
            timestamps: true,
        });
        response.setHeader("Cache-Control", "no-store");
        response.json({
            container: summary.Names[0]?.replace(/^\//, "") ?? summary.Id.slice(0, 12),
            lines,
            logs: decodeDockerLogs(rawLogs),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error("XUAN logs error:", error);
        response.status(500).json({ error: "Unable to retrieve application logs." });
    }
});
app.get("/api/security", async (_request, response) => {
    try {
        response.setHeader("Cache-Control", "no-store");
        response.json(await getSecurityCenterStatus());
    }
    catch (error) {
        console.error("Security Center error:", error);
        response.status(500).json({ error: "Unable to retrieve XUAN security status." });
    }
});
app.get("/api/updates/status", async (_request, response) => {
    try {
        response.setHeader("Cache-Control", "no-store");
        response.json(await getUpdateCenterStatus());
    }
    catch (error) {
        console.error("XUAN Update Center status error:", error);
        response.status(500).json({ error: "Unable to retrieve XUAN update status." });
    }
});
app.post("/api/updates/:id/check", async (request, response) => {
    const auth = controlAuthFromRequest(request);
    if (!auth.ok) {
        response.status(auth.status).json({ error: auth.error });
        return;
    }
    try {
        const item = await checkApplicationImageUpdate(request.params.id);
        response.setHeader("Cache-Control", "no-store");
        response.json({ item, timestamp: new Date().toISOString() });
    }
    catch (error) {
        console.error("XUAN Update Center check error:", error);
        response.status(400).json({
            error: error instanceof Error ? error.message : "Unable to check this application image.",
        });
    }
});
app.get("/api/notifications", async (_request, response) => {
    try {
        response.setHeader("Cache-Control", "no-store");
        response.json(await getNotificationCenterStatus());
    }
    catch (error) {
        console.error("Notification Center error:", error);
        response.status(500).json({ error: "Unable to retrieve XUAN notifications." });
    }
});
app.get("/api/backups/status", async (_request, response) => {
    try {
        const { target, profiles } = await getBackupProfiles();
        response.setHeader("Cache-Control", "no-store");
        response.json({
            engine: "restic",
            target,
            profiles: profiles.map(publicBackupProfile),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error("Backup status error:", error);
        response.status(500).json({ error: "Unable to retrieve XUAN backup status." });
    }
});
app.post("/api/backups/:profileId/run", async (request, response) => {
    const auth = controlAuthFromRequest(request);
    if (!auth.ok) {
        response.status(auth.status).json({ error: auth.error });
        return;
    }
    try {
        const { target, profiles } = await getBackupProfiles();
        const profile = profiles.find((item) => item.id === request.params.profileId);
        if (!profile) {
            response.status(404).json({ error: "Backup profile was not found." });
            return;
        }
        if (!target.engineAvailable || !target.keyConfigured) {
            response.status(503).json({ error: target.message });
            return;
        }
        if (!target.targetConfigured) {
            response.status(409).json({ error: target.message });
            return;
        }
        if (!profile.canRun || profile.state !== "ready" || profile.sources.length === 0) {
            response.status(409).json({ error: profile.stateMessage });
            return;
        }
        await ensureResticRepository();
        const output = await runRestic([
            "backup",
            "--json",
            "--tag",
            "atlas",
            "--tag",
            `profile:${profile.id}`,
            "--exclude-caches",
            ...profile.sources,
        ]);
        const summary = parseResticSummary(output);
        const completedAt = new Date().toISOString();
        const history = await readBackupHistory();
        history[profile.id] = {
            lastBackupAt: completedAt,
            lastBackupSizeBytes: summary.bytes,
            lastSnapshotId: summary.snapshotId,
        };
        await writeBackupHistory(history);
        pluginManager.emit({
            pluginId: "core",
            type: "backup:complete",
            payload: {
                profileId: profile.id,
                name: profile.name,
                completedAt,
                bytes: summary.bytes,
                snapshotId: summary.snapshotId,
            },
        });
        response.json({
            ok: true,
            profileId: profile.id,
            completedAt,
            bytes: summary.bytes,
            snapshotId: summary.snapshotId,
        });
    }
    catch (error) {
        console.error("XUAN backup error:", error);
        response.status(500).json({
            error: error instanceof Error ? error.message : "XUAN backup failed.",
        });
    }
});
app.get("/api/control/status", (_request, response) => {
    response.json({ configured: Boolean(controlPassword) });
});
app.post("/api/control/verify", (request, response) => {
    const auth = controlAuthFromRequest(request);
    if (!auth.ok) {
        response.status(auth.status).json({ error: auth.error });
        return;
    }
    response.json({ ok: true });
});
app.post("/api/apps/:id/actions/:action", async (request, response) => {
    const auth = controlAuthFromRequest(request);
    if (!auth.ok) {
        response.status(auth.status).json({ error: auth.error });
        return;
    }
    const action = request.params.action;
    if (!["start", "stop", "restart"].includes(action)) {
        response.status(400).json({ error: "Unsupported container action." });
        return;
    }
    try {
        const containers = await docker.listContainers({ all: true });
        const summary = containers.find((container) => container.Id === request.params.id || container.Id.startsWith(request.params.id));
        if (!summary) {
            response.status(404).json({ error: "Application container was not found." });
            return;
        }
        if (!isControllableContainer(summary)) {
            response.status(403).json({
                error: "This application is protected from XUAN control actions.",
            });
            return;
        }
        const container = docker.getContainer(summary.Id);
        if (action === "start") {
            if (summary.State === "running") {
                response.status(409).json({ error: "Application is already running." });
                return;
            }
            await container.start();
        }
        else if (action === "stop") {
            if (summary.State !== "running" && summary.State !== "restarting") {
                response.status(409).json({ error: "Application is not currently running." });
                return;
            }
            await container.stop({ t: 10 });
        }
        else {
            if (summary.State !== "running") {
                response.status(409).json({ error: "Start the application before restarting it." });
                return;
            }
            await container.restart({ t: 10 });
        }
        pluginManager.emit({
            pluginId: "core",
            type: "app:control",
            payload: {
                appId: summary.Id,
                container: summary.Names[0]?.replace(/^\//, "") ?? summary.Id.slice(0, 12),
                action,
            },
        });
        const refreshed = (await getAtlasApps()).find((item) => item.id === summary.Id) ?? null;
        response.json({ ok: true, action, app: refreshed });
    }
    catch (error) {
        console.error("XUAN control action error:", error);
        response.status(500).json({ error: "XUAN could not complete the container action." });
    }
});
io.use((socket, next) => {
    if (!loginPassword) {
        next(new Error("XUAN login is not configured."));
        return;
    }
    const cookies = parseCookies(socket.request.headers.cookie);
    const session = validAtlasSession(cookies[sessionCookieName]);
    if (!session) {
        next(new Error("Authentication required."));
        return;
    }
    socket.data.atlasSessionId = session.id;
    next();
});
function authenticatedSockets() {
    const sockets = [...io.sockets.sockets.values()];
    return sockets.filter((socket) => {
        const sessionId = typeof socket.data.atlasSessionId === "string" ? socket.data.atlasSessionId : "";
        if (validAtlasSession(sessionId))
            return true;
        socket.disconnect(true);
        return false;
    });
}
pluginManager.onEvent((event) => {
    for (const socket of authenticatedSockets()) {
        socket.emit("xuan:event", event);
        socket.emit("atlas:event", event);
    }
});
io.on("connection", (socket) => {
    socket.emit("xuan:connected", {
        status: "connected",
        timestamp: new Date().toISOString(),
        plugins: pluginManager.list(),
    });
});
let metricsCollectionBusy = false;
setInterval(async () => {
    if (metricsCollectionBusy)
        return;
    const sockets = authenticatedSockets();
    if (sockets.length === 0)
        return;
    metricsCollectionBusy = true;
    try {
        const payload = {
            system: await getSystemMetrics(),
            storage: await getStorageMetrics(),
            docker: await getDockerMetrics(),
            timestamp: new Date().toISOString(),
        };
        for (const socket of sockets)
            socket.emit("metrics", payload);
    }
    catch (error) {
        console.error("Live metrics error:", error);
    }
    finally {
        metricsCollectionBusy = false;
    }
}, 5000);
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of atlasSessions) {
        if (session.expiresAt <= now)
            atlasSessions.delete(id);
    }
    for (const [key, bucket] of failedLoginAttempts) {
        if (bucket.resetAt <= now)
            failedLoginAttempts.delete(key);
    }
}, 60_000).unref();
await pluginManager.initializeAll();
app.use(express.static(frontendDirectory));
app.get("*", (_request, response) => {
    response.sendFile(path.join(frontendDirectory, "index.html"));
});
httpServer.listen(port, "0.0.0.0", () => {
    console.log(`XUAN is listening on port ${port}`);
});
