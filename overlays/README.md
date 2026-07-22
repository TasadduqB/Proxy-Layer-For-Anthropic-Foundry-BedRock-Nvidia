# Proxy-Max unified overlays

Files under `unified/` replace or add paths in the generated unified runtime
worktree. The pinned upstream tree under `upstream/router-core/` remains immutable
and hash-verifiable; `npm run unified:materialize` composes that source with
these reviewed overlays under the gitignored `.proxy-max/runtime/unified/`.

Every overlay must have a parity-ledger target and tests before its source row
can be marked implemented or adapted. Never put credentials, generated builds,
`node_modules`, or user data here.
