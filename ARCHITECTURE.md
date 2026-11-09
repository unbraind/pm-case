# Architecture

## Ownership and native records

The extension registers `CaseModel` in `case-models` and optional object field `case_state`. One native item owns schema version 1, the immutable model and its digest, an optional selected plan, every outcome and retained operation receipts. Native title and related links identify the task; audit comments are appended in the same mutation as domain state. Other native fields remain host-owned.

The directory SDK adapter provisions missing project schema only during explicit creation, after checking compatible ownership metadata. Extension activation contributes schema and scoped commands/renderers without durable migration writes. Native persisted schema uses the SDK's declared `caseState` option; extension-owned registration uses `field: ['case_state=...']`. The adapter routes those two supported forms. Package settings currently contain only `case.output_budget`; CLI settings reads are read-only. SDK write budgets are explicit input, and SDK callers choose their read fitter budget.

## Finite parameter and constraint model

Each factor has a stable ID, 2–8 unique value IDs, a reviewed label and pinned source references. Forbidden partial assignments carry a rationale and source references. Mandatory cases are complete valid assignments. Factor and value order normalize canonically; identities remain case-sensitive, and text/whitespace remains data. Equivalent canonical requests use the same write/replay normalization. Maps and own-property checks avoid prototype-key lookups.

The whole Cartesian population is bounded to 4096 before applying constraints. Enumerating all full assignments and rejecting forbidden ones establishes the feasible population. A t-tuple is feasible exactly when a valid full assignment contains it; all other tuples are explicitly excluded. Empty populations and invalid mandatory assignments refuse. Strength 1 and 2 are admitted. No arbitrary expressions, solver service, automatic factor extraction or case execution exists.

Source references are `{item_id,item_hash,field_pointer,content_digest,citation_id?}`. Native item hashes pin independently captured source snapshots; the public corpus content hashes cover exact UTF-8 passages. References do not assert current source freshness or authenticated truth. Package model/request/result digests use SHA-256 over canonical JSON. A case or tuple ID hashes the model digest plus its canonical assignment. A changed model creates a new owner, optionally with an exact predecessor reference; historical outcomes do not transfer.

## Generation algorithm

Version `exhaustive-greedy-v1`, seed 0, follows the specification's bounded exhaustive greedy reference algorithm. It is deterministic and makes no minimum-size or IPOG performance claim. Factor-ordered Cartesian expansion is already in canonical byte order. Mandatory valid cases are admitted first. Each next case maximizes newly covered feasible tuples; the first candidate in canonical byte order wins ties. Selection stops at complete coverage or `max_cases`, retaining exact uncovered counts. A bound smaller than the mandatory set refuses.

The stored plan digest binds the model, algorithm, fixed seed, mandatory cases, maximum and exact generated cases. A proposal additionally binds the native owner ID/revision. Selection recomputes using the same generator and rejects a different bound, revision or proposal digest. It may retain an explicitly incomplete proposal. A later selection must retain every observed case. Arbitrary seeds, higher strengths, alternative IPOG/SAT strategies and scheduling are deferred.

Domain and cover computation reuse at most eight entries each, keyed by the normalized model digest and, for covers, the requested maximum. Every call validates its submitted model before looking up a result. Results are isolated copies; stored reads still compare the entire deterministic plan. Reuse cannot validate a changed or malformed model by borrowing an earlier result.

An independent mixed-radix/combination oracle checks feasibility and coverage, including every small binary constraint mask. The public proof freezes exact feasible pair strings and their digests. Exhaustive three-way reference suites are proof artifacts only; the product refuses strength 3.

## Coverage and evidence

Planned tuple coverage counts feasible obligations covered by selected cases. Recorded execution tuple coverage counts obligations with a pass/fail observation for the exact model subject and the first recorded oracle scope. Unresolved observations contribute no execution coverage. Different oracles remain incomparable, and different subjects refuse at recording time. Multiple executions are retained; pass/fail counts can overlap for conflicting cases. Conflict identities, unavailable counts, unobserved cases, exact gaps and excluded tuples remain distinct.

Every admitted outcome has source references, immutable subject/oracle digests, an execution ID, timestamp, recorder, reason and `evidence_grade: reported`. Aggregation never upgrades it to verified execution. Stored reads validate model and plan digests, operation sequences/result digests, a one-to-one binding between outcomes and execution receipts, and owner identity. Coverage never implies source truth, correctness, higher-order coverage, statement coverage or approval.

