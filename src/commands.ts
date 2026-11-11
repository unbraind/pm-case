import { readSettings, normalizeItemId } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { createCaseModel, proposeCases, selectCases, recordCaseOutcome, caseCoverage, explainCaseTuple, casePacket } from './api.ts';
import { parse, CreateCaseModelInputSchema, RecordCaseOutcomeInputSchema } from './schema.ts';
import { persistedSchemaPort } from './host.ts';
import type { Host } from './host.ts';
import { insist, refusal, CaseRefusal } from './errors.ts';
import { envelope, fitEnvelope, refusalEnvelope, renderOutput } from './output.ts';
import type { CaseData } from './output.ts';
/** Refuse empty, repeated or non-scalar CLI guards before dispatch. */
function scalar(value: unknown): string { insist(typeof value === 'string' && value.trim().length > 0, 'invalid_input', 'A required scalar option is missing'); return value; }
/** Validate native output controls without rounding or accepting trailing garbage. */
function integer(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  insist((typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'invalid_input', 'Output control must be a positive integer'); return Number(value);
}
/** Bounded fatal UTF-8 JSON ingestion from inline input or stdin, never a side file. */
export async function inputJson(value: unknown, source: AsyncIterable<Uint8Array> = process.stdin): Promise<Record<string, unknown>> {
  let text = scalar(value);
  if (text === '-') {
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of source) { const data = Buffer.from(chunk); bytes += data.length; insist(bytes <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); chunks.push(data); }
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); } catch { throw new CaseRefusal('invalid_input', 'Malformed UTF-8 JSON'); }
  }
  insist(Buffer.byteLength(text) <= 262144, 'invalid_input', 'Input exceeds 256 KiB'); let data: unknown;
  try { data = JSON.parse(text) as unknown; } catch { throw new CaseRefusal('invalid_input', 'Malformed JSON'); }
  insist(data !== null && typeof data === 'object' && !Array.isArray(data), 'invalid_input', 'Input must be a strict JSON object'); return data as Record<string, unknown>;
}
/** Dispatch all CLI operations through the same public SDK kernels. */
export async function runCommand(command: string, ctx: CommandHandlerContext): Promise<unknown> {
  try {
    insist(ctx.sdk !== undefined, 'backend_unsupported', 'Host did not supply a native SDK client', 'Use pm-cli 2026.11.5 or a conforming authorized host');
    const persisted = (await ctx.sdk.client.schemaListFields()).fields.find(field => field.key === 'case_state');
    insist(persisted === undefined || persisted.type === 'object', 'invalid_record', 'case_state has an incompatible schema');
    const host: Host = { client: persisted ? persistedSchemaPort(ctx.sdk.client) : ctx.sdk.client, fitOutputEnvelope: ctx.sdk.fitOutputEnvelope, capabilities: { native_item_cas: true, create_if_absent: true, provider: 'directory-host' }, normalizeId: async id => normalizeItemId(id, (await readSettings(ctx.pm_root)).id_prefix) };
    const settings = (await ctx.sdk.readSettingsSection('case')).value;
    insist(settings === undefined || (settings !== null && typeof settings === 'object' && !Array.isArray(settings) && Object.keys(settings).every(key => key === 'output_budget')), 'invalid_record', 'Unsupported package settings');
    const policy = settings as { output_budget?: unknown } | undefined; const flags = ctx.options;
    insist(ctx.global.outputInclude === undefined && ctx.global.outputSession === undefined && ctx.global.outputRowContract === undefined, 'invalid_input', 'Generic projection would omit mandatory coverage witnesses', 'Use case packet --limit');
    insist(flags.budget === undefined || ctx.global.outputBudget === undefined, 'invalid_input', 'Choose one budget transport');
    const requested = flags.budget === undefined ? ctx.global.outputBudget : flags.budget;
    // The stored setting is read lazily: an explicit budget must never be refused by an invalid stored policy value.
    const budget = requested === 'unbounded' ? 8192 : requested !== undefined ? integer(requested, 1600) : integer(policy?.output_budget, 1600);
    insist(requested !== undefined || budget <= 8192, 'invalid_input', 'Stored output budget exceeds the 8192 token ceiling');
    insist(command === 'packet' || (ctx.global.outputCursor === undefined && ctx.global.outputLimit === undefined), 'invalid_input', 'Pagination applies only to case packet');
    insist(flags.cursor === undefined || ctx.global.outputCursor === undefined, 'invalid_input', 'Choose one cursor transport', 'Use --cursor for package continuation');
    insist(flags.limit === undefined || ctx.global.outputLimit === undefined, 'invalid_input', 'Choose one limit transport');
    const id = await host.normalizeId!(command === 'create' ? scalar(flags.id) : scalar(ctx.args[0])); let data: CaseData;
    if (command === 'create' || command === 'record') {
      const raw = await inputJson(flags.input); insist(!Object.keys(raw).some(key => ['id','op','revision','budget'].includes(key)), 'invalid_input', 'Use explicit identity, operation and revision flags');
      const op = scalar(flags.op);
      if (command === 'create') data = await createCaseModel(host, parse(CreateCaseModelInputSchema, { ...raw, id, op, budget }));
      else data = await recordCaseOutcome(host, parse(RecordCaseOutcomeInputSchema, { ...raw, id, op, revision: scalar(flags.revision), budget }));
    } else if (command === 'propose') data = await proposeCases(host, { id, max_cases: integer(flags.maxCases, 256) });
    else if (command === 'select') data = await selectCases(host, { id, max_cases: integer(flags.maxCases, 256), proposal: scalar(flags.proposal), revision: scalar(flags.revision), op: scalar(flags.op), budget });
    else if (command === 'coverage') data = await caseCoverage(host, { id });
    else if (command === 'explain') data = await explainCaseTuple(host, { id, tuple: scalar(flags.tuple) });
    else { insist(command === 'packet', 'invalid_input', 'Unknown case command'); data = await casePacket(host, { id, limit: integer(ctx.global.outputLimit ?? flags.limit, 20), cursor: flags.cursor === undefined ? ctx.global.outputCursor : scalar(flags.cursor) }); }
    return fitEnvelope(host, envelope(data), budget);
  } catch (error) { return fitEnvelope({ fitOutputEnvelope: ctx.sdk?.fitOutputEnvelope }, refusalEnvelope(refusal(error)), 1600); }
}
/** Register schema and host renderer contracts without durable activation side effects. */
export function register(api: ExtensionApi): void {
  api.registerItemTypes([{ name: 'CaseModel', folder: 'case-models', description: 'Constrained finite models' }]);
  api.registerItemFields([{ name: 'case_state', type: 'object', optional: true }]);
  const definitions = [
    ['create', [], ['id','input','op'], 'Create an immutable finite model', 'pm case create --id suite --input - --op birth'],
    ['propose', ['id'], ['max-cases'], 'Propose a deterministic bounded cover', 'pm case propose suite --max-cases 32'],
    ['select', ['id'], ['proposal','max-cases','revision','op'], 'Select the exact recomputed proposal', 'pm case select suite --proposal <digest> --max-cases 32 --revision <hash> --op plan'],
    ['record', ['id'], ['input','revision','op'], 'Append reported execution evidence', 'pm case record suite --input - --revision <hash> --op observation'],
    ['coverage', ['id'], [], 'Count exact planned and observed obligations', 'pm case coverage suite'],
    ['explain', ['id'], ['tuple'], 'Explain feasibility and case witnesses', 'pm case explain suite --tuple <digest>'],
    ['packet', ['id'], ['limit','cursor'], 'Resume a revision-bound gap packet', 'pm case packet suite --limit 5 --budget 1600'],
  ] as const;
  for (const format of ['json','toon'] as const) api.registerRenderer(format, ctx => renderOutput(ctx.result, format).trimEnd(), { commands: definitions.map(([name]) => `case ${name}`) });
  for (const [name, args, names, description, example] of definitions) {
    const flags: FlagDefinition[] = [...names, 'budget'].map(flag => ({ long: `--${flag}`, value_type: 'string', value_name: flag, description: `${flag}; ${example}` }));
    api.registerCommand(defineCommand({ ...(['propose','coverage','explain','packet'].includes(name) ? { read_output: { row_keys: [] } } : {}), name: `case ${name}`, description, intent: 'Preserve finite input-combination coverage as durable agent context', arguments: args.map(arg => ({ name: arg, required: true, description: 'Authorized case owner' })), flags, examples: [example], run: ctx => runCommand(name, ctx) }));
  }
}
