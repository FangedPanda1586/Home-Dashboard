# XUAN 3.1.0 — Obsidian redesign

An update to the XUAN 3.0.7 home-server dashboard, prepared from the latest available saved source. This package has not been installed on your live server.

## Install

Upload and extract this ZIP on your server. Open a terminal in the extracted `xuan-3.1.0` folder and run:

```bash
bash apply-update.sh
```

The default installation directory is `~/docker/atlas`. If yours differs:

```bash
bash apply-update.sh /absolute/path/to/your/xuan
```

The updater requires the existing 3.0.7 source and a running Compose service named `atlas`. For a renamed service, set `XUAN_SERVICE` to its name. For a different health-check address, set `XUAN_HEALTH_URL` (default `http://127.0.0.1:3000`). It backs up changed files, builds with Docker's existing cache, restarts only the dashboard service, checks version and health, and attempts rollback if the update fails. Docker, Compose, Python 3 and curl are required.

Your Compose file, environment settings, volumes, passwords, port and application labels are retained. Dependency manifests and the Dockerfile are unchanged to reuse existing dependency layers where available. A source build still needs to run. This archive contains source plus a compiled frontend, not a fresh-server installer.

## Design

- Obsidian panels, restrained violet accents, clearer typography and a compact artwork welcome card.
- Full desktop navigation and responsive metrics; tablet and phone layouts with a safe-area-aware bottom navigation bar.
- Larger controls, visible keyboard focus, a skip link, 16px form inputs and reduced-motion support.
- Restyled login, service launcher, system health, shared panels, forms and widget editor.
- Existing routes, login, container controls, logs, backups, updates, security, notifications and custom widgets remain connected to the existing backend.

## Resource use

- Removed stacked backdrop blur and full-screen dashboard artwork layers. Existing local WebP artwork remains in the compact welcome card and sign-in screen.
- Clock updates every 30 seconds instead of every second (display still shows hours and minutes).
- Application discovery every 30 seconds instead of 10; notification checks every 30 instead of 15; backup status every 60 instead of 30; update status every 120 instead of 60 seconds.
- These polls run serially, pause while hidden, and refresh on returning. Notifications keep background polling only when browser alerts are enabled.
- Live metric socket disconnects in hidden tabs and reconnects on return. Visible telemetry keeps the existing five-second cadence. Backend collection cannot overlap itself.
- Container log refresh every five seconds instead of 2.5, and pauses in hidden tabs.

Slower background status refresh trades a short detection delay for fewer requests. Actual CPU, RAM and battery savings depend on the server and browser; no measured performance percentage is claimed.

## Validation

Frontend and backend TypeScript production builds. Focused polling checks for request overlap, hidden-tab pause, immediate resume, disposal and enabled background alerts. Mocked installer success and build-failure rollback checks passed, with configuration preserved. Desktop and mobile browser previews were inspected with sample data; legacy blur and mobile layout overrides were corrected. No live Docker deployment was performed.

## Manual recovery

The updater prints its backup directory. It contains the previous versions of the seven changed files; `.absent` markers identify new files which did not exist before the update. The old Docker image is also tagged `xuan-rollback:before-3.1.0`. Retain that backup until you have reviewed the update on your own desktop and phone.
