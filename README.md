# pm-case

Constrained combinatorial test design as durable agent context. An agent can resume the same finite model, avoid equivalent examples, retain invalid combinations, and explain exactly which interactions were planned and which have reported execution evidence.

`pm-case` proposes and tracks cases. The agent or its existing test harness executes them. Pair coverage is a statement about the declared input population; it is not code coverage, correctness, higher-order coverage or release approval.

## Install

This candidate is local and unpublished. To create a fresh local review archive from a clean source checkout, run these prerequisites in the package directory:

```sh
npm ci
npm pack
```

This creates `pm-case-2026.11.6.tgz` in that directory. It is a newly built review archive, with no claim that its bytes match the captured, validated artifact from a previous run. The captured artifact is untracked; use a maintainer-supplied copy and its matching SHA-256 receipt when verifying that earlier run.

Install the archive in a fresh consumer directory, never inside this source checkout, so `pm init` provisions a new tracker instead of the checkout's own:

```sh
mkdir ../pm-case-demo && cd ../pm-case-demo
npm install ../pm-case-2026.11.6.tgz @unbrained/pm-cli@2026.11.5
npx --no-install pm init demo --defaults --agent-guidance skip --no-merge-fence
npx --no-install pm package install ./node_modules/pm-case
npx --no-install pm case --help
```

After maintainer publication, the registry paths are:

```sh
# Fresh npm project outside this checkout
npm install pm-case @unbrained/pm-cli
npx --no-install pm init demo --defaults --agent-guidance skip --no-merge-fence
npx --no-install pm package install ./node_modules/pm-case
npx --no-install pm case --help

# Separate fresh Bun project
bun add pm-case @unbrained/pm-cli
bunx --bun --no-install pm init demo --defaults --agent-guidance skip --no-merge-fence
bunx --bun --no-install pm package install ./node_modules/pm-case
bunx --bun --no-install pm case --help
```

Node 22.19 or newer is required. Packed acceptance exercises npm, Bun, npx and native bunx in fresh projects, including SDK creation and writes, with Git absent from `PATH`.

## Commands

Every command defaults to TOON and accepts `--json`. Inputs are inline JSON or `--input -`; they are never executable expressions. Package `--budget` controls the entire response, defaulting to 1600 estimated tokens (`ceil(final UTF-8 bytes / 4)`), with a 32 KiB ceiling. This is a byte estimate, not provider token accounting.

| Command | Example | Result |
| --- | --- | --- |
| create | `pm case create --id suite --input - --op birth` | Immutable model and original operation receipt |
| propose | `pm case propose suite --max-cases 32` | Deterministic cover, exact denominator and revision-bound proposal digest |
| select | `pm case select suite --proposal DIGEST --max-cases 32 --revision HASH --op plan` | Persist the exact recomputed proposal |
| record | `pm case record suite --input - --revision HASH --op run-1` | Append one reported pass, fail or unresolved observation |
| coverage | `pm case coverage suite --budget 8192 --json` | Planned and observed coverage, uncovered and excluded tuples |
| explain | `pm case explain suite --tuple TUPLE_DIGEST` | Feasibility, full assignment witness and selected case identities |
| packet | `pm case packet suite --limit 5 --budget 1600` | Resume page with all denominators, conflicts and unknown-state counts |

Use `packet --cursor CURSOR --limit 5` for subsequent pages. Cursors bind the owner revision, ordering and page size. A changed revision or query refuses with `stale_cursor`. Each page reports total, returned, omitted, previously returned and remaining rows. `output_complete` means the current envelope contains the entire scope; the last page can still omit earlier rows. `next_cursor: null` means there are no later rows.

`--budget` and `--cursor` are package compatibility flags. The pinned host validates native `--output-cursor` before producer dispatch and cannot accept this package's cursor. Supported native read budget/limit controls are consumed without shadowing them; conflicting package/native flags and generic projections refuse. Prefer package flags for complete envelope receipts. A small budget returns a measured `minimum_usable_budget`; a null minimum requires a narrower query. Mutation result budgets are checked before any write. Large coverage/proposal results can require a larger budget, fewer proposed cases, or the paginated packet.

Create input example (the references below are synthetic; replace them with reviewed public source snapshots):

```json
{
  "title": "Output compatibility",
  "model": {
    "model_key": "output-compatibility",
    "subject_digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "strength": 2,
    "factors": [
      {"factor_id":"runtime","values":["node","bun"],"label":"Runtime","source_refs":[{"item_id":"public-contract","item_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","field_pointer":"/description","content_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]},
      {"factor_id":"format","values":["json","toon"],"label":"Output format","source_refs":[{"item_id":"public-contract","item_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","field_pointer":"/description","content_digest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]}
    ],
    "forbidden_tuples": [],
    "mandatory_cases": []
  },
  "related": []
}
```

