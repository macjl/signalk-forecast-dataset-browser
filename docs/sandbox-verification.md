# Sandbox verification

## npm publication preparation

The first registry version is prepared as 0.1.0-beta.1. The recorded 0.1.0/0.1.1
sandbox checks below describe local snapshots; the installed sandbox has not
been changed by publication preparation. The package now declares its GitHub
metadata, App Store screenshots and the standard Signal K/npm workflows.
See [publishing instructions](../RELEASING.md).

For the sandbox helpers, explicitly set `SIGNALK_NODE_CONFIG_DIR` to the selected
server's configuration directory. Pass it into Docker as well, for example
`docker exec -e SIGNALK_NODE_CONFIG_DIR=/home/node/.signalk ...`. The host-side
verification helper forwards this variable into its Docker commands. This makes
the helper source portable without assuming a particular user's home directory.

Target: the existing `signalk-sandbox` container, Signal K 2.34.0 with Forecast
Dataset Provider 0.1.0. Browser package: `signalk-forecast-dataset-browser` 0.1.0.

The browser has no runtime dependencies, server routes, private token store or
background jobs. Its plugin entry only supplies status and webapp discovery.
All catalogue actions use the current user's same-origin Signal K session.

## Installation helper

Build an npm archive with `npm pack`, copy it under the selected sandbox's
`/home/node/.signalk/local-packages/`, then run `tools/install-sandbox.cjs` as root
inside that container with the archive's absolute path. The helper asserts
`SIGNALK_CONTAINER_ID=signalk-sandbox`. Updates require a previous installation
backup from this helper and preserve the browser configuration.

It checks the provider contract before installation, backs up root manifests,
records configuration hashes and existing dataset IDs, extracts only this
package and enables only this new plugin. Other dependency trees are not
re-resolved. Restart the existing container to discover the new webapp; do not
pull/recreate the server or replace its mounts/overlays.

`local-packages/forecast-browser-install-backup.json` records the private backup
location and the initial pre-install baseline (`initialBackup`). To roll back, stop the browser plugin, remove only its installed
package/configuration and restore the initial pre-install manifests, then restart the
existing container. There is no application data to migrate or delete.

## Verification

`tools/verify-sandbox.cjs` runs on the host with Docker and Playwright available.
It captures a temporary administrator JWT from the explicitly selected sandbox
into memory and uses HttpOnly cookies for the browser. No credentials are saved
in the project or logs. It exercises the actual installed webapp and catalogue:

- Discovery under Signal K's Webapps list and successful static asset delivery.
- Existing real dataset metadata and original-file listing in the UI.
- Desktop/mobile layouts, with no page JavaScript errors or horizontal overflow.
- Readonly consultation using the Weather Provider's existing readonly token;
  no enabled deletion controls.
- Publication of one uniquely named **synthetic JSON analysis dataset**, followed
  by cancellation and then confirmed deletion through the real UI. JSON/analysis
  keeps the fixture out of the GRIB Weather Provider's forecast discovery.
- Absence of the synthetic dataset after deletion, preservation of all
  pre-existing datasets/configurations and no other browser-initiated DELETE.

The helper's cleanup deletes only the synthetic dataset/publication IDs it
created. No existing real dataset is deleted during verification. Screenshots
are generated from the running sandbox after fixture cleanup.

Local tests separately exercise pagination beyond 100 datasets, stale identities,
metadata escaping, changed content, busy 409 conflicts, permission denial,
anonymous access, search/filter behavior and cancellation. Contract 0.1 has no
conditional DELETE or catalogue snapshot pagination: the browser detects common
races but does not claim transactional guarantees absent from the provider.

## Recorded result (2026-10-21)

Validation passed: **11 client tests and 10 browser tests**. Live verification
also passed against the installed webapp, including readonly consultation,
cancelled deletion, then confirmed deletion of the synthetic JSON fixture.
The pre-existing real dataset remained present with its 129 assets. No browser
JavaScript errors occurred. The initial installation preserved all 45 existing
plugin configurations and 43 other root dependencies; the subsequent package
update also preserved the new browser configuration. Installed frontend file
hashes match the source files. Desktop and mobile screenshots are recorded under
`docs/screenshots/` after test-data cleanup.

## Streaming monitoring 0.1.1 (2026-10-21)

Browser and Provider 0.1.1 were updated in the same sandbox with configuration and existing datasets preserved. The new browser backup is `local-packages/forecast-browser-before-install-2026-10-21T15-44-23-664Z`. No runtime dependency tree was re-resolved.

Validation passed: **12 client tests, 12 UI tests**, plus the actual installed browser. The live UI displayed an unknown-size synthetic JSON acquisition as pending, receiving and ready before explicit commit, then automatically refreshed the complete catalogue after commit. Unknown totals stayed indeterminate. Readonly users retained published-data consultation and could not access staging. Desktop/mobile layouts had no horizontal overflow or page JavaScript errors.

The 2 pre-existing real datasets, all 46 plugin configurations and 43 unrelated root dependencies remained unchanged. Only the synthetic test acquisition was published/deleted; its staging was cleaned up. Source screenshots now include `acquisition-desktop.png` and `acquisition-mobile.png` during the test stream, and refreshed catalogue screenshots after cleanup. Chromium used the already extracted libraries at `/tmp/forecast-browser-libs/root/usr/lib/aarch64-linux-gnu`; no host system package changes were needed.

This adds browser monitoring and provider support, not a refactor of the downloader's acquisition pipeline. The provider's stream progress is volatile and the explicit producer commit remains necessary.

## npm release preparation (2026-10-21)

The first public package is prepared as **0.1.0-beta.1**. Local checks passed:

- All 12 client tests on Node 20.19.2 and Node 24, plus syntax checks.
- All 12 Chromium interface tests, including acquisition monitoring.
- The official Signal K workflow's package metadata validation.
- Workflow YAML parsing, Bash syntax checks and simulated release tag/channel
  checks for alpha, beta, rc, next and stable releases.
- `npm publish --dry-run --tag beta`, including the prepublish checks.
- Installation of the actual npm archive with `--ignore-scripts --omit=dev`,
  followed by plugin start/stop and verification of declared icons/screenshots.

The archive contains 17 files and excludes tests, deployment helpers, workflows,
node_modules and credentials. The Node 24 check used an isolated temporary
directory in the existing container; no installed plugin or configuration was
changed. No registry write, GitHub release or sandbox redeployment was performed.
Hosted CI, real-server integration and npm OIDC publishing remain to be verified
on GitHub after the setup described in [RELEASING.md](../RELEASING.md).
