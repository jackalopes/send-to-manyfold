/** Starts, provisions and removes the throwaway Manyfold of the end-to-end test. Used by e2e/run.ts only. */
import { execFile } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const PROJECT = 'stm-e2e';
export const COMPOSE_FILE = fileURLToPath(new URL('./docker-compose.yml', import.meta.url));
export const URL_BASE = 'http://127.0.0.1:3215';
export const TOKEN_FILE = fileURLToPath(new URL('./.token', import.meta.url));

const compose = (...args: string[]) => run('docker', ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args], { maxBuffer: 16 * 1024 * 1024 });

/** Runs inside the app container. It prints the token on a marked line, so only stdout is parsed, never logged. */
const PROVISION = `
u = User.create!(username: "e2e", email: "e2e@example.invalid", password: "e2e-only-Password-1", password_confirmation: "e2e-only-Password-1")
u.add_role(:contributor)
Library.create!(name: "E2E", storage_service: "filesystem", path: "/models")
app = Doorkeeper::Application.create!(name: "e2e", redirect_uri: "", scopes: "read write upload delete", owner: u)
t = app.access_tokens.create!(resource_owner_id: u.id, scopes: "read write upload", expires_in: nil)
puts "STM_TOKEN=" + t.plaintext_token
`;

export async function up(): Promise<void> {
  await compose('up', '-d');
}

/** Waits until the app answers HTTP (the first boot runs the database migrations). */
export async function waitHealthy(shouldStop: () => boolean = () => false, timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (shouldStop()) return;
    if (Date.now() > deadline) throw new Error(`Manyfold did not become healthy within ${timeoutMs / 1000}s`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/** Creates the admin user, a filesystem library and an API token; writes the token to a git-ignored, owner-only file. */
export async function provision(): Promise<void> {
  // The library volume is created root-owned; the app runs as uid 1000 and could not write extracted files into it.
  await compose('exec', '-T', '-u', 'root', 'app', 'chown', '1000:1000', '/models');
  const { stdout } = await compose('exec', '-T', 'app', 'bin/rails', 'runner', PROVISION);
  const token = /^STM_TOKEN=(\S+)$/m.exec(stdout)?.[1];
  if (!token) throw new Error('Provisioning did not return a token');
  await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  await chmod(TOKEN_FILE, 0o600);
}

/** Removes only this project's containers, network and volumes. Never throws. */
export async function down(): Promise<void> {
  await compose('down', '--volumes', '--remove-orphans', '--timeout', '5').catch(() => {});
}