A constraint is `{assignment: {factor_id: value_id}, rationale, source_refs}`. It forbids every full assignment containing that partial assignment. Mandatory cases must assign every factor and satisfy all constraints. A tuple is feasible only if some valid full assignment contains it. Model edits create a new owner with an optional exact `predecessor` source reference; observations never transfer implicitly.

Record input is `{outcome: {...}}`. Required outcome fields are `execution_id`, `case_id`, `subject_digest`, `oracle_digest`, `result` (`pass`, `fail`, `unresolved`), `reason`, nonempty `source_refs`, ISO `observed_at`, and `recorder`; `evidence_grade` is always `reported`. Copy the selected case ID and exact model subject. Distinct executions retain distinct IDs. The first recorded oracle establishes the coverage comparison scope; different oracle digests remain visible as incomparable executions. An unresolved observation does not contribute execution coverage. Passing and failing observations both witness execution; a case can appear in both counts, and its conflict remains explicit.

## SDK

All operations accept an authorized injected `Host`; none launches a CLI or executes test code.

```ts
import {
  createDirectoryHost, createCaseModel, proposeCases, selectCases,
  readCaseModel, recordCaseOutcome, caseCoverage, explainCaseTuple,
  casePacket, recoverCaseOperation, envelope, fitEnvelope,
  normalizeModel, enumerateFeasibleTuples, generateCover, evaluateCaseCoverage,
  CaseRefusal,
} from 'pm-case';

import { PmClient } from '@unbrained/pm-cli/sdk/core';

// Initialize once in a fresh directory before creating a package host.
const native = new PmClient({ cwd: process.cwd(), pmRoot: '.agents/pm', author: 'agent', noExtensions: true });
await native.init('demo', { defaults: true, agentGuidance: 'skip', mergeFence: false });
const host = createDirectoryHost('.agents/pm', 'agent');
// reviewedModel has the strict CaseModel shape shown above.
const birth = await createCaseModel(host, {
  id: 'suite', op: 'birth', title: 'Reviewed configuration space', model: reviewedModel,
});
const proposal = await proposeCases(host, { id: birth.owner_id, max_cases: 32 });
await selectCases(host, {
  id: birth.owner_id, op: 'plan', revision: proposal.revision,
  proposal: proposal.proposal, max_cases: 32,
});
const snapshot = await readCaseModel(host, birth.owner_id);
// The agent runs its existing harness and supplies observedOutcome.
await recordCaseOutcome(host, {
  id: snapshot.id, op: 'run-1', revision: snapshot.revision, outcome: observedOutcome,
});
const coverage = await caseCoverage(host, { id: snapshot.id });
const page = await casePacket(host, { id: snapshot.id, limit: 5 });
const transport = fitEnvelope(host, envelope(page), 1600);
const recovery = await recoverCaseOperation(host, { id: snapshot.id, op: 'run-1' });
```

`createCaseModel`, `selectCases` and `recordCaseOutcome` accept an optional result `budget`. Read operations return complete typed objects; use `envelope` and `fitEnvelope` for bounded transport. `explainCaseTuple(host, {id, tuple})` returns a feasible witness or the constraints explaining no valid completion. `enumerateFeasibleTuples(model)`, `generateCover(model, {max_cases})` and `evaluateCaseCoverage(state)` are pure. `normalizeModel`, `canonical`, `digest` and `readState` support strict normalization and integrity checks. The optional `stored` flag on `normalizeModel`, `enumerateFeasibleTuples` and `generateCover` is for trusted persisted state: it preserves historical inert text while retaining schema and domain validation. New submissions use the default `false`, including before cache lookups. Exported request, state, result and nested Zod schemas reject unknown fields. `CaseRefusal` carries `code`, safe `message`, `remedy`, `retryable` and bounded `details`.

The injected host supplies native `get`, `create`, `update`, `readItemRevision`, `withExpectedItemRevisions` and `listAllComplete`, plus explicit native CAS and create-if-absent capability assertions. Optional host output fitting, settings, identity normalization and creation schema provisioning stay host-owned. Directory and injected native-client contracts are tested; arbitrary database/MCP providers are not certified. Authorization must happen before invoking the package.

