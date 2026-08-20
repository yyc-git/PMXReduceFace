// demo/main.ts — PMXReduceFace 静态 LOD 展示 Demo（多模型：XiaoMei / Xiaye1 / XiaHui）
// three MMDLoader 加载原版 PMX + 预生成 LOD 减面版，OrbitControls 旋转/缩放，
// HUD 实时显示当前 LOD 的顶点数/三角形数/材质数/减面率；stats.json（prepare-demo 生成）作为统计来源，
// 缺失时回退到页面内实时解析的 mesh 几何统计。
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';

// 资源基目录：webpack dev-server 把 demo/assets 静态托管到 /assets（pmx 与 tex/ 同目录，纹理相对路径自动解析）
const ASSET_BASE = '/assets/';

// 模型注册表：key（curModelKey，与 stats.json 的 models[].model 对齐）/ label / baseDir / fileName（不带 .pmx）
const MODELS: Array<{ key: string; label: string; baseDir: string; fileName: string }> = [
  { key: 'XiaoMei', label: 'XiaoMei (孙晓美)', baseDir: '', fileName: 'XiaoMeiOriginFix_02_elrein' },
  { key: 'Xiaye1', label: 'Xiaye1 (夏夜1)', baseDir: 'Xiaye1/', fileName: 'Tda HMS illustrious Prom Dress Ver1.00 [Silver]' },
  { key: 'XiaHui', label: 'XiaHui (夏卉)', baseDir: 'XiaHui/', fileName: 'TDA Utage CORAL COAST' },
];

// LOD 档位定义（与 scripts/prepare-demo.mjs 生成的 stats.json 对齐：name → 文件名后缀）
const LOD_DEFS: Array<{ name: string; label: string; suffix: string }> = [
  { name: 'LOD_100', label: 'LOD 100%', suffix: 'LOD100' },
  { name: 'LOD_70', label: 'LOD 70%', suffix: 'LOD70' },
  { name: 'LOD_55', label: 'LOD 55%', suffix: 'LOD55' },
  { name: 'LOD_50', label: 'LOD 50%', suffix: 'LOD50' },
];

// 每个模型的 LOD 文件列表（<fileName>.<suffix>.pmx）
const MODEL_LODS_MAP: Map<string, Array<{ name: string; file: string }>> = new Map();
for (const m of MODELS) {
  MODEL_LODS_MAP.set(
    m.key,
    LOD_DEFS.map((lod) => ({ name: lod.name, file: `${m.fileName}.${lod.suffix}.pmx` })),
  );
}

interface PerMaterialStat {
  index: number;
  name: string;
  origTri: number;
  newTri: number;
}
interface LodStat {
  name: string;
  label: string;
  file: string;
  targetRatio: number;
  vertices: number;
  triangles: number;
  targetTriangles: number;
  materials: number;
  reductionRatio: number;
  reductionMet: boolean;
  perMaterial: PerMaterialStat[];
}
interface ModelStats {
  model: string;
  file: string;
  baseDir: string;
  original: { vertices: number; triangles: number; materials: number };
  lods: LodStat[];
}
interface StatsJson {
  models: ModelStats[];
}

// ---------- DOM ----------
const container = document.getElementById('container') as HTMLElement;
const hudBody = document.getElementById('hud-body') as HTMLElement;
const msg = document.getElementById('msg') as HTMLElement;
const lodButtonsEl = document.getElementById('lod-buttons') as HTMLElement;
const modelButtonsEl = document.getElementById('model-buttons') as HTMLElement;

// ---------- 渲染场景 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3d4d);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 20, 60);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 15, 0);
controls.enableDamping = true;
controls.update();

// 灯光（MMD 卡通材质需要）
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(50, 100, 80);
scene.add(dirLight);
const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
dirLight2.position.set(-50, 60, -60);
scene.add(dirLight2);

// 地面参考网格
const grid = new THREE.GridHelper(120, 12, 0x888888, 0x555555);
grid.position.y = -0.01;
scene.add(grid);

// ---------- 模型 + LOD ----------
const loader = new MMDLoader();
let mesh: THREE.SkinnedMesh | null = null;
let stats: StatsJson | null = null;
let curModelKey = 'XiaoMei'; // 默认展示 XiaoMei（兼容现有 demo 行为）
let curName: string | null = null;
let loadId = 0;
let framed = false;
const activeButtons = new Map<string, HTMLButtonElement>();
const modelActiveButtons = new Map<string, HTMLButtonElement>();

