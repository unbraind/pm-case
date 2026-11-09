# Public finite-model proof

The corpus consists of 24 reviewed passages from certified complete SDK reads of disposable copies of these public, published commits. Acquisition reads Git objects only from the fixed allowlist; it never reads the working trackers or any private repository. Native selected item hashes, field pointers, exact UTF-8 content digests and public URLs are frozen in `test/fixtures/public-passages.json`.

| Package | Published commit | Selected items | Passages |
| --- | --- | --- | ---: |
| pm-csv | `d48dd3e07cf3b2d7153b2b687fa581735cffad0a` | `pm-csv-row-lineage`, `pm-csv-zv31` | 10 |
| pm-beads | `85b6392112929e967dfb5e174c773a0590124c35` | `pm-beads-y6cp` | 7 |
| pm-ops | `274c15895a88a12bec3d154a7a0ebf61e014b799` | `ops-sdk-adoption-1025` | 7 |

Source repositories and these commits were checked through public GitHub metadata. The guard test checks the explicit repository/commit allowlist, static acquisition capabilities, disposable SDK roots, complete-list certification, exact text digests and private-repository canaries. CI uses frozen fixtures; it does not discover external trackers or run their code.

## Reviewed populations and exclusions

These are intentionally bounded scenario models, not complete product test inventories. Definitions and exclusions are manual review decisions; omitted factors limit every coverage claim.

| Model | Parameters and values | Exclusions and scope |
| --- | --- | --- |
| CSV close compensation | runtime: node/bun; close_receipt: ok/conflict; persisted_status: closed/open; cleanup: ok/fail | A successful native close receipt with an open post-close state is excluded from this single-attempt scenario. An unrelated external reopen is outside this model. Nonzero receipts can coexist with either persisted state; cleanup failure remains a valid test case. |
| Beads repair preview | runtime: node/bun; line_ending: lf/crlf; source: stable/changed; topology: cycle/acyclic; action: explain/preview | Acyclic plus preview is excluded because this scoped workflow has no cycle-removal candidate to preview. Changed source plus preview is a valid negative case whose expected behavior is a source-change refusal. |
| Ops snapshot inspection | runtime: node/bun; permissions: readonly/writable; format: current/future; history: healthy/corrupt | No exclusions. Unsupported format and corrupt history are valid negative test cases. “Current” means a supported native fixture format. |

All three include one mandatory public harness scenario. These are ordinary explicit model inputs, not selection heuristics added after seeing coverage. `test/matrices.ts` records the exact factors, values, constraints and mandatory assignments with source references.

## Independent algorithm and execution evidence

A separate mixed-radix enumerator and recursive factor-combination oracle freezes the feasible tuple set before invoking production generation. Generation must cover every feasible pair and emit no forbidden assignment. Full Cartesian, feasible full assignments, exclusions and coverage denominators remain separate:

| Model | Cartesian | Feasible full cases | Pairwise suite | Reduction against feasible | Feasible pairs | Excluded pairs | Recorded pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CSV | 16 | 12 | 6 | 50% | 23/23 planned | 1 | 6/23 |
| Beads | 32 | 24 | 6 | 75% | 39/39 planned | 1 | 10/39 |
| Ops | 16 | 16 | 6 | 62.5% | 24/24 planned | 0 | 6/24 |

The independently enumerated full feasible populations also form exhaustive three-way reference suites: 12 cases cover 28 feasible triples, 24 cover 74, and 16 cover 32. These are research reference suites, not a compact three-way generator or a product strength-3 command. V1 refuses strength 3 as specified; higher strengths remain in `pm-case-later`.

Each primary suite records one reported passing observation from an existing package test harness and one explicit unavailable observation for a different selected case. The unavailable case is not counted as executed. Unobserved pair counts are 17, 29 and 18; every exact assignment and gap reason is retained in [the receipt](real-data-receipt.json). Source truth/freshness remains unknown, and the evidence grade remains reported.

The public harness proof uses isolated copies of the frozen public source and installs each copy's pinned dependencies without lifecycle scripts. The selected tests are:

- CSV: `a nonzero close receipt cleans markers only after a status recheck proves closure` in `test/atomic.test.ts`.
- Beads: `proposals bind exact source revisions, revalidate current text and reject forged or sparse edits` in `test/repair.test.ts`.
- Ops: `read-only source directories are unchanged and disposable copies are cleaned` in `test/backend-capabilities.test.ts`.

All three pass. The actual missing-combination regression comes from `pm-csv-zv31`: a nonzero close receipt after the close already persisted. Changing only the disposable copy's post-close recheck to the historical unverified shortcut makes the test fail because transaction markers remain. Restoring the function passes. The failing variant has its own source digest, model and recorded fail observation; it is never aggregated into current-source passing evidence. Exact test/oracle digests, commands and output hashes are in [the harness receipt](public-harness-receipt.json).

`pm-case` itself does not execute these tests; the acceptance harness is development-only agent work.

## Resume fidelity and delivered size

Ten questions compare independent answers from the same source passages, feasible population and submitted outcome receipts against package packets. For every model, the questions ask how many feasible pairs lack comparable execution, how many selected cases have unavailable outcomes, and which cases have contradictory comparable outcomes. The tenth asks for the exact unobserved CSV pair assignments across all resume pages. Answers agree, including empty conflicts and explicit unavailable evidence.

The receipt records actual calls, measured query latency, final UTF-8 bytes and maximum page bytes. Package framing, warnings, denominators and native fitter metadata are included. The baseline delivers the selected public passages, full feasible assignment listing and identical outcomes, without repeated padding. Budget checks use both TOON and JSON; the comparison uses JSON bytes. Estimates are `ceil(bytes/4)`, not provider tokens.

Counts and sizes are generated by `test/real-data.acceptance.ts`; consult `real-data-receipt.json` for the current exact values. The acceptance gate retains the explicit contract of at least 50% fewer delivered bytes overall (not a corpus-derived heuristic), each page at most 6400 UTF-8 bytes (1600 estimated tokens using `ceil(bytes/4)`), and all ten independent answers equal. Packet-framing changes may require regenerating the receipt; the release threshold remains unchanged. Question and harness counts are derived from the frozen corpus. It does not claim a general benchmark over arbitrary models or agents.


| Matrix | One-row packet bytes | Estimated tokens | Naive listing bytes | Estimated tokens |
| --- | ---: | ---: | ---: | ---: |
| pm-csv | 2661 | 666 | 11444 | 2861 |
| pm-beads | 2684 | 671 | 9158 | 2290 |
| pm-ops | 2655 | 664 | 8229 | 2058 |

The ten questions use 14 calls, 42044 delivered bytes versus 97937 baseline bytes: 57.07% fewer. The largest serialized page is 3836 bytes. Every page meets the 6400-byte limit (1600 estimated tokens using `ceil(bytes/4)`).

## Reproduce

```sh
npm run build
node test/corpus.ts
npm run test:public-harness
npm run test:real-data
node --test --test-concurrency=2 test/corpus-privacy.test.ts test/real-data.test.ts
```

Acquisition deliberately archives only `.agents/pm`; execution archives the entire tree at the identical pinned revision. Linked-command checks use the platform default shell and the platform PATH delimiter. Packed publication acceptance separately requires POSIX and bash.

Acquisition and the public harness require the three public source checkouts with the frozen commits. Default release checks require only frozen fixtures and receipts. No source tracker is modified, and no release, deployment or hosted operation is run. Corpus copies and binary/cache artifacts are disposable and untracked. The synthetic non-software seed/growing model in `test/helpers.ts` exercises general applicability and unsupported limits; it does not replace this public proof.
