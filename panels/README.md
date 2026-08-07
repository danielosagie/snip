# Snip NLE panels

This workspace contains vendor-specific adapters for timeline presence and sequence exchange.

- `resolve/` is the Wave 2 Resolve Workflow Integration panel.
- `premiere/` is a manifest-only UXP and CEP scaffold for the next wave.

Run all current panel checks from this directory:

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

The panel workspace does not import application runtime code and does not change the root web build.
