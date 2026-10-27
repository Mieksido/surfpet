import { PetRig, type Manifest, type Region } from './rig';

const DRAG_THRESHOLD = 4;
const STROKE_WINDOW = 700;
const STROKE_TRIGGER = 240;
const PAT_COOLDOWN = 1600;

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('preview')) document.body.classList.add('preview');

  const skin = await window.pet.getSkin();
  const rig = new PetRig(skin.manifest as Manifest, skin.baseUrl);
  // 以主进程当前的缩放为准（每套皮肤画布尺寸不同）
  if (typeof skin.scale === 'number') rig.scale = skin.scale;
  await rig.init(document.body);

  // 把图层合成出来的命中遮罩交给主进程（新皮肤不需要自带 mask.png）
  const mask = rig.buildMask();
  if (mask) window.pet.setMask(mask);

  let pressed = false;
  let dragging = false;
  let moved = false;
  let downAt = { x: 0, y: 0 };
  let downRegion: Region | null = null;
  let last = { x: 0, y: 0 };
  let strokeAccum = 0;
  let strokeStart = 0;
  let lastPatAt = 0;

  document.body.style.cursor = '';
  const setCursor = (c: string) => {
    document.body.style.cursor = c;
  };

  window.addEventListener('pointermove', (e) => {
    rig.setPointer(e.clientX, e.clientY);
    const now = performance.now();
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };

    if (pressed && !dragging) {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD) {
        dragging = true;
        moved = true;
        rig.setDragging(true);
        setCursor('grabbing');
        window.pet.dragStart();
      }
    }

    if (dragging) return;

    const hit = rig.hitTest(e.clientX, e.clientY);
    if (!hit) {
      setCursor('');
      strokeAccum = 0;
      rig.setHeadHover(false);
      return;
    }

    setCursor(rig.cursorAt(e.clientX, e.clientY) ?? 'pointer');

    // 摸摸：在「pat」区域上来回蹭，累计位移够了就触发
    const region = rig.regionAt(e.clientX, e.clientY);
    rig.setHeadHover(rig.regionHoverClosesEyes(region));
    if (region?.gesture === 'pat') {
      if (now - strokeStart > STROKE_WINDOW) {
        strokeAccum = 0;
        strokeStart = now;
      }
      strokeAccum += Math.abs(dx) + Math.abs(dy);
      if (strokeAccum > STROKE_TRIGGER && now - lastPatAt > PAT_COOLDOWN) {
        lastPatAt = now;
        strokeAccum = 0;
        rig.playCommand('pat');
      }
    } else {
      strokeAccum = 0;
    }
  });

  window.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!rig.hitTest(e.clientX, e.clientY)) return;
    // 关键：拖动时主进程会一直移动窗口，鼠标很容易"跑到窗口外"，
    // 那样 pointerup 就收不到 → 拖拽永远不结束（她会一直跟着鼠标"自己动"）。
    // 捕获指针后，即使鼠标离开窗口也会把 pointerup 送回这里。
    try { document.body.setPointerCapture(e.pointerId); } catch {}
    pressed = true;
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    last = { x: e.clientX, y: e.clientY };
    downRegion = rig.regionAt(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    try { document.body.releasePointerCapture(e.pointerId); } catch {}
    if (!pressed) return;
    pressed = false;
    if (dragging) {
      dragging = false;
      rig.setDragging(false);
      window.pet.dragEnd();
      setCursor(rig.cursorAt(last.x, last.y) ?? '');
    } else if (!moved) {
      // 左键点她：按命中区域的手势走（头=摸摸、尾巴=摸尾巴、其它=戳一下）
      // 区域配了音效就同时响（例如硬气皮肤的钢盆「邦」）
      if (downRegion?.sound) rig.playSound(downRegion.sound);
      rig.playCommand(downRegion?.gesture ?? 'poke');
    }
    downRegion = null;
  });

  window.addEventListener('pointercancel', (e) => {
    try { document.body.releasePointerCapture(e.pointerId); } catch {}
    if (dragging) {
      dragging = false;
      rig.setDragging(false);
      window.pet.dragEnd();
    }
    pressed = false;
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (rig.hitTest(e.clientX, e.clientY)) window.pet.openMenu();
  });

  // 主进程判定「指针不在她身上」时会切回穿透，这里同步收拾状态
  const forceEndDrag = () => {
    if (!dragging) return;
    dragging = false;
    pressed = false;
    rig.setDragging(false);
    window.pet.dragEnd();
  };
  window.addEventListener('blur', forceEndDrag);
  window.pet.onInputMode((interactive) => {
    if (!interactive) forceEndDrag();
    if (interactive) return;
    setCursor('');
    strokeAccum = 0;
    rig.setHeadHover(false);
  });

  window.pet.onScale((scale) => rig.setScale(scale));

  window.pet.onCommand((cmd) => rig.playCommand(cmd));

  (window as any).__rig = rig;
  (window as any).__skin = skin.manifest;
  window.pet.log(`skin loaded: ${skin.manifest.name} (${skin.manifest.layers.length} layers)`);
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#fff;font:12px monospace;padding:12px">load failed:\n${String(err)}</pre>`;
});
