# Scoped npm validation

Tracking: [pm-case-scoped-npm-name](https://github.com/unbraind/pm-case/blob/main/.agents/pm/chores/pm-case-scoped-npm-name.toon).

npm rejected the first unscoped publish with E403 because `pm-case` is too similar to `no-case`. The owner selected `@unbrained/pm-case`, following [pm-lint PR 29](https://github.com/unbraind/pm-lint/pull/29). Only the npm identity changes: manifest name, catalog display name and `pm case` commands remain unchanged. The homepage and public publish access are retained.

## Packed consumers

Run with `export NODE_OPTIONS=--network-family-autoselection-attempt-timeout=5000` before network commands. `npm run test:install` builds, packs and installs the same npm artifact in two fresh consumer prefixes outside Git. Its launcher deliberately excludes Git from `PATH`. Using scratch variables for the artifact and consumer directories, the exercised setup is:

```sh
npm pack --ignore-scripts --json --pack-destination "$PROOF"
bun pm pack --ignore-scripts --destination "$BUN_PACK" --quiet
npm install --ignore-scripts --no-audit --no-fund "$TARBALL" @unbrained/pm-cli@2026.11.5
# In a separate fresh consumer directory:
bun add --ignore-scripts "$TARBALL" @unbrained/pm-cli@2026.11.5
```

Both pack managers produce `unbrained-pm-case-2026.11.6.tgz` with npm identity `@unbrained/pm-case`. The installed package lives at `node_modules/@unbrained/pm-case`. Each consumer initializes a new tracker and follows the README's activation path:

```sh
npx --no-install pm init packed --defaults --agent-guidance skip --no-merge-fence
npx --no-install pm package install ./node_modules/@unbrained/pm-case
npx --no-install pm case --help
```

The Bun journey repeats those commands through `bunx --bun --no-install pm`. The activated manifest is still `pm-case`. Both journeys execute actual create, propose, select, record, coverage, explain and packet commands, plus scoped SDK imports. For the public synthetic three-factor fixture, `pm case coverage packed-suite --json --budget 8192` reports 12 planned covered tuples and 3 covered by the recorded execution. They also test stale revisions, replay, privacy refusals, cursor contracts, legacy state and SDK writes. Exact Node 22.19.0 and 26.13.0 CLI/SDK checks run in both consumers.

The package has no standalone executable; npx/bunx invoke the pm host. The README's registry command is `pm install npm:@unbrained/pm-case`. Registry publication is outside this validation, so registry installation itself is not claimed.

## Release and local gates

The caller pins pm-ops v2026.11.18 at `c46a2419c63af3b348e6b559b0733ab0d9942cc7`. Inspection of that exact reusable workflow confirms there is no package-name input: packing, OIDC, registry metadata checks and Bun verification derive `package.json.name` or the release intent containing it. Defaults enable npm publication and Bun verification. The caller contract checks the package root and preserves those defaults, approval gate and runtime preparation.

Commands: `npm run typecheck`, `npm run lint`, `npm run pack:dry-run`, `npm run verify:release-publish-attestation`, `npm run identity:check`, `npm run changelog:full`, and `npm run changelog:check`. Targeted tests:

```sh
node --test --test-concurrency=2 test/package-metadata.test.ts test/release-workflow.test.ts test/workflow.test.ts test/review-classes.test.ts test/pack-gate.test.ts test/contracts.test.ts
```

The direct suite passes 28/28. The linked package/caller/review/pack/extension suite passes 25/25 through `pm test pm-case-scoped-npm-name --run --progress`; the unchanged workflow suite also passes 3/3 directly. Its health fixture fails only under the linked-test sandbox and is tracked separately as `pm-case-linked-health-sandbox`. No full coverage run is needed because coverage source files are unchanged.

CI v2 PR 13 remains independent. The required scoped-name changes overlap its packed acceptance file and generated changelog; its CI, deep CI and CodeQL workflows are untouched. No npm publish, merge or review-thread action was performed.
