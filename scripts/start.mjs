import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });

const env = { ...process.env };
// 从 DSH / 其他 Electron 宿主继承来的变量会让我们自己的 app 变形
delete env.ELECTRON_RUN_AS_NODE;

function launch(extra) {
  return new Promise((resolve) => {
    console.log('[start] launch', JSON.stringify(extra), 'args=', JSON.stringify(args));
    const child = spawn(electronPath, ['.', ...extra, ...args], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    child.on('error', (err) => console.error('[start] spawn error', err));
    child.on('exit', (code, signal) => {
      console.log('[start] exit code=', code, 'signal=', signal);
      resolve({ code, signal });
    });
  });
}

let result = await launch([]);
// 这个环境里 Chromium sandbox 起不来（Windows 上表现为 exit 3 / 0x80000003），
// 退一步用 --no-sandbox 再试一次；普通桌面环境第一次就会成功。
if (result.code !== 0) {
  console.warn('[start] launch failed (code', result.code, '), retrying with --no-sandbox …');
  await new Promise((r) => setTimeout(r, 1500));
  result = await launch(['--no-sandbox']);
  console.warn('[start] retry exited with', result.code);
}
process.exitCode = typeof result.code === 'number' ? result.code : 0;
