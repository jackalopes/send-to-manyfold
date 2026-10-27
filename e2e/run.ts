/** `npm run test:e2e`: start the stack, provision a token, run the e2e tests, then always tear everything down. */
import { spawn, type ChildProcess } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { down, provision, TOKEN_FILE, up, URL_BASE, waitHealthy } from './stack.ts';

async function doCleanup() {
  if (process.env.E2E_KEEP) return console.log('e2e: E2E_KEEP is set, leaving the stack running (the next run removes it first)');
  console.log('e2e: removing containers and volumes');
  try {
    await down();
  } finally {
    await rm(TOKEN_FILE, { force: true });
  }
}
// One shared promise: every path (finally, signal handlers) waits for the same teardown to finish.
let cleaning: Promise<void> | undefined;
const cleanup = () => (cleaning ??= doCleanup());

let child: ChildProcess | undefined;
let interrupted = false;

function vitest(): Promise<number> {
  return new Promise((resolve) => {
    child = spawn('npx', ['vitest', 'run', '--config', 'e2e/vitest.config.ts'], {
      stdio: 'inherit',
      env: { ...process.env, E2E_MANYFOLD_URL: URL_BASE, E2E_TOKEN_FILE: TOKEN_FILE },
    });
    child.on('error', (e) => {
      console.error('e2e: could not start vitest:', e.message);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// A signal never tears down by itself: it stops the child and makes the main flow skip its remaining steps, so the
// teardown below runs only after the in-flight step (compose up, provisioning, vitest) has settled.
let signalCode = 0;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    signalCode ||= sig === 'SIGINT' ? 130 : 143;
    interrupted = true;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      setTimeout(() => child?.kill('SIGKILL'), 10_000).unref();
    }
  });
}

let code = 1;
try {
  // Remove leftovers of a crashed earlier run first, so every run starts with an empty database.
  await down();
  if (!interrupted) {
    console.log('e2e: starting Manyfold on', URL_BASE);
    await up();
  }
  if (!interrupted) await waitHealthy(() => interrupted);
  if (!interrupted) await provision();
  if (!interrupted) {
    console.log('e2e: provisioned, running tests');
    code = await vitest();
  }
} catch (e) {
  console.error('e2e: setup failed:', e instanceof Error ? e.message : e);
} finally {
  await cleanup();
}
process.exit(signalCode || code);