## Mutation, concurrency and recovery

The injected host owns authorization, storage, locking and history. Creation uses an explicit ID and native create-if-absent. Duplicate recovery validates owner type/package/schema and the original creation request digest before adoption. Each existing-owner mutation requires an operation key and explicit expected revision.

After reading the owner, identical replay lookup precedes revision conflict detection. A changed request cannot use replay to bypass the guard. The next complete state, receipt and comment are computed and bounded before writing. `withExpectedItemRevisions([{id,itemHash}], ...)` places the single update under native locking; its returned guard receipt must include the owner in `checked` and have no unchecked guards. Native owner revisions include append-only receipt/comment growth, preventing package operations from returning to an earlier content state. No package mutex or get-then-unconditional-update exists.

Stale writes never auto-rebase. A caller rereads and consciously retries; concurrent identical operations reconcile to their original receipt. The original committed result stays separate from the current read-back revision. Interrupted callers reconcile by operation key: committed, not committed, or outcome unknown. Unknown requires inspection, not a fresh-key retry. Keys are retained to capacity, never evicted. Tests inject competitors and interruptions at each read/guard/update/receipt boundary and exercise independent OS writers and hard exits.

Directory and injected real-native-client conformance are certified locally. `PmClientOptions` in SDK 2026.11.5 accepts tracker/cwd/author/noExtensions, without a generic database transport option; native authoritative provider extraction and conformance remain upstream issues 1399, 1587 and 1588. Unsupported capability assertions or missing native methods refuse before storage access. No remote/database certification is inferred.

## Output and budgets

All seven commands share their SDK kernels, strict nested schemas and one versioned TOON/JSON envelope. The host's `fitOutputEnvelope` measures both exact serializers including receipt/framing/fitter metadata and final newline bytes. Default budget is 1600 estimated tokens, with a hard 32 KiB page ceiling. Mandatory identities, denominators, conflicts, unknowns and qualifications cannot be truncated. A fit failure returns the measured usable budget, or null when a narrower query is required. Writes preflight their receipt before schema or item mutation.

Packets paginate selected cases, uncovered tuples and excluded tuples in deterministic order, 20 rows by default, range 1–100. Cursors bind exact owner revision, query/page size and ordering. Every page retains a full-population summary. `returned + omitted = total`; `previously_returned + returned + remaining = total`. Full output completeness and exhausted continuation are separate facts.

SDK 2026.11.5 `ExtensionCommandReadOutput` exposes `row_keys` only, with no producer continuation callback. Packed consumers verify native cursor rejection before extension dispatch. Distinct package `--cursor`/`--budget` controls preserve the producer contract; conflicting native/package options refuse. Final scoped renderers refuse native compaction or byte overflow. Native producer parity remains tracked in `pm-case-native-output`; the fallback is shipped and tested.

## Resource and privacy boundaries

Limits apply before writing: 2–12 factors, 2–8 values each, 4096 Cartesian assignments, strength 1 or 2, 64 forbidden tuples, 32 mandatory cases, 256 selected cases and observations, 512 retained operation receipts and 256 KiB canonical domain state. Full JSON input is bounded to 256 KiB with fatal UTF-8 decoding. Oversized source definitions require a narrower model, not truncation.

The SDK privacy scanner and package guard run before mutations. Unsafe controls/bidi, malformed Unicode, absolute home paths, common email shapes, token-like content and prototype/accessor/cyclic objects refuse without reflecting input. Labels and notes are never evaluated as instructions. No runtime network, environment enumeration, model calls, shell, automatic source copying or side storage exists. Local author labels are not access control; host history/retention/redaction remain authoritative.

Submitted input traversal counts every visit, including revisits to shared subtrees, and refuses after 200,000 visits or sixteen nested levels. Public URLs and relative source paths remain permitted; the absolute-home-path check starts at path-token boundaries.

The runtime source inventory is `index.ts` and every module under `src`. The independent Istanbul instrumentation gate counts all emitted statements, branches, functions and lines with nonzero denominators and no ignores. Scripts/tests are development assets and not shipped. Packed npm/Bun acceptance installs its own captured tarball and verifies that the publish command selects a supplied archive even if an ignored distribution file changes afterward. It does not establish that the separately created release archive is identical to the installed archive. Binary/cache/archive artifacts remain untracked.
