#!/usr/bin/env node
/**
 * 把 live2dlayer 导出的分层工程导入成一套桌宠皮肤。
 *
 * 用法：
 *   node tools/import-skin.mjs <工程目录> <皮肤id> "<显示名>" [--scale 0.44] [--rig-from skins/feiyu-01/manifest.json]
 *
 * 工程目录要求：layers/*.png（同画布、透明底），文件名带语义关键词（back_hair / face / eyewhite-l …）。
 * 会生成 skins/<id>/manifest.json + art/，不需要准备 mask.png（运行时从图层 alpha 推导）。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) flags[a.slice(2)] = args[++i];
  else positional.push(a);
}

const [projectDir, skinId, displayName] = positional;
if (!projectDir || !skinId || !displayName) {
  console.error('usage: node tools/import-skin.mjs <projectDir> <skinId> "<display name>" [--scale 0.44] [--rig-from <manifest>]');
  process.exit(2);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const layersDir = path.join(projectDir, 'layers');
if (!fs.existsSync(layersDir)) {
  console.error('找不到 layers/ 目录:', layersDir);
  process.exit(1);
}

/** 文件名 → 行为 role / 分组 */
function classify(file) {
  const n = file.toLowerCase();
  if (n.includes('reference')) return null;
  if (!n.endsWith('.png')) return null;

  if (n.includes('back_hair')) return { role: 'hair.back', group: 'body' };
  if (n.includes('front_hair')) return { role: 'hair.front', group: 'head' };
  if (n.includes('headwear')) return { role: 'headwear', group: 'head' };
  if (n.includes('ears')) return { role: 'ears', group: 'head' };
  if (n.includes('bottomwear')) return { role: 'bottomwear', group: 'body' };
  if (n.includes('topwear')) return { role: 'topwear', group: 'body' };
  if (n.includes('neck')) return { role: 'neck', group: 'body' };
  if (n.includes('handwear-l') || n.includes('arm-l')) return { role: 'arm.l', group: 'body' };
  if (n.includes('handwear-r') || n.includes('arm-r')) return { role: 'arm.r', group: 'body' };
  if (n.includes('eyewhite-l')) return { role: 'eye.white.l', group: 'head' };
  if (n.includes('eyewhite-r')) return { role: 'eye.white.r', group: 'head' };
  if (n.includes('irides-l')) return { role: 'eye.iris.l', group: 'head' };
  if (n.includes('irides-r')) return { role: 'eye.iris.r', group: 'head' };
  if (n.includes('eyelash-l')) return { role: 'eye.lash.l', group: 'head' };
  if (n.includes('eyelash-r')) return { role: 'eye.lash.r', group: 'head' };
  if (n.includes('eyebrow-l')) return { role: 'brow.l', group: 'head' };
  if (n.includes('eyebrow-r')) return { role: 'brow.r', group: 'head' };
  if (n.includes('face')) return { role: 'face', group: 'head' };
  if (n.includes('nose')) return { role: 'nose', group: 'head' };
  if (n.includes('mouth')) return { role: 'mouth', group: 'head' };
  return { role: n.replace(/^\d+_?/, '').replace(/\.png$/, ''), group: 'body' };
}

const files = fs
  .readdirSync(layersDir)
  .map((f) => ({ file: f, ...(classify(f) ?? {}) }))
  .filter((f) => f.role)
  .sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))
  // 身体层排前面、头部层排后面：rig 用「第一个头部层的下标」决定 head 容器的 zIndex，
  // 头部层如果夹在衣服前面，脸就会被外套盖住（feiyu-04 的 ears 就踩过这个坑）
  .sort((a, b) => Number(a.group === 'head') - Number(b.group === 'head'));

if (!files.length) {
  console.error('layers/ 里没有可用的 PNG');
  process.exit(1);
}

/** 读 PNG 头拿画布尺寸（第一张图层为准） */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const canvasSize = pngSize(path.join(layersDir, files[0].file)) ?? { w: 1024, h: 1024 };

const skinDir = path.join(root, 'skins', skinId);
fs.mkdirSync(path.join(skinDir, 'art'), { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(layersDir, f.file), path.join(skinDir, 'art', f.file));
}

// 模板：优先沿用已有皮肤的锚点/交互配置（同一个角色换衣服时最省事）
let template = null;
const rigFrom = flags['rig-from'] ? path.resolve(root, flags['rig-from']) : null;
if (rigFrom && fs.existsSync(rigFrom)) {
  template = JSON.parse(fs.readFileSync(rigFrom, 'utf8'));
}

const manifest = {
  schema: 2,
  id: skinId,
  name: displayName,
  author: template?.author ?? 'you',
  version: '0.1.0',
  rig: 'layered',
  canvas: canvasSize,
  display: { scale: Number(flags.scale ?? template?.display?.scale ?? 0.44) },
  hitbox: template?.hitbox ?? { x: 150, y: 80, w: 720, h: 944 },
  persona: template?.persona ?? { name: displayName },
  ...(template?.rigOptions ? { rigOptions: template.rigOptions } : {}),
  ...(template?.interaction
    ? {
        interaction: {
          ...template.interaction,
          // 新皮肤不需要自带 mask.png：运行时由图层 alpha 推导
          mask: undefined,
          regions: template.interaction.regions ?? [],
          menu: template.interaction.menu ?? ['resize', 'separator', 'recenter', 'hide', 'quit'],
        },
      }
    : {
        interaction: {
          cursor: 'pointer',
          hoverCloseEyes: false,
          regions: [
            {
              id: 'head',
              gesture: 'pat',
              cursor: 'pointer',
              hoverCloseEyes: true,
              shape: { type: 'ellipse', cx: 596, cy: 320, rx: 200, ry: 200 },
            },
            {
              id: 'body',
              gesture: 'poke',
              cursor: 'pointer',
              shape: { type: 'rect', x: 240, y: 480, w: 560, h: 544 },
            },
          ],
          menu: ['resize', 'separator', 'recenter', 'hide', 'quit'],
        },
      }),
  layers: files.map((f, i) => ({
    id: `${f.role}${files.filter((x) => x.role === f.role).length > 1 ? `.${i}` : ''}`,
    file: `art/${f.file}`,
    group: f.group,
    role: f.role,
  })),
};

fs.writeFileSync(path.join(skinDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 人设：优先复用模板
if (template?.persona?.prompt) {
  const src = path.resolve(root, 'skins', template.id, template.persona.prompt);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(skinDir, template.persona.prompt));
}

console.log(`[import] ${skinId} -> ${skinDir}`);
console.log(`[import] ${files.length} layers:`, files.map((f) => f.role).join(', '));
