#!/usr/bin/env node
/**
 * 把桌宠打成可分发的安装包（zip）：
 *   dist/ + skins/(只带运行需要的三套) + assets/ + package.json + README.md + 启动说明
 *
 * 用法：node tools/pack.mjs [输出路径]
 * 默认输出 artifacts/pet-pack.zip
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'artifacts/pet-pack.zip');
const stage = path.join(root, '.pack-stage');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

function copyDir(src, dst, filter = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (!filter(s, name)) continue;
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, filter);
    else fs.copyFileSync(s, d);
  }
}

copyDir(path.join(root, 'dist'), path.join(stage, 'dist'));
copyDir(path.join(root, 'assets'), path.join(stage, 'assets'));
copyDir(path.join(root, 'skins'), path.join(stage, 'skins'), (_s, name) => !name.startsWith('_'));

for (const f of ['package.json', 'README.md']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(stage, f));
}

// 安装包里不需要 devDependencies / 打包脚本，保留运行所需字段
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.scripts?.pack;
pkg.scripts = { start: pkg.scripts?.start ?? 'node scripts/start.mjs' };
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

fs.writeFileSync(path.join(stage, '启动说明.txt'), [
  '小肥鱼桌宠 —— 安装包',
  '',
  '本包不含 Electron 运行时，启动需要本机已安装的 electron.exe。',
  '在 SurfCore 的「桌宠」页里：',
  '  1. 填「Electron 路径」指向 electron.exe',
  '  2. 点「安装」把本包解压到 ~/.dsh/surfcore/pet/app',
  '  3. 点「启动」',
  '',
  '也可以手动运行：<electron.exe> . --no-sandbox',
].join('\r\n'));

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });

// Windows 用 PowerShell 压缩；其它平台用 zip 命令
if (process.platform === 'win32') {
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${out}' -Force`,
  ], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: stage, stdio: 'inherit' });
}

fs.rmSync(stage, { recursive: true, force: true });
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
console.log(`[pack] ${out} (${mb} MB)`);
