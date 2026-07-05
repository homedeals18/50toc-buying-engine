import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['playwright', 'test', 'tests/blue-diamond-almonds.spec.js', '--project=chromium', '--headed'], {
  stdio: 'inherit',
  env: { ...process.env, BJS_BROWSER_MODE: 'manual-chrome' }
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
