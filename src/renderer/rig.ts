import { Application, Container, Sprite, Texture, ImageSource, MeshSimple } from 'pixi.js';

export interface LayerDef {
  id: string;
  file: string;
  group: 'body' | 'head';
  role: string;
  follow?: number;
}

export interface EllipseShape {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export interface RectShape {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Shape = EllipseShape | RectShape;

export interface Region {
  id: string;
  /** 该区域上的手势语义：pat（摸摸）/ poke（戳）/ 自定义 */
  gesture?: string;
  cursor?: string;
  /** 光标停在该区域时闭眼（默认：pat 区域开启） */
  hoverCloseEyes?: boolean;
  /** 点这个区域时同步播放的音效 id（对应 interaction.sounds 的键） */
  sound?: string;
  shape: Shape;
}

export interface InteractionDef {
  cursor?: string;
  /** 全局默认：光标停在角色上是否闭眼；区域可单独覆盖 */
  hoverCloseEyes?: boolean;
  /** 命中遮罩（灰度 PNG，白=可命中），缺省时退回 hitbox 矩形 */
  mask?: string;
  maskSize?: [number, number];
  regions?: Region[];
  /** 音效表：id → 相对皮肤目录的音频文件（wav/ogg/mp3） */
  sounds?: Record<string, string>;
  /** 右键菜单动作 id 列表，'separator' 分隔线 */
  menu?: string[];
}

export interface RigOptions {
  headPivot?: [number, number];
  backHairPivot?: [number, number];
  mouthPivot?: [number, number];
  gazeCenter?: [number, number];
  eyeCenters?: { l: [number, number]; r: [number, number] };
  /** 尾巴旋转中心（画布坐标）与摆幅 */
  tailPivot?: [number, number];
  tailAmp?: number;
  /** 嘴部是否参与说话动画（旧字段；新皮肤用 mouth 配置） */
  mouthTalk?: boolean;
  /** 张嘴 / 闭嘴动作的素材与模式 */
  mouth?: MouthDef;
  /**
   * 眨眼时睫毛的位移：数字=两只眼睛同样下移；
   * 对象形式可分别给 [x, y]（左右眼常常不对称，闭眼线才不会歪）
   */
  blinkLash?: number | { l: [number, number]; r: [number, number] };
  /** 头部左右倾斜系数（配合 motion.headTurn） */
  headTilt?: number;
  /** 果冻感：点击/拖拽/落地时的挤压拉伸（Q 版皮肤建议开） */
  jelly?: boolean;
  motion?: {
    breath?: number;
    sway?: number;
    headTurn?: number;
    gazeMax?: [number, number];
  };
}

/**
 * 单个脸颊的局部收缩：以 (cx, cy) 为中心，最大位移 (dx, dy)（画布像素）。
 * 用来把鼓起来的脸蛋平滑回去，而不是缩放整张脸。
 */
export interface CheekWarpDef {
  cx: number;
  cy: number;
  rx?: number;
  ry?: number;
  /** 正数=往右，负数=往左 */
  dx?: number;
  /** 正数=往下，负数=往上 */
  dy?: number;
}

/**
 * 一条目标轮廓曲线（二次贝塞尔）：张嘴时把曲线外侧的脸颊顶点平滑压到曲线上，
 * 让下半张脸收成一条连续光滑的轮廓；两端权重渐隐，不会出现棱角。头发不动。
 */
export interface ContourCutDef {
  /** 曲线起点（画布坐标，靠下巴一侧） */
  x1: number;
  y1: number;
  /** 控制点（决定曲线往哪边鼓） */
  cx: number;
  cy: number;
  /** 曲线终点（画布坐标，靠脸颊/头发一侧） */
  x2: number;
  y2: number;
  /** 只处理离曲线最多 band 像素的顶点 */
  band?: number;
  /** 生效区域（防止碰到下巴和别的地方） */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
}

/**
 * 脸部网格的「瘪下去」参数：
 * - cheeks：只影响脸颊的局部收缩（推荐；下巴不动）
 * - contour：把右脸下半部收成一条指定轮廓线
 * - cx/cy/k…：旧版的单中心整体收缩，仍兼容旧皮肤
 */
export interface MouthWarpDef {
  cheeks?: CheekWarpDef[];
  contour?: ContourCutDef;
  /** 纵向：从该 y 开始逐渐生效 */
  fadeTop?: number;
  fadeTopEnd?: number;
  /** 纵向：到该 y 逐渐失效（保住下巴和下颌线） */
  fadeBottom?: number;
  fadeBottomEnd?: number;
  /** 旧版单中心收缩 */
  cx?: number;
  cy?: number;
  k?: number;
  rx?: number;
  ry?: number;
  top?: number;
  bottom?: number;
  lift?: number;
}

/**
 * rigOptions.mouth：
 * - rest=closed（默认）：原图是闭嘴；张嘴时叠加 open（嘴洞）+ openCover（盖住原嘴线）
 * - rest=open：原图是张嘴；说话时把原嘴层纵向压扁来闭嘴（squash）
 * - dent/warp：不画嘴洞，改用脸部「瘪下去」的阴影 + 网格形变（元气皮肤）
 */
export interface MouthDef {
  rest?: 'closed' | 'open';
  /** 张嘴叠加图：透明底，只画嘴洞 */
  open?: string;
  /** 嘴洞的缩放中心（画布坐标）；缺省用 mouthPivot */
  openPivot?: [number, number];
  /** 张嘴时盖住原闭嘴线条的补丁（与原嘴图层同 alpha，只去掉线条） */
  openCover?: string;
  /**
   * 张嘴时把原嘴图层整层收掉（默认 false）。
   * 适合原嘴是一整条闭合线（w 猫嘴）的皮肤：open 素材本身是一张完整的嘴，
   * 再叠在原嘴上就变成「闭着的嘴 + 张开的嘴」两张嘴。开启后原嘴随张嘴进度淡出，闭嘴时再淡回。
   */
  hideBase?: boolean;
  /** 张嘴素材整体微调：[dx, dy]（画布像素，负值=左上）；缩放/旋转轴跟着一起平移 */
  openOffset?: [number, number];
  /** 张嘴素材的旋转角度（度，正值 = 屏幕上顺时针） */
  openRotation?: number;
  /** 瘪脸阴影叠加图 */
  dent?: string;
  /** 瘪脸时的网格收缩参数 */
  warp?: MouthWarpDef;
  /** 瘪脸阴影强度（默认 1） */
  dentStrength?: number;
  /** 闭嘴时嘴层纵向最小比例，默认 0.2 */
  squashMin?: number;
  /**
   * 压扁闭嘴时额外转多少度（正值=屏幕上顺时针，张开时回到 0）。
   * 原图张嘴的皮肤靠纵向压扁闭嘴，压出来的细线如果和脸的朝向不搭，用它把闭嘴角度掰正。
   */
  squashRotation?: number;
  /** 压扁闭嘴时额外平移 [dx, dy]（画布像素，正值=右下；张开时回到 0） */
  squashOffset?: [number, number];
}

export interface Manifest {
  schema: number;
  id: string;
  name: string;
  rig: 'layered';
  canvas: { w: number; h: number };
  display: { scale: number };
  hitbox: { x: number; y: number; w: number; h: number };
  rigOptions?: RigOptions;
  interaction?: InteractionDef;
  layers: LayerDef[];
}

const DEFAULTS = {
  headPivot: [512, 512] as [number, number],
  backHairPivot: [512, 320] as [number, number],
  mouthPivot: [512, 470] as [number, number],
  gazeCenter: [512, 400] as [number, number],
  eyeCenters: { l: [640, 410], r: [524, 374] } as { l: [number, number]; r: [number, number] },
  motion: { breath: 0.011, sway: 0.008, headTurn: 16, gazeMax: [6, 4.5] as [number, number] },
};

/** 脸部瘪下去的网格细分；96 格在 1024 画布上约 11px/格，曲线轮廓更平滑 */
const FACE_GRID = 96;

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 平面网格：顶点/UV/索引，用于给脸部做局部形变 */
function buildGrid(w: number, h: number, nx: number, ny: number) {
  const verts = new Float32Array((nx + 1) * (ny + 1) * 2);
  const uvs = new Float32Array((nx + 1) * (ny + 1) * 2);
  const idx: number[] = [];
  let k = 0;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      verts[k] = (i / nx) * w;
      verts[k + 1] = (j / ny) * h;
      uvs[k] = i / nx;
      uvs[k + 1] = j / ny;
      k += 2;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { verts, uvs, indices: new Uint32Array(idx) };
}

export class PetRig {
  app!: Application;
  manifest: Manifest;
  baseUrl: string;
  root!: Container;
  body!: Container;
  head!: Container;
  backHair!: Container;
  mouthWrap!: Container;
  tailWrap?: Container;
  sprites = new Map<string, Sprite>();
  images: HTMLImageElement[] = [];

