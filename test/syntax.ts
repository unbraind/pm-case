/** Walk static syntax nodes without evaluating acquisition code or third-party imports. */
export function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const child of value) walk(child,visit); return; }
  if (typeof value !== 'object' || value === null) return; const node = value as Record<string, unknown>; if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (!['loc','start','end','extra','comments','tokens'].includes(key)) walk(child,visit);
}
