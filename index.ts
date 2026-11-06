import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import { register } from './src/commands.ts';
/** Native finite case-model extension; activation contributes schema and commands only. */
const extension = defineExtension({ name: 'pm-case', version: '2026.11.6', description: 'Constrained test design and exact coverage context', activate: register });
/** Activate through the native pm extension host. */
export default extension;
/** Authorized in-process lifecycle, coverage and resume operations. */
export { createCaseModel, proposeCases, selectCases, recordCaseOutcome, caseCoverage, explainCaseTuple, casePacket, readCaseModel, recoverCaseOperation } from './src/api.ts';
/** Operation result types shared with agents and downstream packages. */
export type { MutationReceipt, CaseProposal, CoverageReport, TupleExplanation, CasePacket, CaseOperationResult } from './src/api.ts';
/** Conforming native directory provider; no Git or CLI subprocess requirement. */
export { createDirectoryHost } from './src/host.ts';
/** Injected authorized host capability and selected-owner contracts. */
export type { Host, Snapshot } from './src/host.ts';
/** Strict public nested input and state schemas, plus canonical content identities. */
export { KeySchema, DigestSchema, SourceRefSchema, AssignmentSchema, FactorSchema, ConstraintSchema, CaseModelSchema, CaseSchema, TupleSchema, PlanSchema, OutcomeSchema, CommittedResultSchema, ReplaySchema, CaseStateSchema, CreateCaseModelInputSchema, ProposeCasesInputSchema, SelectCasesInputSchema, RecordCaseOutcomeInputSchema, CoverageInputSchema, RecoveryInputSchema, ExplainTupleInputSchema, PacketInputSchema, canonical, digest } from './src/schema.ts';
/** Portable model and request types. */
export type { CaseModel, Assignment, CaseState, CasePlan, Outcome, CreateCaseModelInput, ProposeCasesInput, SelectCasesInput, RecordCaseOutcomeInput, CoverageInput, RecoveryInput, ExplainTupleInput, PacketInput } from './src/schema.ts';
/** Pure finite-model algorithms with exact denominators and immutable case identities. */
export { normalizeModel, enumerateFeasibleTuples, generateCover, evaluateCaseCoverage, readState } from './src/kernel.ts';
/** Strict output contracts and whole-envelope fitting. */
export { CoverageSummarySchema, CoverageReportSchema, MutationReceiptSchema, PacketRowSchema, GapSchema, CaseDataSchema, CaseResultSchema, envelope, fitEnvelope } from './src/output.ts';
/** Typed common transport payload and envelope. */
export type { CaseData, CaseResult } from './src/output.ts';
/** Payload-free domain refusals and stable public exit categories. */
export { CaseRefusal, exitCode } from './src/errors.ts';
