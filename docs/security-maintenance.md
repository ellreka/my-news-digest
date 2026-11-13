# Security maintenance — 2026-11-13

## Dependencies and audit scope

Registry `latest` releases selected for this maintenance:

| Package | Previous locked version | Updated version |
| --- | --- | --- |
| `astro` | 7.1.6 | 7.4.11 |
| `@astrojs/starlight` | 0.41.7 | 0.42.11 |
| `sharp` | 0.35.3 | 0.35.5 |
| `wrangler` | 4.119.0 | 4.161.0 |

The package manager remains on pnpm 10, updated from 10.34.4 to 10.34.9.
The lockfile was refreshed with `pnpm update @astrojs/starlight@^0.42.11 astro@^7.4.11 sharp@^0.35.5 wrangler@^4.161.0 --lockfile-only --ignore-scripts`.
No overrides, audit exclusions, or severity filters were added.

| Audit | Info | Low | Moderate | High | Critical |
| --- | --- | --- | --- | --- | --- |
| Previous full lockfile | 0 | 6 | 25 | 21 | 1 |
| Updated full lockfile | 0 | 0 | 0 | 0 | 0 |
| Updated `--prod` lockfile | 0 | 0 | 0 | 0 | 0 |

These are the severity totals returned by `pnpm audit --json` and
`pnpm audit --prod --json` on this date, not a guarantee of absence of
vulnerabilities. The full audit includes build/deployment tooling; the production
filter still includes Astro/Starlight build dependencies and does not describe
which code is actually served by the static site. No before/after production
comparison was measured.

In particular, [GHSA-26w7-cxv4-gfx2](https://github.com/advisories/GHSA-26w7-cxv4-gfx2)
concerns malicious AVIF processing through libheif; updated Astro and Sharp exceed
the patched versions (7.2.8 and 0.35.4 respectively). This is not evidence of
remote exploitability of this site's static serving configuration.

## Validation and CI

- Before and after dependency updates, `pnpm test` passed all 10 Node regression
  tests. Test discovery is unchanged: the two `.test.ts` files export browser/dev
  server checks, not runnable Node test cases. They were not claimed as passing.
- No local dependency install, Astro build, or Wrangler deployment was performed.
  Frozen installation and the production build must pass in GitHub Actions.
- PR validation uses `pull_request`, a read-only token, and no deployment secrets.
  Both workflows install with `--frozen-lockfile`, run regression tests and a full
  `pnpm audit` (all severities), then build. Only the main-branch deployment
  workflow invokes Wrangler, with its token scoped to that step.
- CI uses Node 24, satisfying Astro's `>=22.23.4`, Wrangler's `>=22.12.0`, and
  Sharp's `>=20.9.0` engine requirements. Latest Starlight's Astro peer range is
  `^7.2.10`; the updated Astro satisfies it.
- Both jobs have a 20-minute timeout and disable checkout credential persistence.
  The existing deployment concurrency group and `cancel-in-progress: false`
  remain unchanged. Manual deployment is restricted to `main`.

Action release tags were resolved using the official upstream GitHub API
(`releases/latest`, `git/ref/tags/<tag>`, dereferencing annotated tags when
necessary), then each commit was fetched to verify its identity. Both workflows
use these immutable commits:

| Official upstream | Release tag | Commit |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | v6.1.1 | `73e46992e05b19abd31f2f3c20e0e7370d762115` |

Their pinned action manifests use the Node 24 runtime. GitHub-hosted
`ubuntu-latest` runners are used, not older self-hosted runners.

## Unresolved access-control exposure

The separate deployment review on 2026-11-13 found that unauthenticated requests
without cookies and without following redirects returned HTTP 200 HTML for both
`https://my-news-digest.ellreka.workers.dev/` and
`https://my-news-digest.ellreka.workers.dev/digests/2026/11/13/`, rather than an
Access authentication redirect. The site must not currently be described as
private or fully Access-protected. `noindex` is not an authentication control.

`workers_dev: true` is deliberately preserved: workers.dev is the actual public
endpoint, while the custom-domain route is only a placeholder. Turning it off
here would take the site offline. `preview_urls: false` is also preserved. The
misleading Wrangler comment claiming workers.dev was disabled has been corrected.
Resolving access policy/domain configuration requires separately approved
Cloudflare work and follow-up unauthenticated checks of every enabled hostname
and content path. Zero dependency advisories does not resolve this exposure.
