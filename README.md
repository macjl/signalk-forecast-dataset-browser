# Forecast Dataset Browser

A small Signal K webapp for browsing **all published forecast datasets**, reading
available metadata and deleting a dataset. It uses Forecast Dataset Provider's
experimental **HTTP contract 0.1**, on the same Signal K server.

Open **Webapps → Forecast Dataset Browser**, or
`/signalk-forecast-dataset-browser/`. The interface is in French, works on desktop
and mobile, and requires no internet connection or external frontend assets.

## Features

- Complete paginated discovery of all formats and dataset kinds, with search by
  name, model, UUID or producer, plus format and inventory-state filters.
- Dataset count, published byte total and verified-inventory count. These totals
  describe the latest published version of each dataset, as exposed by contract
  0.1; they are not a disk-usage quota or historical-version size total.
- A detail pane with model cycle/publication times, type, producer, advertised
  coverage and fields when present, declared metadata, requested parameters,
  provenance, grid information, identity, content version and metadata revision.
- Original asset identifiers, sizes, SHA-256 hashes and authenticated download
  links. Verified inventories/indexes load only on explicit request, since they
  can be large. Complete dataset JSON exposes other available metadata too.
- Explicit deletion confirmation naming the dataset and its UUID. Deletion
  removes **the dataset and every committed version**, as defined by the provider.
  Busy-dataset conflicts are reported; no force option is used.

Missing metadata remains unknown. Requested bounds/duration/fields are shown as
acquisition claims, separately from verified inventory. Catalogue 0.1 does not
expose a historical-version listing, so the browser shows each dataset's current
published version and does not pretend to enumerate older versions.

## Authentication and deletion

The webapp uses your **existing Signal K browser session**, including HttpOnly
session cookies. There is no stored application token, login form or backend
proxy. Sign in through Signal K's administration interface when needed.

Readonly accounts can list, inspect and download. Readwrite and admin accounts
can delete. The server enforces permissions on every request; disabled controls
are just a usability aid. Unknown session permissions default to read-only.
Signal K installations with authentication disabled follow their existing policy.

Before deletion, the browser rereads the current resource and rejects a changed
content version or metadata revision. The provider does not offer conditional
DELETE, so this check cannot close a simultaneous publication race; the displayed
confirmation clearly covers **all versions** of the dataset. A dataset already
deleted elsewhere is removed from the list without another destructive action.

Deleting from this browser does not edit the downloader's settings or local
files. A producer may publish a missing acquisition again on its next trigger;
stop or reconfigure that producer if you intend to stop future publication.
Consumers update when they next refresh their catalogues.

## Installation

Requires Signal K 2.34+ within 2.x and enabled
`signalk-forecast-dataset-provider` 0.1.x. Node 20.19+ is sufficient for this
webapp. No runtime npm dependencies or build step are required.

```sh
npm pack
# Install the archive in your Signal K configuration directory and restart.
npm install /path/to/signalk-forecast-dataset-browser-0.1.0.tgz
```

The plugin registers its static `public/` directory as a Signal K webapp and has
no configuration settings. It only makes same-origin requests to the existing
catalogue and login-status APIs. Reverse-proxy path prefixes are preserved.

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The browser suite uses a local static server and intercepted catalogue fixtures.
It exercises the detail pane, filters, mobile layout, metadata escaping,
confirmation/cancellation, readonly permissions, expired permissions, busy
conflicts, changed content and temporary catalogue failure. Unit tests cover
pagination, identity checks and the exact deletion contract.

For an already installed browser, set `FORECAST_BROWSER_EXECUTABLE` to its path.
`tools/install-sandbox.cjs` and `tools/verify-sandbox.cjs` target only the selected
`signalk-sandbox`; see [sandbox verification](docs/sandbox-verification.md).

Apache-2.0.
