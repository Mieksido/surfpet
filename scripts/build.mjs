import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  target: 'chrome120',
};

const mainCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/main/main.ts')],
  outfile: path.join(out, 'main.js'),
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node20',
};

const preloadCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/preload/preload.ts')],
  outfile: path.join(out, 'preload.js'),
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node20',
};

const rendererCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/renderer/index.ts')],
  outfile: path.join(out, 'renderer.js'),
  platform: 'browser',
  format: 'iife',
};

const sliderCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/slider/index.ts')],
  outfile: path.join(out, 'slider.js'),
  platform: 'browser',
  format: 'iife',
};

const dialogCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/dialog/index.ts')],
  outfile: path.join(out, 'dialog.js'),
  platform: 'browser',
  format: 'iife',
};

const bubbleCfg = {
  ...common,
  entryPoints: [path.join(root, 'src/bubble/index.ts')],
  outfile: path.join(out, 'bubble.js'),
  platform: 'browser',
  format: 'iife',
};

if (watch) {
  const { context } = await import('esbuild');
  for (const cfg of [mainCfg, preloadCfg, rendererCfg, sliderCfg, dialogCfg, bubbleCfg]) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('[build] watching…');
} else {
  await Promise.all([build(mainCfg), build(preloadCfg), build(rendererCfg), build(sliderCfg), build(dialogCfg), build(bubbleCfg)]);
  await copyFile(path.join(root, 'src/renderer/index.html'), path.join(out, 'index.html'));
  await copyFile(path.join(root, 'src/slider/index.html'), path.join(out, 'slider.html'));
  await copyFile(path.join(root, 'src/dialog/index.html'), path.join(out, 'dialog.html'));
  await copyFile(path.join(root, 'src/bubble/index.html'), path.join(out, 'bubble.html'));
  console.log('[build] done → dist/');
}
