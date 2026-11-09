import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';

/** Include both the configured and resolved home, retaining the alias if it is unavailable. */
export function privateHomeRoots(home: string): string[] {
  try { return [home, realpathSync(home)]; } catch { return [home]; }
}
const currentHomes = privateHomeRoots(homedir());

/** Classify local home tokens without treating public URLs or relative documentation as paths. */
export function containsPrivateHomePath(text: string, homes: readonly string[] = currentHomes): boolean {
  for (const match of text.matchAll(/[\p{L}\p{N}_./\\~:$%?+-]+/gu)) {
    let end = match[0].length;
    while (end > 0 && match[0][end - 1] === '.') end--;
    const token = match[0].slice(0, end).replaceAll('\\', '/');
    if (/^(?:~|\$HOME|\$USERPROFILE|%HOME%|%USERPROFILE%)(?:\/|$)/iu.test(token)) return true;
    const protocol = token.split(':', 1)[0].toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(token) && !/^(?:[a-z]|file|source)$/u.test(protocol)) continue;
    for (let local of token.split(':')) {
      local = local.replace(/^-[a-z][a-z0-9_-]*(?=\/)/iu, '').replace(/^\/+localhost(?=\/)/iu, '');
      if (!local.startsWith('/')) continue;
      for (const spelling of [local, posix.normalize(local)]) {
        const path = spelling.toLowerCase();
        if (/^\/+\??(?:\/)?(?:home|users|root)(?:\/|$)/u.test(path)) return true;
        if (/^\/(?:cygdrive\/[a-z]|mnt\/(?:host\/)?[a-z]|run\/desktop\/mnt\/host\/[a-z]|var|system\/volumes\/data)\/(?:users|home)(?:\/|$)/u.test(path)) return true;
        if (/^\/(?:var|private\/var)\/root(?:\/|$)/u.test(path)) return true;
        if (/^\/\/(?:[?.]\/)?(?:unc\/)?(?:[^/]+\/){1,2}(?:users|home|root)(?:\/|$)/u.test(path)) return true;
        for (const home of homes) {
          const root = posix.resolve(home.replaceAll('\\', '/').replace(/^[a-z]:/iu, '')).toLowerCase();
          if (root === '/') continue;
          if (path === root || path.startsWith(root + '/')) return true;
        }
      }
    }
  }
  return false;
}