  /** 脸部节点：普通皮肤是 Sprite；带 warp 的皮肤（元气）是网格 */
  faceNode?: Sprite | MeshSimple;
  faceMesh?: MeshSimple;
  faceBase?: Float32Array;
  dentMesh?: MeshSimple;
  faceIndex = -1;

  /** 嘴部节点（新 mouth 配置用） */
  mouthBase?: Sprite;
  mouthOpenSprite?: Sprite;
  mouthOpenCover?: Sprite;
  mouthMode: 'none' | 'squash' | 'swap' | 'dent' = 'none';
  mouthOpen = 0;
  mouthDemo = 0;
  mouthDemoTotal = 0;
  mouthOverride: number | null = null;

  eyes: Record<'l' | 'r', { white?: Sprite; iris?: Sprite; lash?: Sprite }> = { l: {}, r: {} };
  brows: Sprite[] = [];

  scale = 0.44;
  hostW = 460;
  hostH = 490;

  opts: {
    headPivot: [number, number];
    backHairPivot: [number, number];
    mouthPivot: [number, number];
    gazeCenter: [number, number];
    eyeCenters: { l: [number, number]; r: [number, number] };
    motion: { breath: number; sway: number; headTurn: number; gazeMax: [number, number] };
    tailPivot?: [number, number];
    tailAmp: number;
    mouthTalk: boolean;
    mouth?: MouthDef;
    blinkLash: number | { l: [number, number]; r: [number, number] };
    headTilt: number;
    jelly: boolean;
  } = {
    headPivot: DEFAULTS.headPivot,
    backHairPivot: DEFAULTS.backHairPivot,
    mouthPivot: DEFAULTS.mouthPivot,
    gazeCenter: DEFAULTS.gazeCenter,
    eyeCenters: DEFAULTS.eyeCenters,
    motion: DEFAULTS.motion,
    tailAmp: 0.1,
    mouthTalk: false,
    blinkLash: 26,
    headTilt: 0.012,
    jelly: false,
  };

  mask: Uint8Array | null = null;
  maskW = 0;
  maskH = 0;

  /** 音效：id → 预加载的 <audio> 池（同一个音效连点时可以叠着响） */
  soundPool = new Map<string, { els: HTMLAudioElement[]; i: number }>();
  lastSound: string | null = null;
  lastSoundAt = 0;

  t = 0;
  blinkValue = 0;
  blinkPhase: 'idle' | 'close' | 'hold' | 'open' = 'idle';
  blinkTimer = 0;
  nextBlink = 2.5;
  talkEnvelope = 0;
  /** 持续说话状态（气泡/语音还没说完时由主进程点亮），嘴会一直开合 */
  talking = false;
  patTimer = 0;
  wagEnergy = 0;
  tailShy = 0;
  jelly = 0;
  jellyVel = 0;
  headHover = false;
  headHoverTimer = 0;
  hoverEye = 0;
  dragging = false;
  squash = 0;
  hop = 0;
  hopVel = 0;

