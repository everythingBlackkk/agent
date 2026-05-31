// Sensitive-path gating. Returns true when the absolute path lies inside
// a directory or matches a filename that conventionally holds credentials,
// private keys, or other secrets the model should not read without an
// explicit user prompt.

import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';

const SYSTEM_PATHS = [
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/master.passwd',
  '/private/etc/master.passwd',
];

const HOME_RELATIVE = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.gcloud',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.config/op',
  '.pentesterflow',
  '.netrc',
  '.pgpass',
  '.npmrc',
  '.pypirc',
  '.bash_history',
  '.zsh_history',
  '.python_history',
  '.mysql_history',
  '.psql_history',
];

/**
 * Returns true when `abs` (an absolute path) matches a known-sensitive
 * file or sits under a known-sensitive directory. Uses exact match or
 * directory prefix match — `.ssh_other` does NOT match `.ssh`.
 */
export function isSensitivePath(abs: string): boolean {
  const cleaned = resolve(abs);

  for (const p of SYSTEM_PATHS) {
    if (cleaned === p || cleaned.startsWith(p + sep)) return true;
  }

  const home = homedir();
  if (!home) return false;

  for (const rel of HOME_RELATIVE) {
    const candidate = resolve(home, rel);
    if (cleaned === candidate || cleaned.startsWith(candidate + sep)) return true;
  }
  return false;
}
