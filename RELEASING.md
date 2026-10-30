# npm publishing

The repository, package and trusted publisher already exist. Release **0.1.0**
is the first stable version and publishes to `latest`; `0.1.0-beta.1` remains
the previous beta. Earlier 0.1.0/0.1.1 entries describe local sandbox snapshots.
The provider's HTTP contract remains 0.1. See [the upgrade guide](docs/upgrading.md).

This follows the other `macjl` Signal K plugins: [the official reusable Signal K
CI](https://github.com/SignalK/signalk-server/blob/master/.github/workflows/plugin-ci.yml), followed by npm trusted publishing (OIDC/provenance) from `publish.yml`.
No `NPM_TOKEN` secret is used. A normal code push runs CI and does not publish.

## One-time repository and npm setup

The following steps are historical bootstrap instructions, only for a new empty
repository/package. Do not repeat them for this plugin. The public repository is
`macjl/signalk-forecast-dataset-browser`. For a new empty repository, for example:

```sh
gh repo create macjl/signalk-forecast-dataset-browser --public --source=. --remote=origin
git push -u origin HEAD:main
```

Check the SignalK Plugin CI result before creating a release. It runs the
standard Linux x64/ARM64/macOS/Windows matrix on Node 22 and 24, plugin load/
lifecycle checks, packaging checks and a real-server install. The server job
installs packages declared in `signalk.requires`; Forecast Dataset Provider must
be available from npm as a usable plugin for a meaningful complete-chain test.
The separate Chromium job tests the catalogue UI and acquisition monitoring
against local HTTP fixtures. No sandbox credentials are used by hosted CI.

Before the first beta, the public npm lookup returned E404. A package must exist
before its trusted publisher can be configured. For a new package, bootstrap an **empty** placeholder
outside this checkout, following the pattern used for the other new plugins.
These commands perform the initial public registry write:

```sh
npm login --registry=https://registry.npmjs.org
test "$(npm whoami --registry=https://registry.npmjs.org)" = macjl
browser_bootstrap_dir="$(mktemp -d)"
cd "$browser_bootstrap_dir"
npm init -y
npm pkg set name=signalk-forecast-dataset-browser version=0.0.0-bootstrap.1 \
  description="Empty bootstrap package for Signal K Forecast Dataset Browser" \
  license=Apache-2.0 \
  repository.type=git \
  repository.url=git+https://github.com/macjl/signalk-forecast-dataset-browser.git
npm pack --dry-run
npm publish --registry=https://registry.npmjs.org --access public --tag bootstrap
```

Do not use the real checkout for this placeholder or add Signal K discovery
keywords to it. It is not an installable browser. Skip this bootstrap if a package
owner has already completed it; verify with `npm view` first.

With npm CLI 11.15+ and account 2FA enabled, add the trusted publisher after the
workflow is present on GitHub:

```sh
npm trust github signalk-forecast-dataset-browser \
  --repo macjl/signalk-forecast-dataset-browser \
  --file publish.yml \
  --allow-publish \
  --registry=https://registry.npmjs.org
npm trust list signalk-forecast-dataset-browser --registry=https://registry.npmjs.org
```

The equivalent npm package Settings → Trusted publishing values are owner
`macjl`, repository `signalk-forecast-dataset-browser`, workflow filename
`publish.yml` (not the path), no environment, and permission for direct publishing.
A new trust configuration needs a first successful publish within two days;
configure it close to the planned release. The workflow uses Node 24 and a
GitHub-hosted runner with `id-token: write`.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[the npm trust command](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Verify the real package

From the browser checkout:

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:browser
npm pack --dry-run
npm publish --dry-run --tag beta
```

The last command checks the publish lifecycle without writing to npm. This static
webapp needs no build step or runtime npm dependencies. `prepublishOnly` checks
syntax and client tests. The release workflow also runs the Chromium suite.

Inspect the archive: `index.cjs`, `public/` assets including the icon, App Store
screenshots, license, README, changelog and this guide must be present. Source
tests, deployment helpers, reports, node_modules and credentials must be absent.
An install with `--ignore-scripts` must load the plugin and serve the existing
webapp files without compilation. The sandbox helpers are not npm installers.

## Release through GitHub

Keep package.json, package-lock.json and CHANGELOG.md aligned with the version.
The first stable tag is **v0.1.0**. Push that tag and publish a GitHub release
from it. Publishing the Release starts `.github/workflows/publish.yml`. A tag push
alone does not publish. Manual workflow dispatch also publishes the version of
the selected ref; it is not a dry run.

The workflow installs dependencies, runs client and Chromium tests, inspects the
archive and checks the release tag against package.json. It requires an existing
npm package and skips a version already published. It uses OIDC/provenance and
routes prerelease versions to `alpha`, `beta`, `rc` or `next`; stable versions go
to `latest`. A GitHub prerelease with a stable package version is rejected.
This stable release updates `latest`.

After the workflow succeeds, verify the version, `latest` tag, archive files and
provenance on npm. OIDC authentication and the hosted platform matrix can only
be confirmed by their actual GitHub runs; local dry runs do not establish them.
