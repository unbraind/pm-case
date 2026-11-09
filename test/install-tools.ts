import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Probe the same required tools that gate the packed acceptance journey. */
export const packedToolNames = ['bun', 'npm', 'npx', 'sha256sum'] as const;

/** Explain missing acceptance prerequisites without treating absent runtime proof as a pass. */
export function packedRequirement(platform: NodeJS.Platform, tools?: readonly string[]): string | null {
  if (platform === 'win32') return 'Packed release acceptance requires POSIX, bash and Bun; run it on Linux or macOS';
  if (tools !== undefined) for (const tool of packedToolNames) if (!tools.includes(tool)) return `Packed release acceptance requires ${tool} on PATH and a working bash; install the required tools before running release:check`;
  return null;
}

/** Locate an exact provisioned runtime; missing CI evidence is always a failure. */
export function acceptanceRuntime(version: 'v22.19.0' | 'v26.13.0', executable: string, env: NodeJS.ProcessEnv): string | null {
  const supplied = version === 'v22.19.0' ? env.PM_CASE_NODE_22 : env.PM_CASE_NODE_26;
  const candidate = supplied ?? join(dirname(dirname(dirname(executable))), version, 'bin/node');
  if (existsSync(candidate)) return candidate;
  assert.ok(!env.GITHUB_ACTIONS, `Exact runtime ${version} must be provisioned in CI`);
  return null;
}
