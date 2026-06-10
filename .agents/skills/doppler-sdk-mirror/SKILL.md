---
name: doppler-sdk-mirror
description: Use when editing files under sdk/ in the Doppler repo, fixing SDK bugs, or adding SDK client features. Triggers on sdk/typescript, sdk/src Rust changes, or any PR that touches Doppler runtime SDK code.
---

# Doppler SDK Template Mirroring

## Overview

`sdk/` is the canonical runtime SDK. `generator/templates/` holds copies the generator emits into per-schema SDKs. If you change `sdk/` without mirroring templates, generated SDKs drift from the published Doppler SDK.

**Direction is always:** `sdk/` → `generator/templates/`. Never edit templates first and backport.

## When to Mirror

Mirror when you change logic in any **template-backed** file (see table below).

Do **not** mirror when you only change:

- Schema-specific generated files (`types.ts`, `constants.ts`, `serializers.ts` in core; `lib.rs`, `constants.rs` in Rust)
- Build/workspace config (`package.json`, `rolldown.config.ts`, `tsconfig.*`, `rolldown.shared.ts`) — those are rendered by `generator/src/sdk/`
- Tests, READMEs, or `playground/sdk/` (generated output for local dev)

## File Mapping

| Canonical source (`sdk/`) | Generator template (`generator/templates/`) |
|---------------------------|-----------------------------------------------|
| `typescript/core/src/oracle.ts` | `typescript/core/src/oracle.ts` |
| `typescript/core/src/codec-bridge.ts` | `typescript/core/src/codec-bridge.ts` |
| `typescript/kit/src/*.ts` (all 6 files) | `typescript/kit/src/*.ts` |
| `typescript/web3js/src/*.ts` (all 5 files) | `typescript/web3js/src/*.ts` |
| `src/accounts.rs` | `rust/src/accounts.rs` |
| `src/transaction.rs` | `rust/src/transaction.rs` |

Kit template files: `decode-base64.ts`, `doppler.ts`, `index.ts`, `instructions.ts`, `transaction-builder.ts`, `types.ts`.

Web3js template files: `compute-budget.ts`, `doppler.ts`, `index.ts`, `transaction-builder.ts`, `types.ts`.

## Template Rules

1. **Keep `@blueshift-gg/doppler-core` imports** in kit/web3js templates. The generator rewrites them to the generated core package name (`substituteCoreImport` in `generator/src/sdk/templates.ts`). Do not hardcode generated package names in templates.

2. **Omit schema-specific values** — no `PROGRAM_ID`, `ADMIN`, `PAYLOAD_SIZE`, or payload type names in templates. Those are emitted by `renderCoreSdk` / `renderRustSdk`.

3. **Strip Rust `#[cfg(test)]` modules** from `accounts.rs` and `transaction.rs` templates. The canonical `sdk/src/accounts.rs` may include tests; templates must not.

4. **Copy logic, not packaging** — templates are source files only. Do not copy `package.json`, `Cargo.toml`, or rolldown/tsconfig files into `generator/templates/`.

## Workflow

1. Make the change in `sdk/` (TypeScript or Rust).
2. Copy the same change into the matching `generator/templates/` path from the table.
3. Apply template rules above (imports, no tests, no schema constants).
4. Verify:

```sh
cd generator && bun test
```

5. If you changed TypeScript SDK packages, also run their workspace checks:

```sh
cd sdk/typescript && bun run typecheck
```

## Quick Diff Check

After mirroring, template-backed files should match their sdk counterparts (minus template rules):

```sh
diff sdk/typescript/core/src/oracle.ts generator/templates/typescript/core/src/oracle.ts
diff sdk/typescript/kit/src/doppler.ts generator/templates/typescript/kit/src/doppler.ts
diff sdk/src/transaction.rs generator/templates/rust/src/transaction.rs
```

For `accounts.rs`, expect the sdk copy to have extra `#[cfg(test)]` blocks that templates omit.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Updated `sdk/` only | Mirror to `generator/templates/` before finishing |
| Copied `constants.ts` or `serializers.ts` to templates | Those are generated per schema — change `generator/src/sdk/typescript/core.ts` instead |
| Replaced `@blueshift-gg/doppler-core` with a generated name in templates | Revert; generator substitutes at emit time |
| Copied Rust tests into templates | Remove `#[cfg(test)]` modules from template files |
| Edited `playground/sdk/` | Regenerate playground via the generator, or edit `sdk/` + templates |
| Edited templates without updating `sdk/` | Wrong direction — `sdk/` is canonical |

## Red Flags — STOP

- PR touches `sdk/` but not `generator/templates/` for a template-backed file
- "I'll sync templates in a follow-up"
- "playground/sdk already has the fix"
- "Only the published SDK matters, generated ones are secondary"

Generated SDKs are first-class outputs. Drift breaks users who run `doppler-generator generate`.
