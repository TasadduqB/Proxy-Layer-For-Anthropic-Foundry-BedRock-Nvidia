# Upstream parity inventory and implementation ledger

Proxy-Max keeps two related, deliberately separate records for the pinned
third-party source:

- `upstream-v0.5.40.json` is the immutable source inventory. It records the
  exact 1,342 Git blobs from the upstream tag, including each path, byte size,
  SHA-256, and structural category.
- `upstream-v0.5.40.ledger.json` is the generated implementation ledger. It
  maps every inventory row to the file that Proxy-Max materializes, records
  its digest and runtime destination, and separately inventories Proxy-Max-only
  overlay additions and generated/runtime artifacts.

The source identity is fixed at:

- Repository: `https://github.com/decolua/9router`
- Tag: `v0.5.40`
- Commit: `79918c7830695bbca4a45c9fea4a42c3e9fd73d1`
- Tree: `7aa8d7fb8a0233b4678255bc45128f159d74b381`
- Tracked files: 1,342
- Tracked bytes: 9,968,328

## Run the gate

Regenerate the implementation ledger after an intentional overlay or
materializer change:

```sh
npm run unified:parity:generate
```

Verify the checked-in ledger without network access or writes:

```sh
npm run verify:parity
```

Run the complete source-inventory, materializer-contract, mutation-test, and
ledger gate used for the final integration check:

```sh
npm run unified:parity:gate
```

Run the hermetic mutation tests for the generator and verifier:

```sh
npm run test:parity
```

`verify:parity` fails if any of the following is true:

- one of the 1,342 pinned paths is missing, duplicated, reordered, corrupted,
  or absent from the ledger;
- a ledger row has a stale category, disposition, target, digest, runtime
  destination, or evidence record;
- an overlay replacement or Proxy-Max-only overlay addition is unrecorded,
  missing, duplicated, or stale;
- an overlay collides with a pinned file/directory boundary or a generated
  runtime artifact;
- the dependency lock or runtime materializer changed without regenerating the
  ledger;
- the checked-in JSON is not byte-for-byte canonical output from the
  deterministic generator.

The gate reconstructs the expected ledger from the immutable source inventory,
the verified local snapshot, the complete overlay tree, and the runtime
materializer. It does not use timestamps, locale-sensitive sorting, Git
working-tree state, network access, or generated build output.

## Per-path contract

Every pinned source row has these required fields in the implementation
ledger:

- `path` and `category`: the exact upstream-relative path and deterministic
  structural classification;
- `disposition`: either `vendored-unchanged` or `overlaid`;
- `runtimeTreatment`: whether the row is application source, a test, an asset,
  documentation/localization, a skill, CLI source, or build/operations source;
- `source`: the pinned path, SHA-256, and byte size;
- `implementation`: the selected source path, SHA-256, byte size, and exact
  runtime destination;
- `evidence`: content-addressed pinned-source, implementation, and
  materialization references plus the enforcing gate.

The two source dispositions have narrow meanings:

- `vendored-unchanged` means the pinned blob itself is the implementation and
  is copied into the materialized runtime tree byte-for-byte.
- `overlaid` means the pinned blob remains present for provenance, while a
  content-addressed Proxy-Max overlay replaces that exact runtime path.

Overlay files with no upstream row are never folded into the 1,342-path count.
They appear in the ledger's separate `additions` section with disposition
`proxy-max-addition`, category, digest, runtime destination, and evidence. This
makes new functionality auditable without weakening exact upstream coverage.

The `generatedArtifacts` section documents the dependency lock,
materialization stamp, installed dependencies, Next build output, and
standalone launch manifest. Directory artifacts are recorded by deterministic
generation rule instead of unstable build-output hashes.

## Coverage versus behavioral verification

The ledger is a strict source/materialization coverage gate. It proves which
blob implements every pinned path and that no overlay bypasses the inventory.
It does not pretend that a file hash alone proves runtime behavior. Protocol,
provider, persistence, security, UI, build, and smoke tests remain the
behavioral evidence for the integrated application and must pass separately.

| Evidence surface | What it establishes | Gate |
| --- | --- | --- |
| Pinned inventory + implementation ledger | Exact source, overlay selection, and runtime-file coverage | `npm run unified:parity:gate` |
| Proxy-Max regression suites | Legacy compatibility, migration, routing, and security behavior | `npm test` |
| Materialized upstream Vitest suites | Protocol, provider, translator, modality, persistence, and privileged-operation behavior | Full hermetic Vitest run in the materialized runtime |
| Standalone production build and smoke | Bundling, route generation, startup, health, and model discovery | `npm run unified:build` and `npm run unified:smoke` |
| Browser/accessibility checks | Rendered dashboard flows, responsive navigation, and user-visible states | Browser smoke against the production build |

Each row answers a different question. Passing the ledger gate cannot replace
the behavioral rows, and a passing behavioral test cannot excuse an unmapped
or stale source row.

The source inventory retains its original workflow `status`, `target`, and
`notes` fields for reproducibility with the upstream-inventory generator. Those
legacy queue fields are not the implementation gate. Authoritative coverage is
`coverage.unmappedUpstreamPaths === 0` and `coverage.staleEntries === 0` in the
generated implementation ledger, enforced by `npm run verify:parity`.

## Source inventory maintenance

Creating a source inventory for a new upstream pin requires a clean Git
checkout at the exact expected tag and commit:

```sh
node scripts/generate-unified-parity.js \
  --upstream /path/to/clean/upstream-checkout \
  --output docs/parity/upstream-v0.5.40.json
```

Its standalone reproducibility test is:

```sh
node scripts/test-generate-unified-parity.js \
  --upstream /path/to/clean/upstream-checkout \
  --manifest docs/parity/upstream-v0.5.40.json
```

The baseline build and upstream test record is in
[`upstream-baseline-v0.5.40.md`](upstream-baseline-v0.5.40.md). The runtime,
migration, and cutover design is in
[`../architecture/unified-integration.md`](../architecture/unified-integration.md).