  gaze = { x: 0, y: 0 };
  gazeTarget = { x: 0, y: 0 };
  headTurn = 0;
  headTurnTarget = 0;

  pointer = { x: -1000, y: -1000 };

  constructor(manifest: Manifest, baseUrl: string) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.scale = manifest.display?.scale ?? 0.44;
    const o = manifest.rigOptions ?? {};
    this.opts = {
      headPivot: o.headPivot ?? DEFAULTS.headPivot,
      backHairPivot: o.backHairPivot ?? DEFAULTS.backHairPivot,
      mouthPivot: o.mouthPivot ?? DEFAULTS.mouthPivot,
      gazeCenter: o.gazeCenter ?? DEFAULTS.gazeCenter,
      eyeCenters: o.eyeCenters ?? DEFAULTS.eyeCenters,
      motion: { ...DEFAULTS.motion, ...(o.motion ?? {}) },
      tailPivot: o.tailPivot,
      tailAmp: o.tailAmp ?? 0.1,
      mouthTalk: o.mouthTalk ?? false,
      mouth: o.mouth,
      blinkLash: o.blinkLash ?? 26,
      headTilt: o.headTilt ?? 0.012,
      jelly: o.jelly ?? false,
    };
  }

  private async loadTexture(file: string): Promise<{ img: HTMLImageElement; texture: Texture }> {
    const img = new Image();
    img.decoding = 'async';
    img.src = this.baseUrl + file;
    await img.decode();
    const tex = new Texture({ source: new ImageSource({ resource: img }) });
    return { img, texture: tex };
  }

  private async loadSprite(file: string, track = true): Promise<Sprite> {
    const { img, texture } = await this.loadTexture(file);
    if (track) this.images.push(img);
    const sp = new Sprite(texture);
    sp.anchor.set(0, 0);
    sp.position.set(0, 0);
    return sp;
  }

  private async loadMask() {
    const inter = this.manifest.interaction;
    if (!inter?.mask) return;
    const img = new Image();
    img.src = this.baseUrl + inter.mask;
    await img.decode();
    const [mw, mh] = inter.maskSize ?? [256, 256];
    const c = document.createElement('canvas');
    c.width = mw;
    c.height = mh;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, mw, mh);
    const data = ctx.getImageData(0, 0, mw, mh).data;
    this.mask = new Uint8Array(mw * mh);
    for (let i = 0; i < mw * mh; i++) {
      // 灰度遮罩：取 R 通道
      this.mask[i] = data[i * 4] > 96 ? 1 : 0;
    }
    this.maskW = mw;
    this.maskH = mh;
  }

  /**
   * 预加载音效。用 <audio> 而不是 WebAudio：renderer 是 file:// 页面，
   * fetch/XHR 读本地文件会被拦，媒体元素不受影响；预加载后 play() 基本是零延迟。
   */
  private async loadSounds() {
    const defs = this.manifest.interaction?.sounds;
    if (!defs) return;
    for (const [id, file] of Object.entries(defs)) {
      const els: HTMLAudioElement[] = [];
      for (let i = 0; i < 3; i++) {
        const el = new Audio(this.baseUrl + file);
        el.preload = 'auto';
        el.volume = 0.8;
        els.push(el);
      }
      this.soundPool.set(id, { els, i: 0 });
      els[0].addEventListener(
        'canplaythrough',
        () => window.pet.log(`[sfx] ${id} ready ${(els[0].duration || 0).toFixed(2)}s`),
        { once: true }
      );
    }
  }

  /** 根据 rigOptions.mouth 决定用哪种张嘴方式，并把叠加图装进对应容器 */
  private async initMouth() {
    const m = this.opts.mouth;
    if (!m) return;
    const mp = this.opts.mouthPivot;
    let modeSet = false;

    if (m.open) {
      // 原图闭嘴 → 张嘴时浮现嘴洞，并用同色补丁盖住原来的线条（可选）
      this.mouthMode = 'swap';
      modeSet = true;
      this.mouthOpenSprite = await this.loadSprite(m.open, false);
      const op = m.openPivot ?? mp;
      const off = m.openOffset ?? [0, 0];
      this.mouthOpenSprite.pivot.set(op[0], op[1]);
      this.mouthOpenSprite.position.set(op[0] + off[0], op[1] + off[1]);
      if (m.openRotation) this.mouthOpenSprite.rotation = (m.openRotation * Math.PI) / 180;
      this.mouthOpenSprite.zIndex = 2;
      this.mouthOpenSprite.alpha = 0;
      this.mouthWrap.addChild(this.mouthOpenSprite);

      if (m.openCover) {
        this.mouthOpenCover = await this.loadSprite(m.openCover, false);
        this.mouthOpenCover.zIndex = 1;
        this.mouthOpenCover.alpha = 0;
        this.mouthWrap.addChild(this.mouthOpenCover);
      }
      // 原嘴图在最底层
      if (this.mouthBase) this.mouthBase.zIndex = 0;
    }

    if (m.dent || m.warp) {
      // 元气皮肤：不画洞，脸部网格往里瘪（可选再叠一层阴影）
      if (!modeSet) {
        this.mouthMode = 'dent';
        modeSet = true;
      }
      if (m.dent) {
        const { texture } = await this.loadTexture(m.dent);
        const grid = buildGrid(this.manifest.canvas.w, this.manifest.canvas.h, FACE_GRID, FACE_GRID);
        const mesh = new MeshSimple({
          texture,
          vertices: grid.verts,
          uvs: grid.uvs,
          indices: grid.indices,
        });
        mesh.zIndex = (this.faceIndex >= 0 ? this.faceIndex : 0) + 0.1;
        mesh.cullable = false;
        mesh.alpha = 0;
        this.head.addChild(mesh);
        this.dentMesh = mesh;
      }
    }

    if (!modeSet && m.rest === 'open') {
      // 原图张嘴 → 说话时把嘴层纵向压扁来闭嘴
      this.mouthMode = 'squash';
      if (this.mouthBase) {
        this.mouthBase.pivot.set(mp[0], mp[1]);
        this.mouthBase.position.set(mp[0], mp[1]);
      }
    }
  }