function curModelStats(): ModelStats | null {
  if (!stats) return null;
  return stats.models.find((m) => m.model === curModelKey) ?? null;
}

function disposeMesh(m: THREE.SkinnedMesh): void {
  m.geometry.dispose();
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  for (const mat of mats) {
    if (!mat) continue;
    // MMD 材质持有若干纹理（map / specular / emissive ...），逐个释放
    for (const v of Object.values(mat)) {
      if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) {
        (v as { dispose: () => void }).dispose();
      }
    }
    mat.dispose();
  }
}

// 首次加载后把相机对准模型包围盒（MMD 模型高度各不相同）
function frameModel(m: THREE.SkinnedMesh): void {
  const box = new THREE.Box3().setFromObject(m);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dist = Math.max(size.x, size.y, size.z) * 1.7;
  controls.target.copy(center);
  camera.position.set(center.x + dist * 0.8, center.y + dist * 0.6, center.z + dist);
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();
  // 诊断模式：?shot=xxx 时相机直接对准小手指（小手指指尖约 ±9.3, y≈14.3）
  const shot = new URLSearchParams(window.location.search).get('shot');
  if (shot) {
    const shots: Record<string, { pos: [number, number, number]; tgt: [number, number, number] }> = {
      // 右手：指尖外侧平视（正对指尖末端）
      r1: { pos: [12.6, 14.3, 0.35], tgt: [9.3, 14.3, 0.35] },
      // 右手：指尖侧面（z+ 方向看）
      r2: { pos: [9.3, 14.3, 4.5], tgt: [9.3, 14.3, 0.35] },
      // 右手：侧上方俯瞰
      r3: { pos: [11.2, 17.2, 2.2], tgt: [9.3, 14.3, 0.35] },
      // 右手：指尖末端正视（x 正方向看）
      r4: { pos: [13.8, 14.8, 0.35], tgt: [9.3, 14.3, 0.35] },
      // 左手：指尖外侧平视
      l1: { pos: [-12.6, 14.3, 0.35], tgt: [-9.3, 14.3, 0.35] },
      // 左手：指尖侧面（z+ 方向看）
      l2: { pos: [-9.3, 14.3, 4.5], tgt: [-9.3, 14.3, 0.35] },
      // 左手：侧上方俯瞰
      l3: { pos: [-11.2, 17.2, 2.2], tgt: [-9.3, 14.3, 0.35] },
      // 左手：指尖末端正视
      l4: { pos: [-13.8, 14.8, 0.35], tgt: [-9.3, 14.3, 0.35] },
    };
    const s = shots[shot];
    if (s) {
      controls.target.set(...s.tgt);
      camera.position.set(...s.pos);
      camera.near = 0.01;
      camera.far = 500;
      camera.updateProjectionMatrix();
      controls.update();
    }
  }
}

// 实时统计（mesh 几何为准，stats.json 缺失时也能显示）
function liveStats(): { vertices: number; triangles: number; materials: number } {
  const pos = mesh!.geometry.attributes.position;
  const idx = mesh!.geometry.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const matCount = Array.isArray(mesh!.material) ? mesh!.material.length : 1;
  return { vertices: pos.count, triangles: Math.round(tri), materials: matCount };
}

function updateHud(): void {
  if (!mesh) return;
  const live = liveStats();
  const modelStats = curModelStats();
  const origTri = modelStats ? modelStats.original.triangles : live.triangles;
  const reduction = ((1 - live.triangles / origTri) * 100).toFixed(2);
  const lodStat = modelStats ? modelStats.lods.find((l) => l.name === curName) : null;
  // 减面未达目标（--target-tri 低于保护下限 / 减面率已被 min-retention 与小材质锁定卡住）
  const floorNote =
    lodStat && !lodStat.reductionMet
      ? '<div class="warn">⚠ 已到保护下限（min-retention / 小材质锁定），三角数未达目标</div>'
      : '';
  const targetLine = lodStat
    ? `<div class="dim">目标三角数：${lodStat.targetTriangles.toLocaleString()} · 材质明细 ${
        lodStat.perMaterial.length
      } 项</div>`
    : '';
  const modelLabel = MODELS.find((m) => m.key === curModelKey)?.label ?? curModelKey;
  hudBody.innerHTML = [
    `<div>当前模型：<b>${modelLabel}</b></div>`,
    `<div>当前 LOD：<b>${curName ?? '—'}</b></div>`,
    `<div>顶点数：${live.vertices.toLocaleString()}</div>`,
    `<div>三角形数：${live.triangles.toLocaleString()}（原版 ${origTri.toLocaleString()}）</div>`,
    `<div>材质数：${live.materials}</div>`,
    `<div>减面率：${reduction}%</div>`,
    targetLine,
    floorNote,
  ].filter(Boolean).join('');
}

