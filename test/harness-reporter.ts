/** Emit per-test events without aggregate file-wrapper pass counts. */
export default async function* report(source: AsyncIterable<{ type: string; data: unknown }>): AsyncGenerator<string> {
  for await (const event of source) if (event.type === 'test:pass' || event.type === 'test:fail') yield JSON.stringify({ type: event.type, ...event.data as Record<string, unknown> }, (_key, value: unknown) => value instanceof Error ? { ...value, name: value.name, message: value.message } : value) + '\n';
}