  async init(host: HTMLElement) {
    this.app = new Application();
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resizeTo: window,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: 'webgl',
    });
    host.appendChild(this.app.canvas);

    this.root = new Container();
    this.root.scale.set(this.scale);
    this.root.eventMode = 'none';
    this.app.stage.addChild(this.root);

    this.body = new Container();
    const cx = this.manifest.canvas.w / 2;
    const ch = this.manifest.canvas.h;
    this.body.position.set(cx, ch);
    this.body.pivot.set(cx, ch);
    this.root.addChild(this.body);

    const bp = this.opts.backHairPivot;
    this.backHair = new Container();
    this.backHair.position.set(bp[0], bp[1]);
    this.backHair.pivot.set(bp[0], bp[1]);
    this.body.addChild(this.backHair);

    const hp = this.opts.headPivot;
    this.head = new Container();
    this.head.position.set(hp[0], hp[1]);
    this.head.pivot.set(hp[0], hp[1]);
    this.body.addChild(this.head);

    // 显式 zIndex 排序：否则后加入的脖子/衣服会盖到脸上
    this.body.sortableChildren = true;
    this.head.sortableChildren = true;
    this.backHair.zIndex = 0;

    const mp = this.opts.mouthPivot;
    this.mouthWrap = new Container();
    this.mouthWrap.position.set(mp[0], mp[1]);
    this.mouthWrap.pivot.set(mp[0], mp[1]);
    this.mouthWrap.sortableChildren = true;

    let order = 0;
    let firstHeadIndex = Number.POSITIVE_INFINITY;

    for (const layer of this.manifest.layers) {
      const idx = order++;
      const role = layer.role;

      // 元气皮肤：脸部用网格渲染，说话时让脸颊局部往里瘪
      if (role === 'face' && this.opts.mouth?.warp) {
        const { img, texture } = await this.loadTexture(layer.file);
        this.images.push(img);
        const grid = buildGrid(this.manifest.canvas.w, this.manifest.canvas.h, FACE_GRID, FACE_GRID);
        const mesh = new MeshSimple({
          texture,
          vertices: grid.verts.slice(),
          uvs: grid.uvs,
          indices: grid.indices,
        });
        mesh.zIndex = idx;
        mesh.cullable = false;
        this.head.addChild(mesh);
        this.faceNode = mesh;
        this.faceMesh = mesh;
        this.faceBase = grid.verts;
        this.faceIndex = idx;
        firstHeadIndex = Math.min(firstHeadIndex, idx);
        continue;
      }

      const sp = await this.loadSprite(layer.file);
      this.sprites.set(layer.id, sp);
      sp.zIndex = idx;

      if (role === 'tail') {
        if (!this.tailWrap) {
          this.tailWrap = new Container();
          const tp = this.opts.tailPivot ?? [this.manifest.canvas.w / 2, this.manifest.canvas.h / 2];
          this.tailWrap.position.set(tp[0], tp[1]);
          this.tailWrap.pivot.set(tp[0], tp[1]);
          this.tailWrap.zIndex = idx;
          this.body.addChild(this.tailWrap);
        }
        this.tailWrap.addChild(sp);
      } else if (role === 'hair.back') {
        this.backHair.addChild(sp);
      } else if (role === 'mouth') {
        this.mouthBase = sp;
        this.mouthWrap.addChild(sp);
        this.mouthWrap.zIndex = idx;
        this.head.addChild(this.mouthWrap);
        firstHeadIndex = Math.min(firstHeadIndex, idx);
      } else if (role === 'face') {
        this.faceNode = sp;
        this.faceIndex = idx;
        this.head.addChild(sp);
        firstHeadIndex = Math.min(firstHeadIndex, idx);
      } else if (role.startsWith('eye.')) {
        this.head.addChild(sp);
        firstHeadIndex = Math.min(firstHeadIndex, idx);
        const [, kind, side] = role.split('.') as [string, string, 'l' | 'r'];
        const slot = this.eyes[side];
        if (kind === 'white') slot.white = sp;
        if (kind === 'iris') slot.iris = sp;
        if (kind === 'lash') slot.lash = sp;
      } else if (role.startsWith('brow.')) {
        this.head.addChild(sp);
        firstHeadIndex = Math.min(firstHeadIndex, idx);
        this.brows.push(sp);
      } else if (layer.group === 'head') {
        this.head.addChild(sp);
        firstHeadIndex = Math.min(firstHeadIndex, idx);
      } else {
        this.body.addChild(sp);
      }
    }

    // 头部整体插到第一个头部图层之前的位置（而不是固定最后）
    if (Number.isFinite(firstHeadIndex)) this.head.zIndex = firstHeadIndex - 0.5;
    this.backHair.zIndex = 0;

    await this.initMouth();
    this.mouthOpen = this.opts.mouth?.rest === 'open' ? 1 : 0;
    this.applyMouth(this.mouthOpen);
    await this.loadMask();
    await this.loadSounds();

    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.app.ticker.add((tk) => this.update(tk.deltaMS / 1000));
  }

  layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.hostW = w;
    this.hostH = h;
    // 关键：缩放要真的作用到 stage，之前只改了位置没改 scale，看起来就是「只平移不变大」
    this.root.scale.set(this.scale);
    const cw = this.manifest.canvas.w * this.scale;
    const chh = this.manifest.canvas.h * this.scale;
    // 整体等比缩放（whole）：
    // 装得下 → 脚底对齐窗口底边（站在任务栏上）；
    // 装不下 → 平滑过渡到头顶对齐（优先保住脸，身体往下延伸出屏幕）。
    const headroom = 40;
    const sFit = (h - headroom) / this.manifest.canvas.h;
    const t = sFit > 0 ? clamp((this.scale - sFit) / (0.35 * sFit), 0, 1) : 0;
    const yBottom = h - chh;
    const yHead = headroom - this.manifest.hitbox.y * this.scale;
    this.root.x = (w - cw) / 2;
    this.root.y = yBottom + (yHead - yBottom) * t;
  }

  /** 屏幕坐标 → 画布坐标 */
  toCanvas(x: number, y: number) {
    return { x: (x - this.root.x) / this.scale, y: (y - this.root.y) / this.scale };
  }

  setPointer(x: number, y: number) {
    this.pointer.x = x;
    this.pointer.y = y;
    const c = this.toCanvas(x, y);
    const [gx, gy] = this.opts.gazeCenter;
    this.gazeTarget.x = clamp((c.x - gx) / 260, -1, 1);
    this.gazeTarget.y = clamp((c.y - gy) / 220, -1, 1);
    this.headTurnTarget = clamp((c.x - 560) / 420, -1, 1);
  }

  /** 播放音效（id 来自 interaction.sounds），返回是否排上了播放 */
  playSound(id: string) {
    const pool = this.soundPool.get(id);
    if (!pool) return false;
    const el = pool.els[pool.i++ % pool.els.length];
    try {
      el.currentTime = 0;
    } catch {
      /* 还没拿到 metadata 时不能 seek，直接播也能从头开始 */
    }
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      return false;
    }
    this.lastSound = id;
    this.lastSoundAt = performance.now();
    return true;
  }

  /** 音效加载状态（自检用）：没配置返回 null */
  soundReady(id: string) {
    const pool = this.soundPool.get(id);
    if (!pool) return null;
    const el = pool.els[0];
    return { readyState: el.readyState, duration: Number.isFinite(el.duration) ? el.duration : 0 };
  }

  /** 精确命中：优先用遮罩（跟角色轮廓走），否则退回 hitbox 矩形 */
  hitTest(x: number, y: number): boolean {
    const c = this.toCanvas(x, y);
    const hb = this.manifest.hitbox;
    if (c.x < hb.x || c.x > hb.x + hb.w || c.y < hb.y || c.y > hb.y + hb.h) return false;
    if (!this.mask) return true;
    const mx = Math.floor((c.x / this.manifest.canvas.w) * this.maskW);
    const my = Math.floor((c.y / this.manifest.canvas.h) * this.maskH);
    if (mx < 0 || my < 0 || mx >= this.maskW || my >= this.maskH) return false;
    return this.mask[my * this.maskW + mx] === 1;
  }

  /** 命中区域（head/body/…），用于手势语义与光标 */
  regionAt(x: number, y: number): Region | null {
    const regions = this.manifest.interaction?.regions ?? [];
    if (!this.hitTest(x, y)) return null;
    const c = this.toCanvas(x, y);
    for (const r of regions) {
      const s = r.shape;
      if (s.type === 'ellipse') {
        const dx = (c.x - s.cx) / s.rx;
        const dy = (c.y - s.cy) / s.ry;
        if (dx * dx + dy * dy <= 1) return r;
      } else {
        if (c.x >= s.x && c.x <= s.x + s.w && c.y >= s.y && c.y <= s.y + s.h) return r;
      }
    }
    return null;
  }

  cursorAt(x: number, y: number): string | null {
    if (!this.hitTest(x, y)) return null;
    return this.regionAt(x, y)?.cursor ?? this.manifest.interaction?.cursor ?? 'pointer';
  }

  /**
   * 从所有图层的 alpha 合出命中遮罩（256×256）。
   * 这样新皮肤不需要额外准备 mask.png，丢进来就能精确命中。
   */
  buildMask(size = 256) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    for (const img of this.images) {
      try {
        ctx.drawImage(img, 0, 0, size, size);
      } catch {
        /* 个别图层解码异常不影响整体 */
      }
    }
    const data = ctx.getImageData(0, 0, size, size).data;
    const bits = new Uint8Array(size * size);
    for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] > 96 ? 1 : 0;
    return { w: size, h: size, bits };
  }

  /** 运行时缩放（调整大小滑条）；窗口尺寸由主进程同步调整 */
  setScale(scale: number) {
    this.scale = scale;
    this.layout();
  }

  setDragging(v: boolean) {
    this.dragging = v;
    if (v) {
      this.setHeadHover(false);
      this.jellyImpulse(-0.18);
    } else {
      this.jellyImpulse(0.22);
    }
  }

  /** 果冻形变冲量：负值=压扁，正值=回弹拉伸 */
  jellyImpulse(v: number) {
    if (!this.opts.jelly) return;
    this.jellyVel += v * 6;
  }

  /** 光标是否停在「会闭眼」的区域上（默认 pat 区域，可用 manifest 覆盖） */
  setHeadHover(v: boolean) {
    if (v === this.headHover) return;
    this.headHover = v;
    this.headHoverTimer = 0;
  }

  /** 查询某个区域在悬停时是否闭眼；皮肤可全局或按区域配置 */
  regionHoverClosesEyes(region: Region | null): boolean {
    if (!region) return false;
    if (typeof region.hoverCloseEyes === 'boolean') return region.hoverCloseEyes;
    if (region.gesture === 'pat') return true;
    return this.manifest.interaction?.hoverCloseEyes ?? false;
  }

  blink() {
    if (this.blinkPhase === 'idle') {
      this.blinkPhase = 'close';
      this.blinkTimer = 0;
    }
  }

  talk(seconds = 2.6) {
    this.talkEnvelope = seconds;
  }

  /** 开始持续说话：嘴一直按音节开合，直到 stopTalk（一句说完） */
  startTalk() {
    this.talking = true;
  }

  stopTalk() {
    this.talking = false;
  }

  /** 「张个嘴」演示：完整地张嘴→闭嘴 */
  mouth(seconds = 2.4) {
    this.mouthDemo = seconds;
    this.mouthDemoTotal = seconds;
  }

  /** 调试/截图用：把嘴固定在某个开合度（0=闭，1=张），传 null 恢复动画 */
  setMouthOverride(v: number | null) {
    this.mouthOverride = v;
  }

  pat(seconds = 1.4) {
    this.patTimer = seconds;
    this.wagEnergy = Math.max(this.wagEnergy, 0.55);
  }

  wag() {
    this.wagEnergy = 1;
  }

  /** 摸尾巴：尾巴炸毛式快摆 + 闭眼害羞 + 身体轻扭 */
  tailPet() {
    this.wagEnergy = 1.8;
    this.patTimer = 0.9;
    this.tailShy = 1;
    this.jellyImpulse(0.12);
  }

  playCommand(cmd: string) {
    if (cmd === 'blink') this.blink();
    else if (cmd === 'talk') this.talk();
    else if (cmd === 'talk-start') this.startTalk();
    else if (cmd === 'talk-stop') this.stopTalk();
    else if (cmd === 'mouth') this.mouth();
    else if (cmd === 'hop') {
      this.hopVel = 420;
      this.jellyImpulse(-0.16);
    }
    else if (cmd === 'pat') {
      this.pat();
      this.jellyImpulse(0.08);
    }
    else if (cmd === 'wag') this.wag();
    else if (cmd === 'tailpet') this.tailPet();
    else if (cmd === 'poke') {
      this.hopVel = 300;
      this.blink();
      this.jellyImpulse(-0.3);
    }
  }

  /** 把嘴的开合度（0=闭，1=张）应用到当前皮肤的模式上 */
  private applyMouth(open: number) {
    const m = this.opts.mouth;
    if (!m) return;

    if (this.mouthMode === 'squash' && this.mouthBase) {
      const min = m.squashMin ?? 0.2;
      const k = 1 - open;
      this.mouthBase.scale.set(1 - 0.05 * k, min + (1 - min) * open);
      // 压扁闭嘴时按比例补一点旋转/位移（张开时回 0）
      const rot = m.squashRotation ?? 0;
      this.mouthBase.rotation = ((rot * Math.PI) / 180) * k;
      const off = m.squashOffset ?? [0, 0];
      const mp = this.opts.mouthPivot;
      this.mouthBase.position.set(mp[0] + off[0] * k, mp[1] + off[1] * k);
    }

    // 张嘴叠加图（01 的独立张嘴 / 03、05 的圆形嘴洞）
    if (this.mouthOpenSprite) {
      const vis = clamp(open * 5, 0, 1);
      this.mouthOpenSprite.alpha = vis;
      this.mouthOpenSprite.scale.set(0.94 + 0.06 * open, 0.18 + 0.82 * open);
    }
    if (this.mouthOpenCover) this.mouthOpenCover.alpha = clamp(open * 5, 0, 1);
    // 原嘴是一整条闭合线时整层收掉，避免和张开的嘴同时出现（张嘴比嘴洞更快退场）
    if (this.mouthBase && m.hideBase) this.mouthBase.alpha = 1 - clamp(open * 8, 0, 1);

    if (this.dentMesh) this.dentMesh.alpha = clamp(open * (m.dentStrength ?? 1), 0, 1);
  }

  /** 元气皮肤：只把脸颊的局部往内收，下巴和下颌线保持不动 */
  private updateFaceWarp(open: number) {
    const w = this.opts.mouth?.warp;
    if (!w) return;
    const base = this.faceBase;
    const mesh = this.faceMesh;
    if (!base || !mesh) return;
    const v = mesh.vertices;
    if (!v || v.length !== base.length) return;

    if (open <= 0.0001) {
      v.set(base);
      if (this.dentMesh) {
        const dv = this.dentMesh.vertices;
        if (dv.length === v.length) dv.set(v);
      }
      return;
    }

    if (w.cheeks && w.cheeks.length) {
      this.applyCheekWarp(mesh, base, w.cheeks, open, w);
    } else {
      // 旧版：以嘴部为中心整体收（保留兼容）
      const cx = w.cx;
      const cy = w.cy;
      if (cx == null || cy == null) return;
      const k = w.k ?? 0.32;
      const rx = w.rx ?? 160;
      const ry = w.ry ?? 90;
      const top = w.top ?? 405;
      const bottom = w.bottom ?? 465;
      const lift = w.lift ?? 6;
      for (let i = 0; i < base.length; i += 2) {
        const x = base[i];
        const y = base[i + 1];
        const fade = smoothstep(top, bottom, y);
        if (fade <= 0) {
          v[i] = x;
          v[i + 1] = y;
          continue;
        }
        const ex = (x - cx) / rx;
        const ey = (y - cy) / ry;
        const wt = Math.exp(-(ex * ex + ey * ey) * 1.3) * fade;
        v[i] = x - (x - cx) * k * wt * open;
        v[i + 1] = y - (y - cy) * 0.09 * wt * open - lift * wt * open * smoothstep(490, 540, y);
      }
    }

    if (w.contour) this.applyContourCut(mesh, w.contour, open);

    if (this.dentMesh) {
      const dv = this.dentMesh.vertices;
      if (dv.length === v.length) dv.set(v);
    }
  }

  /**
   * 把轮廓曲线外侧（下巴/脸颊下方）的顶点平滑压到曲线上。
   * 二次贝塞尔曲线没有折角；两端权重渐隐，和原来的脸型自然接上。
   * 只动 face 网格，头发保持静止。
   */
  private applyContourCut(mesh: MeshSimple, c: ContourCutDef, open: number) {
    if (open <= 0) return;
    const v = mesh.vertices;
    if (!v) return;
    const band = c.band ?? 80;
    const xMin = c.xMin ?? -Infinity;
    const xMax = c.xMax ?? Infinity;
    const yMin = c.yMin ?? -Infinity;
    const yMax = c.yMax ?? Infinity;
    const steps = 64;
    const px: number[] = new Array(steps + 1);
    const py: number[] = new Array(steps + 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      px[s] = u * u * c.x1 + 2 * u * t * c.cx + t * t * c.x2;
      py[s] = u * u * c.y1 + 2 * u * t * c.cy + t * t * c.y2;
    }
    for (let i = 0; i < v.length; i += 2) {
      const x = v[i];
      const y = v[i + 1];
      if (x < xMin || x > xMax || y < yMin || y > yMax) continue;
      let best = Infinity;
      let bestDist = 0;
      let bestT = 0;
      let bestNx = 0;
      let bestNy = 0;
      for (let s = 0; s < steps; s++) {
        const ax = px[s];
        const ay = py[s];
        const bx = px[s + 1];
        const by = py[s + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) continue;
        const u = ((x - ax) * dx + (y - ay) * dy) / len2;
        const uc = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = ax + dx * uc;
        const qy = ay + dy * uc;
        const ddx = x - qx;
        const ddy = y - qy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < best) {
          const len = Math.sqrt(len2);
          const cross = dx * (y - ay) - dy * (x - ax);
          best = d2;
          bestDist = cross / len;
          bestT = (s + uc) / steps;
          bestNx = -dy / len;
          bestNy = dx / len;
        }
      }
      if (!Number.isFinite(best) || bestDist <= 0 || bestDist > band) continue;
      // 两端渐隐：曲线和原轮廓在端点交汇，避免出现新的棱角
      const blend = smoothstep(0, 0.12, bestT) * (1 - smoothstep(0.88, 1, bestT));
      if (blend <= 0) continue;
      const move = bestDist * open * blend;
      v[i] = x - bestNx * move;
      v[i + 1] = y - bestNy * move;
    }
  }

  /** 把一组局部脸颊位移应用到某个网格上 */
  private applyCheekWarp(
    mesh: MeshSimple | undefined,
    base: Float32Array | undefined,
    cheeks: CheekWarpDef[] | undefined,
    open: number,
    w: MouthWarpDef
  ) {
    if (!mesh || !base || !cheeks?.length) return;
    const v = mesh.vertices;
    if (!v || v.length !== base.length) return;
    const ft0 = w.fadeTop ?? 405;
    const ft1 = w.fadeTopEnd ?? 435;
    const fb0 = w.fadeBottom ?? 485;
    const fb1 = w.fadeBottomEnd ?? 518;
    for (let i = 0; i < base.length; i += 2) {
      const x = base[i];
      const y = base[i + 1];
      const ft = smoothstep(ft0, ft1, y);
      const fb = 1 - smoothstep(fb0, fb1, y);
      let dx = 0;
      let dy = 0;
      if (ft > 0 && fb > 0) {
        const fade = ft * fb;
        for (const c of cheeks) {
          const rx = c.rx ?? 50;
          const ry = c.ry ?? 50;
          const gx = (x - c.cx) / rx;
          const gy = (y - c.cy) / ry;
          const wt = Math.exp(-(gx * gx + gy * gy) * 1.3) * fade * open;
          dx += (c.dx ?? 0) * wt;
          dy += (c.dy ?? 0) * wt;
        }
      }
      v[i] = x + dx;
      v[i + 1] = y + dy;
    }
  }

  private update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;

    // ---- blink state machine ----
    if (this.blinkPhase === 'idle') {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlink) {
        this.blinkPhase = 'close';
        this.blinkTimer = 0;
      }
    } else {
      this.blinkTimer += dt;
      if (this.blinkPhase === 'close' && this.blinkTimer > 0.07) {
        this.blinkPhase = 'hold';
        this.blinkTimer = 0;
      } else if (this.blinkPhase === 'hold' && this.blinkTimer > 0.05) {
        this.blinkPhase = 'open';
        this.blinkTimer = 0;
      } else if (this.blinkPhase === 'open' && this.blinkTimer > 0.1) {
        this.blinkPhase = 'idle';
        this.blinkTimer = 0;
        this.nextBlink = 2.4 + Math.random() * 4.2;
      }
    }

    // ---- 摸摸：闭眼享受 + 轻晃 ----
    if (this.patTimer > 0) this.patTimer -= dt;
    const patting = this.patTimer > 0;

    const baseBlink = this.blinkPhase === 'close' || this.blinkPhase === 'hold' ? 1 : 0;
    const targetBlink = patting ? 1 : baseBlink;
    this.blinkValue = lerp(this.blinkValue, targetBlink, clamp(dt / (this.blinkPhase === 'open' ? 0.08 : 0.05), 0, 1));

    // ---- 光标停在头上：慢慢闭眼（停留 100ms 才生效，避免扫过就闭）----
    this.headHoverTimer = this.headHover ? this.headHoverTimer + dt : 0;
    const wantHoverClose = this.headHover && this.headHoverTimer > 0.1;
    this.hoverEye = lerp(this.hoverEye, wantHoverClose ? 1 : 0, clamp(dt / 0.16, 0, 1));
    const eyeClose = Math.max(this.blinkValue, this.hoverEye);

    // ---- talk ----
    if (this.talkEnvelope > 0) this.talkEnvelope -= dt;
    const speaking = this.talking || this.talkEnvelope > 0;

    // ---- tail ----
    if (this.tailWrap) {
      this.wagEnergy = Math.max(0, this.wagEnergy - dt * 0.9);
      const amp = this.opts.tailAmp ?? 0.18;
      const idle = Math.sin(this.t * 1.35) * amp * 0.3;
      this.tailShy = Math.max(0, this.tailShy - dt * 1.2);
      const wag = Math.sin(this.t * 9.5) * amp * this.wagEnergy * 1.9;
      // 被摸尾巴时尾巴往上翘一点
      this.tailWrap.rotation = idle + wag - this.tailShy * amp * 0.8;
      this.tailWrap.y = (this.opts.tailPivot?.[1] ?? 0) - this.tailShy * 6;
    }

    // ---- mouth：张嘴/闭嘴 ----
    if (this.mouthMode !== 'none') {
      // 原图张嘴的皮肤（02/04）静息就是张开的，说话时向下闭；其它皮肤静息闭嘴
      const idle = this.opts.mouth?.rest === 'open' ? 1 : 0;
      let pulse = idle;
      let driven = false;
      if (this.mouthDemo > 0) {
        this.mouthDemo = Math.max(0, this.mouthDemo - dt);
        const t = 1 - this.mouthDemo / this.mouthDemoTotal;
        const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 4);
        pulse = idle + (idle === 1 ? -1 : 1) * 0.92 * wave;
        driven = true;
      } else if (speaking) {
        // 持续说话时包络恒为 1；只有「说句话」的一次性演示才在结尾 0.18s 收掉
        const env = this.talking ? 1 : clamp(this.talkEnvelope / 0.18, 0, 1);
        const syl = Math.max(0, Math.sin(this.t * 13.0));
        const gap = 0.55 + 0.45 * Math.sin(this.t * 2.7 + 0.6);
        const speech = syl * gap;
        pulse = idle === 1 ? 1 - (1 - speech) * env * 0.92 : speech * env;
        driven = true;
      }
      if (this.mouthOverride != null) pulse = this.mouthOverride;
      const target = clamp(pulse, 0, 1);
      this.mouthOpen = lerp(this.mouthOpen, target, clamp(dt / (driven ? 0.055 : 0.12), 0, 1));
      this.applyMouth(this.mouthOpen);
    } else if (this.opts.mouthTalk) {
      // 旧版皮肤：没有 mouth 配置时只做轻微的嘴部缩放
      const env = this.talking ? 1 : Math.min(1, Math.max(0, this.talkEnvelope));
      const wobble = Math.sin(this.t * 13) * 0.5 + 0.5;
      this.mouthWrap.scale.set(1 + wobble * 0.12 * env, 1 + wobble * 0.32 * env);
      this.mouthWrap.y = this.opts.mouthPivot[1] + wobble * 1.6 * env;
    }

    // ---- gaze smoothing ----
    this.gaze.x = lerp(this.gaze.x, this.gazeTarget.x, clamp(dt * 8, 0, 1));
    this.gaze.y = lerp(this.gaze.y, this.gazeTarget.y, clamp(dt * 8, 0, 1));
    this.headTurn = lerp(this.headTurn, this.headTurnTarget, clamp(dt * 5, 0, 1));

    // ---- hop spring ----
    if (Math.abs(this.hop) > 0.01 || Math.abs(this.hopVel) > 0.01) {
      this.hopVel += -this.hop * 900 * dt - this.hopVel * 9 * dt;
      this.hop += this.hopVel * dt;
      if (Math.abs(this.hop) < 0.2 && Math.abs(this.hopVel) < 1) {
        this.hop = 0;
        this.hopVel = 0;
      }
    }

    // ---- jelly（挤压拉伸）----
    if (this.opts.jelly) {
      this.jellyVel += (-this.jelly * 260 - this.jellyVel * 12) * dt;
      this.jelly = Math.max(-0.35, Math.min(0.35, this.jelly + this.jellyVel * dt));
    }

    // ---- drag squash ----
    const squashTarget = this.dragging ? 1 : 0;
    this.squash = lerp(this.squash, squashTarget, clamp(dt * 10, 0, 1));

    // ---- body ----
    const m = this.opts.motion;
    const breath = Math.sin(this.t * 1.9);
    const sway = Math.sin(this.t * 0.62);
    const patBounce = patting ? Math.sin(this.t * 9) * 2.2 : 0;
    this.body.scale.y = 1 + breath * m.breath - this.squash * 0.075;
    this.body.scale.x = 1 - breath * (m.breath * 0.36) + this.squash * 0.06;
    if (this.opts.jelly) {
      this.body.scale.y *= 1 + this.jelly;
      this.body.scale.x *= 1 - this.jelly * 0.55;
    }
    this.body.rotation =
      sway * m.sway + this.squash * 0.02 + (patting ? Math.sin(this.t * 7) * 0.006 : 0);
    this.body.y = this.manifest.canvas.h + breath * 1.6 - this.hop - patBounce;

    this.backHair.rotation = -sway * 0.012 - this.headTurn * 0.004;

    // ---- head ----
    const patSway = patting ? Math.sin(this.t * 6.2) * 5 : 0;
    this.head.x = this.opts.headPivot[0] + this.headTurn * m.headTurn + patSway;
    this.head.y =
      this.opts.headPivot[1] + this.gaze.y * -2.5 + (speaking ? Math.sin(this.t * 7.5) * 1.6 : 0);
    this.head.rotation =
      this.headTurn * this.opts.headTilt + (speaking ? Math.sin(this.t * 3.2) * 0.004 : 0) + (patting ? -0.02 : 0);

    // ---- eyes ----
    const ix = this.gaze.x * m.gazeMax[0];
    const iy = this.gaze.y * m.gazeMax[1];
    for (const side of ['l', 'r'] as const) {
      const eye = this.eyes[side];
      const open = 1 - eyeClose;
      if (eye.white) eye.white.alpha = open;
      if (eye.iris) {
        eye.iris.alpha = open;
        eye.iris.x = ix;
        eye.iris.y = iy;
      }
      if (eye.lash) {
        const bl = this.opts.blinkLash;
        const off: [number, number] =
          typeof bl === 'number' ? [0, bl] : (side === 'l' ? bl.l : bl.r);
        eye.lash.x = ix * 0.25 + eyeClose * off[0];
        eye.lash.y = eyeClose * off[1];
      }
    }
    for (const brow of this.brows) {
      brow.y = -this.blinkValue * 1.5 + this.gaze.y * -1.2;
    }
  }
}