function loadLod(name: string): void {
  const def = MODEL_LODS_MAP.get(curModelKey)?.find((l) => l.name === name);
  if (!def || name === curName) return;
  const model = MODELS.find((m) => m.key === curModelKey)!;
  msg.textContent = `加载 ${name}…`;
  // 加载令牌：快速连点时只保留最后一次请求（后完成/后发出的回调忽略，避免竞态覆盖）
  const id = ++loadId;
  const url = ASSET_BASE + model.baseDir + def.file;
  loader.load(
    url,
    (m: THREE.SkinnedMesh) => {
      if (id !== loadId) {
        disposeMesh(m); // 过期的在途加载：释放其资源，不替换当前 mesh
        return;
      }
      if (mesh) {
        scene.remove(mesh);
        disposeMesh(mesh);
      }
      mesh = m;
      scene.add(mesh);
      curName = name;
      // [TEMP-TEST] ?wire=1 线框调试：看网格拓扑（洞/缺口）
      if (new URLSearchParams(window.location.search).has('wire')) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) if (mat && 'wireframe' in mat) (mat as { wireframe?: boolean }).wireframe = true;
      }
      if (!framed) {
        frameModel(m);
        framed = true;
      }
      for (const [k, btn] of activeButtons) btn.classList.toggle('active', k === name);
      msg.textContent = '';
      updateHud();
    },
    undefined,
    (e: unknown) => {
      if (id !== loadId) return;
      msg.textContent = `加载失败: ${e && (e as { message?: string }).message ? (e as { message: string }).message : String(e)}`;
    },
  );
}

// ---------- 模型切换（#model-buttons）----------
// 模型切换 → 当前 LOD 状态清空 → 重新加载默认 LOD_100
function loadModel(key: string): void {
  if (key === curModelKey) return;
  curModelKey = key;
  curName = null;
  framed = false;
  for (const btn of activeButtons.values()) btn.classList.toggle('active', false);
  for (const [k, btn] of modelActiveButtons) btn.classList.toggle('active', k === key);
  loadLod('LOD_100');
}

// ---------- 控制条 ----------
for (const m of MODELS) {
  const btn = document.createElement('button');
  btn.textContent = m.label;
  btn.onclick = () => loadModel(m.key);
  modelActiveButtons.set(m.key, btn);
  modelButtonsEl.appendChild(btn);
}
modelActiveButtons.get('XiaoMei')?.classList.add('active');

for (const lod of LOD_DEFS) {
  const btn = document.createElement('button');
  btn.textContent = lod.name;
  btn.onclick = () => loadLod(lod.name);
  activeButtons.set(lod.name, btn);
  lodButtonsEl.appendChild(btn);
}

// ---------- 启动：读取 stats.json（失败不阻塞），默认展示 LOD_100（原版） ----------
function boot(): void {
  fetch(ASSET_BASE + 'stats.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('stats.json HTTP ' + r.status))))
    .then((j: StatsJson) => {
      stats = j;
    })
    .catch(() => {
      stats = null;
    })
    .finally(() => {
      // 诊断模式：?lod=LOD_70 等可指定初始 LOD
      const lodParam = new URLSearchParams(window.location.search).get('lod');
      const allLodNames = [...MODEL_LODS_MAP.values()].flat().map((l) => l.name);
      const initial = lodParam && allLodNames.includes(lodParam) ? lodParam : 'LOD_100';
      loadLod(initial);
    });
}
boot();

// ---------- 主循环 ----------
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
