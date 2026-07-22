# Upstream v0.5.40 baseline

This baseline records what the pinned upstream tree did before Proxy-Max changed
or adapted any of its behavior. It is evidence, not a claim that upstream was
green.

## Source identity

- Repository: `https://github.com/decolua/9router`
- Tag: `v0.5.40`
- Commit: `79918c7830695bbca4a45c9fea4a42c3e9fd73d1`
- Tree: `7aa8d7fb8a0233b4678255bc45128f159d74b381`
- Git-tracked files: 1,342
- Git-blob bytes: 9,968,328
- License: MIT

The exact tracked tree is materialized at `upstream/router-core/` and checked by
`npm run verify:upstream`. The generated Proxy-Max dependency lock is the only
source-level overlay the snapshot verifier permits.

## Build and production smoke

The generated lock resolved `next` 16.2.10 from upstream's `^16.1.6` range on
2026-07-21. Dependencies were installed with lifecycle scripts disabled, so
the optional `better-sqlite3` native addon was not compiled; Node 25.9.0 used
the upstream `node:sqlite` fallback.

`npm run build` completed and produced a standalone build. Upstream's declared
`npm start` command also served requests, but Next warned that `next start` is
not the supported launcher for `output: "standalone"`. Proxy-Max therefore
uses the standalone `server.js` through upstream's hardened `custom-server.js`
wrapper and copies the required static/public assets before launch.

Production smoke results:

| Request | Result |
| --- | --- |
| `/` | 307 to `/dashboard` |
| `/dashboard` | 307 to `/login` on a fresh data directory |
| `/api/health` | 200, `{ "ok": true }` |
| `/v1/models` | 200 |
| Standalone model count | 467 |

The reusable smoke is `npm run unified:smoke`; it uses a temporary private data
directory and an available loopback port.

## Test baseline

The complete tracked test inventory was run with Vitest 4.0.17, installed
without changing the generated lock. Result:

| Metric | Result |
| --- | ---: |
| Test files passed | 124 |
| Test files failed | 21 |
| Test files skipped | 11 |
| Tests passed | 1,419 |
| Tests failed | 69 |
| Tests skipped | 59 |
| Total test files | 156 |
| Total tests | 1,547 |

Prominent baseline failures included known translator expectations, incomplete
Cursor AgentService exports/frame builders, Cursor model null handling, lost
writes in database concurrency tests, request-normalization edge cases, an
Antigravity retry constant mismatch, an incomplete force-stream mock, image URL
hardening, Cursor auto-import path/error mismatches, an OpenAI-to-Claude tool
delta, and the request-details test's unavailable optional native SQLite
binding. Five snapshot assertions failed; test execution wrote a snapshot,
which was restored from the pinned checkout before snapshot verification.

These failures are tracked as upstream debt. Proxy-Max parity work must either
fix them, document a tested intentional difference, or identify a genuinely
external boundary; it must not relabel them as passing.

## Repository boundaries found during audit

- The cloud-sync backend is referenced but not present in the tracked tree.
- Cursor MITM functionality contains a deliberate `501` boundary.
- PWA support is partial rather than a complete install/offline contract.
- Upstream includes privileged host operations and deploy/tunnel relays that
  require stricter local authorization in Proxy-Max.
- Several upstream persistence and API surfaces expose or retain credentials
  more broadly than Proxy-Max's security policy permits.

The immutable path-and-blob inventory remains in `upstream-v0.5.40.json`. The
derived `upstream-v0.5.40.ledger.json` maps all 1,342 rows to their selected
vendored or overlaid implementation, records implementation and materializer
digests, and inventories Proxy-Max-only additions separately. `npm run
verify:parity` enforces zero unmapped and zero stale rows; behavioral parity is
established by the integrated protocol, provider, persistence, security, UI,
build, and smoke suites rather than inferred from hashes alone.