Operation keys are durable. Same key and canonical request replay the original committed result without another audit event, even after later operations. Changed payloads refuse. Replayed receipts distinguish the original result digest from the currently observed revision. Stale writes refuse without silent rebasing. After interruption, `recoverCaseOperation` reports `committed`, `not_committed` or `outcome_unknown`; reconcile unknown outcomes before deciding how to retry, and retain the original key.

## AGENTS.md snippet

```md
Before testing a configuration interaction, create or resume a pm case model.
Review factor definitions, omitted dimensions and forbidden tuples explicitly.
Propose a bounded suite, retain its digest and revision, then select it.
Run cases using the existing test harness; pm-case never runs them.
Record each execution with a stable operation key and immutable subject/oracle identities.
Resume with pm case packet --limit 5; preserve gaps, exclusions and conflicts.
Never report planned tuple coverage as execution, correctness or code coverage.
After a stale write, reread and consciously retry. After a lost receipt, reconcile its original key.
```

## Public proof

Twenty-four source passages from frozen public pm-csv, pm-beads and pm-ops tracker snapshots define three reviewed matrices. The independent oracle, exact source revisions, constraints, every uncovered tuple, native owner revisions and harness receipts are in [the proof](docs/real-data.md) and [machine-readable receipt](docs/real-data-receipt.json).

| Matrix | Cartesian | Feasible | Pairwise cases | Planned pairs | Recorded pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| CSV close compensation | 16 | 12 | 6 | 23/23 | 6/23 |
| Beads repair preview | 32 | 24 | 6 | 39/39 | 10/39 |
| Ops snapshot inspection | 16 | 16 | 6 | 24/24 | 6/24 |

Each primary suite retains one reported passing observation and one unavailable observation. A reproduced historical CSV failure is recorded against a separate subject, preserving its failing outcome without contaminating current-source evidence. Three scoped public harnesses pass; restoring the historical close shortcut fails its regression and restoring the fix passes.

V1 deliberately supports strengths 1 and 2. Three-way exhaustive reference suites have 12, 24 and 16 feasible cases and cover 28, 74 and 32 triple obligations respectively. Those research references do not add three-way support to the package. Higher strengths and alternative generators remain tracked follow-ups.


| Matrix | One-row packet bytes | Estimated tokens | Naive listing bytes | Estimated tokens |
| --- | ---: | ---: | ---: | ---: |
| pm-csv | 2661 | 666 | 11444 | 2861 |
| pm-beads | 2684 | 671 | 9158 | 2290 |
| pm-ops | 2655 | 664 | 8229 | 2058 |

The ten questions use 14 calls, 42044 delivered bytes versus 97937 baseline bytes: 57.07% fewer. The largest serialized page is 3836 bytes. Every page is below 1600 estimated tokens.

## Without git

All seven domain commands, the SDK and native history work in a plain tracker with Git absent. Git is needed only for development provenance, source acquisition and future repository release workflows. No hosted service, subprocess, network, model call or side database is used by the domain implementation.

## Limits, privacy and exits

V1 admits 2–12 factors, 2–8 values each, Cartesian size at most 4096, strength 1 or 2, 64 forbidden tuples, 32 mandatory cases, 256 selected cases, 256 observations, 512 retained operation keys, and 256 KiB canonical `case_state`. The first reached limit refuses before mutation; partition or create an explicitly linked successor. No receipt eviction, model editing or implicit migration occurs.

Text is inert data. The SDK secret scanner and bounded validation reject credential-shaped content, absolute home paths, unsafe controls/bidi, malformed Unicode and prototype/accessor/cyclic objects. Secret scanning is heuristic. Author/recorder strings are attribution, not authentication. Source references are independently captured snapshots; freshness remains unknown. Native history can retain old text: correction is not deletion, and retention/redaction uses host policy. Never submit unreviewed sensitive data.

| Exit | Meaning |
| --- | --- |
| 0 | Completed domain result; incomplete/unknown states remain explicit |
| 2 | Invalid input/outcome/record, finite limit, capacity or output budget |
| 3 | Authorized owner absent |
| 4 | Revision, operation or cursor conflict |
| 5 | Unsupported backend, permission, incomplete read, I/O or unknown outcome |

Development: `npm run release:check` and `bun run release:check`. Coverage policy is exactly 100% statements, branches, functions and lines across every shipped runtime module, with no ignores. Tests use real temporary SDK trackers, an independent exhaustive oracle, 500 seeded operation sequences, 24 proposal/apply sequences, competing writes at every boundary, two OS writers and hard crash recovery. Five behavioral reverts run only in disposable copies. Release publishing stays approval-gated and consumes the validated archived tarball; this task does not publish.
