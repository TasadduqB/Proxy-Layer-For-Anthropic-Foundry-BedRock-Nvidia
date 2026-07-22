# Pinned upstream components

`router-core/` is the complete tracked tree of
[`decolua/9router`](https://github.com/decolua/9router) at tag `v0.5.40`,
commit `79918c7830695bbca4a45c9fea4a42c3e9fd73d1`, materialized with
`git archive`. Its original MIT license is preserved at
`router-core/LICENSE`.

Proxy-Max may add a generated `router-core/package-lock.json` beside that tree to
make dependency installation reproducible. The verifier intentionally ignores
that lock and generated `.next`, `coverage`, and `node_modules` directories,
while rejecting any other extra path.

The source-of-truth inventory, Git-blob hashes, classifications, and manual
implementation status live in `docs/parity/upstream-v0.5.40.json`. Do not update
this snapshot in place without also pinning a new commit and regenerating that
ledger. Proxy-Max-specific adapters live in `overlays/unified/` and are
composed into the ignored runtime tree by `src/runtime/unified-source.js`.
Keeping the pin immutable makes the completed integration auditable: every
upstream blob is verified independently, while every replacement and
Proxy-Max-only addition has separate provenance in
`docs/parity/upstream-v0.5.40.ledger.json`.
