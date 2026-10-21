# Changelog

## 0.1.0-beta.1 — 2026-10-21

- Prepare the first public beta with catalogue browsing, confirmed deletion and
  live acquisition monitoring from local development snapshots 0.1.0/0.1.1.
- Add the reusable Signal K plugin CI, Chromium interface checks and npm
  publishing through GitHub Actions with OIDC/provenance and prerelease tags.
- Supply repository metadata, App Store screenshots and publication instructions.

## 0.1.1 — 2026-10-21

- Show unfinished acquisitions separately through the provider's writer-only publication API, with live byte/file progress and honest unknown totals.
- Refresh the complete catalogue after a monitored publication commits or is aborted; keep readonly consultation and older-provider compatibility.
- Cover monitoring, permissions, stale/error responses, indeterminate progress and commit transitions in client/browser tests.

## 0.1.0 — 2026-10-21

- Add a standalone Signal K webapp to browse all catalogue datasets.
- Show summaries, detailed metadata, original files and verified inventories.
- Add search, format/inventory filters and responsive French interface.
- Reuse Signal K sessions and permissions for confirmed dataset deletion.
- Preserve provider busy conflicts and reject stale deletion confirmations.
