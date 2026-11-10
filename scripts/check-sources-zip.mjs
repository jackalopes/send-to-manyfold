// Fails when the AMO sources zip holds anything that is not tracked by git (a stray private file would ship to Mozilla).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const ALLOWED = new Set(['.nvmrc']);
const zips = readdirSync('.output').filter((f) => f.endsWith('-sources.zip'));
if (zips.length !== 1) {
  console.error(`Expected one .output/*-sources.zip, found ${zips.length}.`);
  process.exit(1);
}
const lines = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
const tracked = new Set(lines('git', ['ls-files']));
const untracked = lines('unzip', ['-Z1', `.output/${zips[0]}`]).filter(
  (e) => !e.endsWith('/') && !tracked.has(e) && !ALLOWED.has(e),
);
if (untracked.length) {
  console.error(`${zips[0]} contains files not tracked by git:\n${untracked.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`${zips[0]}: all entries are tracked by git.`);
