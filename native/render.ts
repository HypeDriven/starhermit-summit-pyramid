// The desert-night tableau on starhermit:scene, as the browser build's
// app/render3d.js drew it with three.js r169: the sand floor (ripple texture
// and bump when detailed), dunes, the sky dome with its moon-side glow (or a
// horizon band), the star canopy (twinkling when animated), the moon and its
// halo, the campfire (stones, logs and flickering flames when detailed) with
// its point light, embers and drifting sand motes, the 28-card pyramid
// leaning toward the camera, the stock (face down) and the waste top, the
// selection lift and the pulsing marker ring, the pair sparks and the
// removal flight. The menu hero looks out over the dunes toward the moon.
// Graphics follow the runtime's quality tier (native/quality.ts: gfx.js's
// presets and budgets) and the colour-vision palette option.
//
// Engine minor 23 is three.js r185's light units and shadows, so r169's
// physically based intensities and the key light's shadow (its camera box,
// bias, normal bias and radius) are the page's own values. Reflections are
// set up as the page did: RoomEnvironment(renderer) (r163+, the 900-candela
// room) prefiltered with sigma 0.04 as scene.environment at
// environmentIntensity 0.24. The composer (half floats → GTAO → bloom →
// OutputPass with ACES at 1.4 → the colour grade + vignette in display
// space → SMAA / FXAA) is the runtime's renderer.ao / bloom / grade /
// antialias. ShaderMaterials are WGSL: the sky dome, and the stars and
// particles (Points with per-point size, colour and alpha) as camera-facing
// instanced quads. The old canvas sat between the top bar and the tray; the
// camera spans the window and its view offset frames the board in that
// rectangle, as resize() did with setViewOffset.
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DodecahedronGeometry, DoubleSide, ExtrudeGeometry, Fog, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Points, PointsMaterial, Raycaster,
  RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, ShaderMaterial, Shape, SphereGeometry, TextureLoader,
  Vector2, Vector3, Vector4, BufferAttribute, BufferGeometry, pointerToNdc, renderer, scene,
  type BufferGeometry as Geo, type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, fonts, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import type { CardRef, State, Theme } from "./game.ts";
import { particleCount, starCount, type Look } from "./quality.ts";

export interface Rect { x: number; y: number; width: number; height: number }

const CARD_W = 1, CARD_H = 1.42, CARD_T = 0.03;
const CARD_TILT = 0.42;
// lift so the tilted bottom row's near edge clears the sand
const CARD_LIFT = Math.sin(CARD_TILT) * CARD_H / 2 + 0.03;
const ROW_GAP = 1.06, COL_GAP = 1.06;
const CAM_HOME = { pos: [0, 10.6, 10.4], look: [0, 0, 2.1] };
const CAM_MENU = { pos: [0.6, 2.6, 15.5], look: [7.4, 4.6, -24] };
const PLAY_CENTER: [number, number, number] = [-0.4, 0, 3.0], PLAY_RADIUS = 6.2;
const FIRE_POS = [4.5, 0, 5.5] as const;
const SPARK_SLOTS = 72;
const FIRE_LIGHT = 5.5;
const STOCK_POS = [-4.25, 0.06, 5.6] as const, WASTE_POS = [-2.95, 0.06, 5.6] as const;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SUIT_GLYPH = ["♣", "♦", "♥", "♠"];
const RANK_LABEL = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const hex = (c: Color): string => "#" + c.getHex().toString(16).padStart(6, "0");

// ---------------------------------------------------------------- shaders (WGSL ports of render3d.js's GLSL)
/** SKY_FRAG: fog-matched horizon rising into the theme sky, with a moon-side glow. */
const SKY_FRAG = /* wgsl */ `
fn fragment(f: Fragment) -> vec4f {
  let d = normalize(f.world);
  let h = d.y;
  var c = mix(uniforms.uHorizon, uniforms.uSky, smoothstep(0.0, 0.45, h));
  c = mix(c, uniforms.uGround, 1.0 - smoothstep(-0.08, 0.0, h));
  let m = max(dot(d, uniforms.uMoonDir), 0.0);
  c = c + vec3f(0.14, 0.16, 0.22) * pow(m, 32.0) + vec3f(0.03, 0.035, 0.055) * pow(m, 6.0);
  return vec4f(c, 1.0);
}`;
/**
 * STAR_VERT/STAR_FRAG: gl_PointSize = aSize × pixel ratio (CSS pixels, not attenuated); quads of that size
 * turned to the screen. instanceCustom slot 0 = (size, phase); the instance colour its HDR colour.
 */
const STAR_VERT = /* wgsl */ `
fn vertex(v: Vertex) -> Vertex {
  var o = v;
  let c = model_matrix() * vec4f(0.0, 0.0, 0.0, 1.0);
  var clip = view_projection() * c;
  clip = vec4f(clip.xy + v.position.xy * v.instance.x * 2.0 / uniforms.uLogical * clip.w, clip.z, clip.w);
  o.clip = clip;
  o.v0 = vec4f(v.position.x, v.position.y, v.instance.y, 0.0);
  o.v1 = v.instance_color;
  return o;
}`;
const STAR_FRAG = /* wgsl */ `
fn fragment(f: Fragment) -> vec4f {
  let tw = 0.72 + 0.28 * sin(uniforms.uTime * (0.8 + f.v0.z * 0.9) + f.v0.z * 40.0);
  let a = 1.0 - smoothstep(0.0, 0.5, length(f.v0.xy));
  return vec4f(f.v1.rgb * tw * a, a);
}`;
/**
 * FX_VERT/FX_FRAG (embers, sand motes, pair sparks): gl_PointSize = aSize × pixel ratio × 120 / view depth.
 * instanceCustom slot 0 = (world x, y, z, size), slot 1 = (alpha); the instance colour its colour.
 */
const FX_VERT = /* wgsl */ `
fn vertex(v: Vertex) -> Vertex {
  var o = v;
  let w = vec4f(v.instance.xyz, 1.0);
  var clip = view_projection() * w;
  let px = v.instance.w * 120.0 / max(1.0, view_depth(w.xyz));
  clip = vec4f(clip.xy + v.position.xy * px * 2.0 / uniforms.uLogical * clip.w, clip.z, clip.w);
  o.clip = clip;
  o.v0 = vec4f(v.position.x, v.position.y, v.instance1.x, 0.0);
  o.v1 = v.instance_color;
  return o;
}`;
const FX_FRAG = /* wgsl */ `
fn fragment(f: Fragment) -> vec4f {
  let a = (1.0 - smoothstep(0.05, 0.5, length(f.v0.xy))) * f.v0.z;
  if (a < 0.01) { discard; }
  return vec4f(f.v1.rgb * a, a);
}`;
const logical = new Vector2(1280, 800);

// ---------------------------------------------------------------- canvases (render3d.js, unchanged drawing)
type Ctx = OffscreenCanvasRenderingContext2D;
function canvas(w: number, h: number): { c: OffscreenCanvas; g: Ctx } {
  const c = new OffscreenCanvas(w, h);
  return { c, g: c.getContext("2d")! as Ctx };
}
function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const SERIF = "serif", SANS = "sans-serif";
let fontsReady = false;
void Promise.all([fonts.load(`bold 76px ${SERIF}`, "A2345678910JQK"), fonts.load(`96px ${SANS}`, SUIT_GLYPH.join(""))])
  .then(() => { fontsReady = true; }, () => { fontsReady = true; });

function cardCanvas(card: number, cvd: string, hi: boolean, px: number): OffscreenCanvas {
  const red = card >= 13 && card < 39;
  let color = red ? "#b02020" : "#1c1c2a";
  if (cvd === "deuter") color = red ? "#0072b2" : "#1c1c2a";
  if (cvd === "tritan") color = red ? "#d55e00" : "#1c1c2a";
  const rank = RANK_LABEL[card % 13]!, suit = SUIT_GLYPH[Math.floor(card / 13)]!;
  if (!hi) {
    const { c, g } = canvas(128, 180);
    g.fillStyle = "#f4f0e4"; g.fillRect(0, 0, 128, 180);
    g.strokeStyle = "#8a8578"; g.lineWidth = 4; g.strokeRect(3, 3, 122, 174);
    g.fillStyle = color;
    g.font = `bold 34px ${SANS}`;
    g.textAlign = "center";
    g.fillText(rank, 64, 70);
    g.font = `44px ${SANS}`;
    g.fillText(suit, 64, 130);
    g.font = `bold 18px ${SANS}`;
    g.textAlign = "left"; g.fillText(rank, 10, 26);
    return c;
  }
  const W = 256, H = 364; // authored size, drawn into the preset's card-texture budget
  const { c, g } = canvas(px, Math.round(H * px / W));
  g.scale(px / W, px / W);
  // warm paper with a soft centre light and fine grain
  const bg = g.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H / 2, H * 0.7);
  bg.addColorStop(0, "#fbf8ee"); bg.addColorStop(1, "#ebe4d2");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const rnd = mulberry(card * 131 + 7);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() < 0.5 ? "rgba(120,100,70,0.05)" : "rgba(255,255,255,0.08)";
    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
  }
  // inset frame
  g.strokeStyle = "rgba(120,110,90,0.55)"; g.lineWidth = 2;
  roundRect(g, 14, 14, W - 28, H - 28, 14); g.stroke();
  g.fillStyle = color;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.font = `bold 76px ${SERIF}`;
  g.fillText(rank, W / 2, 150);
  g.font = `96px ${SANS}`;
  g.fillText(suit, W / 2, 262);
  // corner indices (top-left, and rotated bottom-right)
  const corner = (): void => {
    g.textAlign = "center";
    g.font = `bold 36px ${SERIF}`; g.fillText(rank, 38, 52);
    g.font = `30px ${SANS}`; g.fillText(suit, 38, 84);
  };
  corner();
  g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
  return c;
}
function backCanvas(theme: Theme, hi: boolean, px: number): OffscreenCanvas {
  const acc = hex(new Color(theme.accent));
  if (!hi) {
    const { c, g } = canvas(128, 180);
    g.fillStyle = hex(new Color(theme.cardBack)); g.fillRect(0, 0, 128, 180);
    g.strokeStyle = acc; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { // original peak motif
      g.beginPath();
      g.moveTo(14, 160 - i * 30); g.lineTo(64, 132 - i * 30); g.lineTo(114, 160 - i * 30);
      g.stroke();
    }
    return c;
  }
  const W = 256, H = 364;
  const { c, g } = canvas(px, Math.round(H * px / W));
  g.scale(px / W, px / W);
  const base = new Color(theme.cardBack);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, hex(base.clone().multiplyScalar(1.25))); bg.addColorStop(1, hex(base.clone().multiplyScalar(0.7)));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = acc; g.lineWidth = 3;
  roundRect(g, 12, 12, W - 24, H - 24, 14); g.stroke();
  g.lineWidth = 5;
  for (let i = 0; i < 5; i++) { // peak motif, layered like far ridges
    g.globalAlpha = 0.45 + i * 0.12;
    g.beginPath();
    g.moveTo(34, 320 - i * 52); g.lineTo(W / 2, 266 - i * 52); g.lineTo(W - 34, 320 - i * 52);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = acc;
  g.beginPath(); g.arc(W / 2, 46, 11, 0, Math.PI * 2); g.fill(); // summit star
  return c;
}
function glowCanvas(): OffscreenCanvas {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}

// ---------------------------------------------------------------- the scene
const camera = new PerspectiveCamera(42, 1, 0.1, 220);
const raycaster = new Raycaster();
const ndc = new Vector2();
const gameplay = new Group(); // raycast layer: gameplay only
const envGroup = new Group();
scene.add(gameplay, envGroup);

// moon key, hemisphere fill, campfire accent (r169 physically based intensities, kept at minor 23)
const key = new DirectionalLight(0xbfd0ff, 1.0);
key.position.set(PLAY_CENTER[0] - 7, 12, PLAY_CENTER[2] + 4.5);
key.target.position.set(...PLAY_CENTER);
scene.add(key.target);
key.castShadow = false;
{ // shadow box fitted tightly around the pyramid, stock and waste
  const sc = key.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  sc.left = -PLAY_RADIUS; sc.right = PLAY_RADIUS; sc.top = PLAY_RADIUS; sc.bottom = -PLAY_RADIUS;
  sc.near = 2; sc.far = 32;
  sc.updateProjectionMatrix();
}
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
key.shadow.mapSize = 1024;
scene.add(key);
const fill = new HemisphereLight(0x3a4a78, 0x2a1d12, 0.62);
scene.add(fill);
const accentLight = new PointLight(0xffb35c, FIRE_LIGHT, 11, 1.6);
accentLight.position.set(FIRE_POS[0], 1.2, FIRE_POS[2]);
scene.add(accentLight);
renderer.shadowMap.type = PCFSoftShadowMap;

let look: Look | null = null;
let theme: Theme | null = null;
let envSeed = 1;
let cvd = "default";
let reduced = false;
let menu = false;
let time = 0;
let envTex: Texture | null = null;
let flames: Mesh[] = [];
let starMat: ShaderMaterial | null = null;
let stars: Object3D | null = null;
let envDisposables: { dispose(): void }[] = [];

function envTexture(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${String(e)}`); }
  }
  return envTex;
}
function applyEnvironment(): void {
  if (look?.reflections) {
    scene.environment = envTexture();
    scene.environmentIntensity = 0.24; // a moonlit night: reflections, not daylight
  } else scene.environment = null;
}

interface MatParams {
  color?: number | Color; map?: Texture | null; bumpMap?: Texture | null; bumpScale?: number; roughness?: number; metalness?: number;
  envMapIntensity?: number; emissive?: number; emissiveIntensity?: number; flatShading?: boolean;
}
/** render3d.js _mat: Lambert (Low), Standard (Balanced) or, for surfaces given a clear coat, Physical (High, Ultra). */
function mat(params: MatParams, coat?: { clearcoat: number; clearcoatRoughness: number }): Material {
  const tier = look!.budget.material;
  const p = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)) as MatParams;
  if (tier === "lambert") {
    const { roughness: _r, metalness: _m, envMapIntensity: _e, bumpMap: _b, bumpScale: _s, ...rest } = p;
    return new MeshLambertMaterial(rest);
  }
  if (coat && tier === "physical") return new MeshPhysicalMaterial({ ...p, ...coat });
  return new MeshStandardMaterial(p);
}
const seg = (n: number, min = 6): number => Math.max(min, Math.round(n * look!.budget.seg));

// textures: sand ripples baked offline (tools/bake-sand.mjs: render3d.js _sandTexture's per-pixel loop), cards and backs on canvases
const texCache = new Map<string, Texture>();
function sandTexture(): Texture {
  const n = look!.budget.sand, k = `sand:${n}`;
  let t = texCache.get(k);
  if (!t) {
    t = new TextureLoader().load(`assets/sand-${n}.png`);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(34, 22);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(k, t);
  }
  return t;
}
function glowTexture(): Texture {
  let t = texCache.get("glow");
  if (!t) { t = new CanvasTexture(glowCanvas()); texCache.set("glow", t); }
  return t;
}
/** Card faces cached by card, palette and budget (the rest evicted, oldest first, past CARD_CACHE). */
const CARD_CACHE = 64;
function cardTexture(card: number): Texture {
  const hi = look!.detailed, px = look!.budget.card;
  const k = `c${card}:${cvd}${hi ? ":hi" + px : ""}`;
  let t = texCache.get(k);
  if (t) { texCache.delete(k); texCache.set(k, t); return t; }
  t = new CanvasTexture(cardCanvas(card, cvd, hi, px));
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = hi ? 8 : 4;
  texCache.set(k, t);
  const faces = [...texCache.keys()].filter((x) => x.startsWith("c"));
  if (faces.length > CARD_CACHE) {
    const inUse = new Set(liveFaces());
    for (const f of faces) {
      if (faces.length - (CARD_CACHE - 8) <= 0) break;
      if (inUse.has(f) || f === k) continue;
      texCache.get(f)!.dispose(); texCache.delete(f);
      faces.splice(faces.indexOf(f), 1);
    }
  }
  return t;
}
function liveFaces(): string[] { return [...cardMeshes, wasteMesh].filter((m): m is Mesh => !!m).map((m) => String(m.userData.faceKey)); }
function backTexture(): Texture {
  const hi = look!.detailed, px = look!.budget.card;
  const k = `back:${theme!.id}${hi ? ":hi" + px : ""}`;
  let t = texCache.get(k);
  if (!t) {
    t = new CanvasTexture(backCanvas(theme!, hi, px));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = hi ? 8 : 4;
    texCache.set(k, t);
  }
  return t;
}

// ---------------------------------------------------------------- environment
function clearGroup(g: Group): void {
  for (const c of [...g.children]) g.remove(c);
}
/** render3d.js buildEnv: sky, sand, dunes, moon, stars, campfire, particles for a theme and seed. */
export function buildEnv(th: Theme, seed: number): void {
  theme = th;
  envSeed = seed;
  if (!look) return;
  for (const d of envDisposables) d.dispose();
  envDisposables = [];
  const track = <T extends { dispose(): void }>(o: T): T => { envDisposables.push(o); return o; };
  clearGroup(envGroup);
  stars = null; starMat = null; fx = null; flames = [];
  const q = look;
  const detailed = q.detailed;
  const rnd = mulberry((seed || 1) ^ 0x9e37);
  const sky = new Color(th.sky), horizon = new Color(th.horizon);
  const fogColor = detailed ? sky.clone().lerp(horizon, 0.45) : sky.clone();
  scene.background = sky.clone();
  scene.fog = new Fog(fogColor, 18, 60);

  // sand floor
  const sandMat = track(detailed
    ? mat({ color: th.sand, map: sandTexture(), bumpMap: sandTexture(), bumpScale: 0.12, roughness: 0.96, metalness: 0 })
    : mat({ color: th.sand, roughness: 1, metalness: 0 }));
  const sand = new Mesh(track(new PlaneGeometry(120, 120, 1, 1)), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.receiveShadow = true;
  envGroup.add(sand);

  // dunes
  const duneCount = detailed ? 12 : 7;
  const duneColor = new Color(th.sand).multiplyScalar(0.75);
  const duneMat = detailed ? track(mat({ color: duneColor, map: sandTexture(), roughness: 1 })) : null;
  const duneGeo = detailed ? track(new SphereGeometry(1, seg(28), seg(12, 6), 0, Math.PI * 2, 0, Math.PI / 2)) : null;
  for (let i = 0; i < duneCount; i++) {
    const a = (i / duneCount) * Math.PI * 2 + rnd() * 0.4;
    const dist = 22 + rnd() * 18;
    const h = 2.5 + rnd() * 3.5;
    const r = 6 + rnd() * 6;
    let dune: Mesh;
    if (detailed) {
      dune = new Mesh(duneGeo!, duneMat!);
      dune.scale.set(r * 1.3, h, r * 0.8);
      dune.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist - 6);
    } else {
      dune = new Mesh(track(new ConeGeometry(r, h, 7 + Math.floor(rnd() * 4))), track(mat({ color: duneColor, roughness: 1, flatShading: true })));
      dune.position.set(Math.cos(a) * dist, h * 0.28, Math.sin(a) * dist - 6);
    }
    dune.rotation.y = rnd() * Math.PI;
    envGroup.add(dune);
  }

  const moonPos = new Vector3(-18, 20, -50);
  if (detailed) {
    // sky dome: horizon band matched to the fog, glow toward the moon
    const dome = new Mesh(track(new SphereGeometry(100, seg(32, 16), seg(16, 8))), track(new ShaderMaterial({
      uniforms: {
        uSky: { value: sky.clone() }, uHorizon: { value: fogColor.clone() },
        uGround: { value: new Color(th.sand).multiplyScalar(0.12) }, uMoonDir: { value: moonPos.clone().normalize() },
      },
      fragmentShader: SKY_FRAG, side: BackSide, depthWrite: false,
    })));
    dome.renderOrder = -2;
    dome.noAO = true;
    envGroup.add(dome);
  } else {
    // horizon glow band
    const glow = new Mesh(track(new PlaneGeometry(160, 14)),
      track(new MeshBasicMaterial({ color: th.horizon, transparent: true, opacity: 0.55, fog: false })));
    glow.position.set(0, 5, -55);
    envGroup.add(glow);
  }

  // star canopy
  const n = starCount(q);
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rnd() * Math.PI * 2, p = Math.acos(rnd() * 0.85);
    const r = 80;
    pos.push(r * Math.sin(p) * Math.cos(t), r * Math.cos(p) * 0.6 + 6, r * Math.sin(p) * Math.sin(t));
  }
  if (q.animated) {
    starMat = track(new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLogical: { value: logical } },
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    }));
    const im = new InstancedMesh(track(new PlaneGeometry(1, 1)), starMat, Math.max(1, n));
    im.customSlots = 1;
    const m4 = new Matrix4(), col = new Color(), cv = new Vector4();
    for (let i = 0; i < n; i++) {
      const b = rnd();
      const size = 1.2 + Math.pow(b, 6) * 3.4;
      const phase = rnd();
      const warm = rnd();
      const lum = 0.55 + Math.pow(b, 5) * 1.3; // a few bright stars cross the bloom threshold
      im.setMatrixAt(i, m4.makeTranslation(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!));
      im.setCustomAt(i, cv.set(size, phase, 0, 0));
      im.setColorAt(i, col.setRGB(lum * (0.8 + warm * 0.25), lum * 0.86, lum * (1.05 - warm * 0.15)));
    }
    im.count = n;
    im.frustumCulled = false;
    im.noAO = true;
    stars = im;
  } else {
    const sg = track(new BufferGeometry());
    sg.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    stars = new Points(sg, track(new PointsMaterial({ color: 0xcdd8ff, size: 0.14, fog: false })));
  }
  envGroup.add(stars);

  // moon disc (+ halo when detailed)
  const moon = new Mesh(track(new CircleGeometry(3, seg(40, 24))),
    track(new MeshBasicMaterial({ color: new Color(0xe8ecf8).multiplyScalar(detailed ? 2.2 : 1), fog: false })));
  moon.position.copy(moonPos);
  envGroup.add(moon);
  if (detailed) {
    const halo = new Mesh(track(new PlaneGeometry(22, 22)), track(new MeshBasicMaterial({
      map: glowTexture(), color: 0x8fa4d8, transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending, fog: false,
    })));
    halo.position.copy(moonPos).add(new Vector3(0, 0, -0.5));
    envGroup.add(halo);
  }

  // campfire (environmental storytelling, never raycast)
  const fireGroup = new Group();
  fireGroup.position.set(FIRE_POS[0], 0, FIRE_POS[2]);
  if (detailed) {
    const stoneMat = track(mat({ color: 0x3a3430, roughness: 0.9, flatShading: true }));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new Mesh(track(new DodecahedronGeometry(0.13 + rnd() * 0.05, 0)), stoneMat);
      s.position.set(Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5);
      s.rotation.set(rnd() * 3, rnd() * 3, 0);
      s.castShadow = true; s.receiveShadow = true;
      fireGroup.add(s);
    }
    const logMat = track(mat({ color: 0x4a2e1c, roughness: 0.85 }));
    for (let i = 0; i < 3; i++) {
      const log = new Mesh(track(new CylinderGeometry(0.06, 0.07, 0.8, 7)), logMat);
      log.rotation.set(Math.PI / 2 - 0.25, (i / 3) * Math.PI, 0);
      log.position.y = 0.12;
      fireGroup.add(log);
    }
    const flameCols = [0xff4a10, 0xff8a20, 0xffd070];
    for (let i = 0; i < 3; i++) {
      const f = new Mesh(track(new ConeGeometry(0.26 - i * 0.07, 0.75 - i * 0.12, 8, 1, true)),
        track(new MeshBasicMaterial({ color: new Color(flameCols[i]!).multiplyScalar(1.1 + i * 0.25), transparent: true, opacity: 0.8 - i * 0.12, fog: false, depthWrite: false, blending: AdditiveBlending })));
      f.position.y = 0.42 - i * 0.02;
      f.noAO = true;
      fireGroup.add(f);
      flames.push(f);
    }
    const glow = new Mesh(track(new PlaneGeometry(3.2, 3.2)), track(new MeshBasicMaterial({
      map: glowTexture(), color: th.accent, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending,
    })));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02;
    glow.noAO = true;
    fireGroup.add(glow);
  } else {
    const fire = new Mesh(track(new ConeGeometry(0.3, 0.8, 6)), track(mat({ color: 0xff7043, emissive: 0xff5010, emissiveIntensity: 2 })));
    fire.position.y = 0.4;
    fireGroup.add(fire);
  }
  envGroup.add(fireGroup);
  accentLight.color.set(th.accent);
  buildParticles(th);
}

// ---------------------------------------------------------------- particles: embers, sand motes, pair sparks
interface Fx {
  mesh: InstancedMesh; mat: ShaderMaterial; count: number; total: number;
  pos: Float32Array; vel: Float32Array; col: Float32Array; alpha: Float32Array; size: Float32Array;
  life: Float32Array; max: Float32Array; kind: Uint8Array; rnd: () => number; next: number; ember: Color; mote: Color;
}
let fx: Fx | null = null;
function buildParticles(th: Theme): void {
  const count = particleCount(look!);
  if (!count) { fx = null; return; }
  const total = count + SPARK_SLOTS;
  const m = new ShaderMaterial({
    uniforms: { uLogical: { value: logical } }, vertexShader: FX_VERT, fragmentShader: FX_FRAG,
    transparent: true, depthWrite: false, blending: AdditiveBlending,
  });
  envDisposables.push(m);
  const geo = new PlaneGeometry(1, 1);
  envDisposables.push(geo);
  const mesh = new InstancedMesh(geo, m, total);
  mesh.customSlots = 2;
  mesh.setCustomAt(0, new Vector4(0, 0, 0, 0));
  mesh.setColorAt(0, new Color(0, 0, 0));
  mesh.frustumCulled = false;
  mesh.noAO = true;
  mesh.count = total;
  fx = {
    mesh, mat: m, count, total,
    pos: new Float32Array(total * 3), vel: new Float32Array(total * 3), col: new Float32Array(total * 3),
    alpha: new Float32Array(total), size: new Float32Array(total), life: new Float32Array(total), max: new Float32Array(total),
    kind: new Uint8Array(total), rnd: mulberry(((envSeed || 1) ^ 0x51ed) >>> 0), next: 0,
    ember: new Color(th.accent), mote: new Color(th.sand).lerp(new Color(0xfff0dd), 0.3),
  };
  for (let i = 0; i < count; i++) {
    fx.kind[i] = i % 5 < 2 ? 0 : 1; // 0 ember, 1 mote
    spawn(i, true);
  }
  for (let i = count; i < total; i++) fx.kind[i] = 2;
  writeColors();
  envGroup.add(mesh);
}
function spawn(i: number, scatter: boolean): void {
  const f = fx!, r = f.rnd, j = i * 3;
  if (f.kind[i] === 0) {
    f.pos[j] = FIRE_POS[0] + (r() - 0.5) * 0.4; f.pos[j + 1] = 0.3; f.pos[j + 2] = FIRE_POS[2] + (r() - 0.5) * 0.4;
    f.vel[j] = (r() - 0.5) * 0.25; f.vel[j + 1] = 0.6 + r() * 0.8; f.vel[j + 2] = (r() - 0.5) * 0.25;
    f.max[i] = 1.4 + r() * 1.8;
    const b = 1.6 + r() * 1.6;
    f.col[j] = f.ember.r * b; f.col[j + 1] = f.ember.g * b * 0.8; f.col[j + 2] = f.ember.b * b * 0.5;
    f.size[i] = 0.9 + r() * 0.9;
  } else {
    f.pos[j] = -9 + r() * 18; f.pos[j + 1] = 0.2 + r() * 3.2; f.pos[j + 2] = -3 + r() * 11;
    f.vel[j] = 0.12 + r() * 0.2; f.vel[j + 1] = (r() - 0.5) * 0.05; f.vel[j + 2] = (r() - 0.5) * 0.08;
    f.max[i] = 6 + r() * 8;
    const b = 0.18 + r() * 0.2;
    f.col[j] = f.mote.r * b; f.col[j + 1] = f.mote.g * b; f.col[j + 2] = f.mote.b * b;
    f.size[i] = 0.5 + r() * 0.6;
  }
  f.life[i] = scatter ? r() * f.max[i]! : 0;
  colorsDirty = true;
}
let colorsDirty = false;
function writeColors(): void {
  const f = fx!;
  const a = f.mesh.instanceColor!.array as Float32Array;
  a.set(f.col.subarray(0, Math.min(a.length, f.col.length)));
  f.mesh.instanceColor!.needsUpdate = true;
  colorsDirty = false;
}
function burst(p: Vector3, color: number): void {
  const f = fx;
  if (!f || reduced) return;
  const c = new Color(color);
  for (let k = 0; k < 18; k++) {
    const i = f.count + (f.next++ % SPARK_SLOTS), j = i * 3, r = f.rnd;
    f.pos[j] = p.x; f.pos[j + 1] = p.y; f.pos[j + 2] = p.z;
    const a = r() * Math.PI * 2, s = 1.2 + r() * 1.6;
    f.vel[j] = Math.cos(a) * s; f.vel[j + 1] = 1.2 + r() * 1.8; f.vel[j + 2] = Math.sin(a) * s;
    f.life[i] = 0; f.max[i] = 0.5 + r() * 0.4;
    f.col[j] = c.r * 2.2; f.col[j + 1] = c.g * 2.2; f.col[j + 2] = c.b * 2.2;
    f.size[i] = 0.9 + r() * 0.6;
  }
  colorsDirty = true;
}
function stepParticles(dt: number): void {
  const f = fx;
  if (!f) return;
  f.mesh.visible = !reduced;
  if (reduced) return;
  const cust = f.mesh.instanceCustom!.array as Float32Array;
  for (let i = 0; i < f.total; i++) {
    const j = i * 3, o = i * 8;
    if (f.kind[i] === 2 && f.max[i] === 0) { cust[o + 4] = 0; continue; }
    f.life[i] = f.life[i]! + dt;
    if (f.life[i]! >= f.max[i]!) {
      if (i < f.count) spawn(i, false);
      else { f.max[i] = 0; cust[o + 4] = 0; continue; }
    }
    const t = f.life[i]! / f.max[i]!;
    if (f.kind[i] === 2) f.vel[j + 1] = f.vel[j + 1]! - 5 * dt;
    else if (f.kind[i] === 0) f.vel[j] = f.vel[j]! + Math.sin(time * 2 + i) * 0.1 * dt;
    f.pos[j] = f.pos[j]! + f.vel[j]! * dt; f.pos[j + 1] = f.pos[j + 1]! + f.vel[j + 1]! * dt; f.pos[j + 2] = f.pos[j + 2]! + f.vel[j + 2]! * dt;
    cust[o] = f.pos[j]!; cust[o + 1] = f.pos[j + 1]!; cust[o + 2] = f.pos[j + 2]!; cust[o + 3] = f.size[i]!;
    cust[o + 4] = f.kind[i] === 1 ? Math.sin(t * Math.PI) * 0.55 : (1 - t);
  }
  f.mesh.instanceCustom!.needsUpdate = true;
  if (colorsDirty) writeColors();
}

// ---------------------------------------------------------------- cards
let cardGeo: Geo | null = null;
/** Rounded card slab: +y face (material 0), -y back (material 1), edges (material 2); cap UVs span the card. */
function roundedCardGeometry(): Geo {
  if (cardGeo) return cardGeo;
  const w = CARD_W, h = CARD_H, r = 0.08;
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const geo = new ExtrudeGeometry(s, { depth: CARD_T, bevelEnabled: false, curveSegments: 5 });
  // lids come first (bottom half then top half), then the side walls
  const lid = geo.groups[0]!, side = geo.groups[1]!;
  const half = lid.count / 2;
  geo.clearGroups();
  geo.addGroup(lid.start + half, half, 0); // top lid (z = depth) → face
  geo.addGroup(lid.start, half, 1); // bottom lid → back
  geo.addGroup(side.start, side.count, 2);
  const uv = geo.attributes.uv!, p = geo.attributes.position!;
  const idx = geo.index;
  // the lid vertices: by index when indexed, else in order
  const lidVerts = new Set<number>();
  for (let i = lid.start; i < lid.start + lid.count; i++) lidVerts.add(idx ? idx.getX(i) : i);
  for (const v of lidVerts) uv.setXY(v, (p.getX(v) + w / 2) / w, (p.getY(v) + h / 2) / h);
  uv.needsUpdate = true;
  geo.rotateX(-Math.PI / 2); // shape top → -z, depth → +y
  geo.translate(0, -CARD_T / 2, 0);
  geo.computeBoundingSphere();
  cardGeo = geo;
  return geo;
}
const boxGeo = new BoxGeometry(CARD_W, CARD_T, CARD_H);
let sharedMats: { key: string; edge: Material; back: Material; backFace: Material } | null = null;
function shared(): { edge: Material; back: Material; backFace: Material } {
  const k = `${look!.preset}:${look!.detailed}:${look!.budget.material}:${look!.budget.card}:${theme!.id}`;
  if (sharedMats && sharedMats.key === k) return sharedMats;
  if (sharedMats) { sharedMats.edge.dispose(); sharedMats.back.dispose(); sharedMats.backFace.dispose(); }
  const back = backTexture();
  sharedMats = look!.detailed
    ? {
      key: k,
      edge: mat({ color: 0xe6dfcc, roughness: 0.7 }),
      back: mat({ map: back, roughness: 0.45, envMapIntensity: 1 }, { clearcoat: 0.8, clearcoatRoughness: 0.2 }),
      backFace: mat({ map: back, roughness: 0.55, envMapIntensity: 0.8 }, { clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    }
    : { key: k, edge: mat({ color: 0xd8d2c0, roughness: 0.8 }), back: mat({ map: back, roughness: 0.7 }), backFace: mat({ map: back, roughness: 0.7 }) };
  return sharedMats;
}
const faceMats = new Set<Material>();
/** render3d.js makeCardMesh (null: the stock's face-down card). */
function makeCardMesh(card: number | null): Mesh {
  const sm = shared();
  let face: Material;
  if (card == null) face = sm.backFace;
  else {
    face = look!.detailed
      ? mat({ map: cardTexture(card), roughness: 0.55, envMapIntensity: 0.8 }, { clearcoat: 0.45, clearcoatRoughness: 0.35 })
      : mat({ map: cardTexture(card), roughness: 0.7 });
    faceMats.add(face);
  }
  const m = look!.detailed
    ? new Mesh(roundedCardGeometry(), [face, sm.back, sm.edge])
    : new Mesh(boxGeo, [sm.edge, sm.edge, face, sm.back, sm.edge, sm.edge]);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.faceKey = card == null ? "" : `c${card}:${cvd}${look!.detailed ? ":hi" + look!.budget.card : ""}`;
  return m as unknown as Mesh;
}
function disposeCard(m: Mesh): void {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  for (const x of mats) if (faceMats.has(x)) { x.dispose(); faceMats.delete(x); }
}

export function pyramidPos(index: number): [number, number, number] {
  let r = 0;
  while (index >= ((r + 1) * (r + 2)) / 2) r++;
  const c = index - (r * (r + 1)) / 2;
  return [(c - r / 2) * COL_GAP, (6 - r) * 0.5 + 0.05 + CARD_LIFT, r * ROW_GAP * 0.78];
}

let cardMeshes: (Mesh | null)[] = new Array(28).fill(null);
let stockMesh: Mesh | null = null;
let wasteMesh: Mesh | null = null;
let wasteTop: number | null | undefined = undefined;
let marker: Mesh | null = null;
let lastState: State | null = null;
let lastSelection: CardRef[] = [];
interface Tween { obj: Vector3; key: "x" | "y" | "z"; from: number; to: number; t0: number; ms: number }
let tweens: Tween[] = [];
interface Flight { meshes: Mesh[]; t0: number; done: () => void }
let flights: Flight[] = [];

/** render3d.js buildBoard: the pyramid, stock, waste top and the marker for a state. */
export function buildBoard(state: State, th: Theme): void {
  theme = th;
  lastState = state;
  if (!look) return;
  for (const m of cardMeshes) if (m) disposeCard(m);
  if (wasteMesh) disposeCard(wasteMesh);
  for (const f of flights) f.done();
  flights = [];
  clearGroup(gameplay);
  tweens = [];
  cardMeshes = new Array(28).fill(null);
  wasteTop = undefined;
  wasteMesh = null;
  for (let i = 0; i < 28; i++) {
    const card = state.pyramid[i];
    if (card == null) continue;
    const mesh = makeCardMesh(card);
    const [x, y, z] = pyramidPos(i);
    mesh.position.set(x, y, z);
    mesh.rotation.x = CARD_TILT; // face-up, leaning toward the camera
    mesh.userData.zone = "pyramid"; mesh.userData.index = i;
    gameplay.add(mesh);
    cardMeshes[i] = mesh;
  }
  stockMesh = makeCardMesh(null);
  stockMesh.position.set(...STOCK_POS);
  stockMesh.rotation.x = Math.PI; // face down, back motif up
  stockMesh.userData.zone = "stock";
  gameplay.add(stockMesh);
  if (marker) scene.remove(marker);
  marker = new Mesh(new RingGeometry(0.62, 0.72, 40),
    new MeshBasicMaterial({ color: new Color(th.marker).multiplyScalar(1.6), side: DoubleSide, transparent: true, opacity: 0.9 }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.noAO = true;
  scene.add(marker);
  sync(state, []);
}

/** Menu hero: hide the board and look out over the dunes toward the moon. */
export function setMenuMode(on: boolean): void {
  menu = on;
  gameplay.visible = !on;
  if (marker && on) marker.visible = false;
  frameKey = "";
}

function tween(obj: Vector3, keyName: "y", to: number, ms: number): void {
  tweens = tweens.filter((t) => !(t.obj === obj && t.key === keyName));
  tweens.push({ obj, key: keyName, from: obj[keyName], to, t0: time, ms });
}

/** render3d.js syncState: cards shown/hidden by the state, the selection lift, the waste top, the marker. */
export function sync(state: State, selection: CardRef[]): void {
  lastState = state;
  lastSelection = selection;
  if (!look || !stockMesh) return;
  for (let i = 0; i < 28; i++) {
    const mesh = cardMeshes[i];
    if (!mesh) continue;
    if (state.pyramid[i] == null) {
      if (!mesh.userData.removing) mesh.visible = false; // a card keeps showing while its removal flight runs
      continue;
    }
    mesh.visible = true; // undo may restore a removed card
    const sel = selection.some((s) => s.zone === "pyramid" && s.index === i);
    const [x, y, z] = pyramidPos(i);
    const ty = y + (sel ? 0.35 : 0);
    mesh.position.x = x; mesh.position.z = z;
    if (reduced) mesh.position.y = ty;
    else tween(mesh.position, "y", ty, 140);
  }
  stockMesh.visible = state.stock.length > 0;
  const top = state.waste.length ? state.waste[state.waste.length - 1]! : null;
  if (top !== wasteTop) {
    wasteTop = top;
    if (wasteMesh && !wasteMesh.userData.removing) { gameplay.remove(wasteMesh); disposeCard(wasteMesh); }
    wasteMesh = null;
    if (top != null) {
      wasteMesh = makeCardMesh(top);
      wasteMesh.position.set(...WASTE_POS);
      wasteMesh.userData.zone = "waste";
      gameplay.add(wasteMesh);
    }
  }
  if (wasteMesh && !wasteMesh.userData.removing) {
    const ty = 0.06 + (selection.some((s) => s.zone === "waste") ? 0.35 : 0);
    if (reduced) wasteMesh.position.y = ty;
    else tween(wasteMesh.position, "y", ty, 140);
  }
  if (selection.length && marker) {
    const s = selection[0]!;
    let p: Vector3 | null = null;
    if (s.zone === "pyramid" && cardMeshes[s.index!]) p = cardMeshes[s.index!]!.position;
    if (s.zone === "waste" && wasteMesh) p = wasteMesh.position;
    if (p) { marker.position.set(p.x, 0.04, p.z); marker.visible = !menu; } else marker.visible = false;
  } else if (marker) marker.visible = false;
}

/** render3d.js animateRemoval: sparks, then the pair flies up, spins and shrinks for 320 ms. */
export function animateRemoval(refs: CardRef[], done: () => void): void {
  const meshes: Mesh[] = [];
  for (const r of refs) {
    const m = r.zone === "waste" ? wasteMesh : cardMeshes[r.index!];
    if (m) meshes.push(m);
  }
  if (reduced || !meshes.length) { done(); return; }
  for (const m of meshes) burst(m.position, theme ? theme.marker : 0xffffff);
  for (const m of meshes) {
    m.userData.removing = true;
    m.userData.flyFrom = m.position.y;
    tweens = tweens.filter((t) => t.obj !== m.position);
  }
  if (refs.some((r) => r.zone === "waste")) wasteMesh = null; // the next top builds a mesh of its own
  flights.push({ meshes, t0: time, done });
}
function stepFlights(): void {
  for (const f of flights.slice()) {
    const t = Math.min(1, (time - f.t0) / 0.32);
    for (const m of f.meshes) {
      m.position.y = (m.userData.flyFrom as number) + t * 2.2;
      m.rotation.z = t * 1.5;
      m.scale.setScalar(1 - t * 0.4);
    }
    if (t < 1) continue;
    flights.splice(flights.indexOf(f), 1);
    for (const m of f.meshes) {
      delete m.userData.removing;
      m.visible = false; m.scale.setScalar(1); m.rotation.z = 0;
      if (m.userData.zone === "waste") { gameplay.remove(m); disposeCard(m); }
    }
    f.done();
  }
}

// ---------------------------------------------------------------- quality, palette, motion
/** The runtime's quality tier applied live: rebuild what the budget bakes in (render3d.js setGraphics). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.shadowMap.enabled = next.shadows > 0;
  key.castShadow = next.shadows > 0;
  if (next.shadows > 0) key.shadow.mapSize = next.shadows;
  // high threshold: only the moon, fire, embers and the selection ring glow
  // r169 page: UnrealBloomPass strength 0.62 → 0.62² at minor 29 (r185 bloom).
  renderer.bloom = next.bloom ? { strength: 0.62 * 0.62, radius: 0.42, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.55, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8,
    resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader after OutputPass (display space): an 0.18 S-curve, saturation 1.07, cool shadows / warm highlights by a
  // smoothstep of luma 0.15–0.75, a 0.3 vignette from 0.38 to 0.9 with x × 1.1.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.09, saturation: 1.07, split: [0.15, 0.75], shadows: [0.94, 0.97, 1.07], highlights: [1.03, 1.0, 0.97],
    vignette: { amount: 0.3, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  applyEnvironment();
  const envKeys = ["material", "sand", "seg", "stars", "particles"] as const, boardKeys = ["material", "card"] as const;
  const envChanged = !prev || prev.detailed !== next.detailed || prev.animated !== next.animated || prev.particles !== next.particles ||
    envKeys.some((k) => prev.budget[k] !== next.budget[k]);
  if (theme && envChanged) buildEnv(theme, envSeed);
  if (theme && lastState && (!prev || prev.detailed !== next.detailed || boardKeys.some((k) => prev.budget[k] !== next.budget[k]))) {
    const sel = lastSelection;
    buildBoard(lastState, theme);
    sync(lastState, sel);
  }
}
/** Settings › Color-vision palette (render3d.js rebuilt the board). */
export function setPalette(name: string): void {
  if (name === cvd) return;
  cvd = name;
  if (theme && lastState && look) { const sel = lastSelection; buildBoard(lastState, theme); sync(lastState, sel); }
}
export function setReducedMotion(v: boolean): void { reduced = v; }
export function currentTheme(): Theme | null { return theme; }

// ---------------------------------------------------------------- framing and picking
let frameKey = "";
let camScale = 1;
let win = { w: 1, h: 1 };
/** C: the home view again (render3d.js resetCamera). */
export function resetCamera(): void {
  if (menu) {
    camera.position.set(CAM_MENU.pos[0]!, CAM_MENU.pos[1]!, CAM_MENU.pos[2]!);
    camera.lookAt(CAM_MENU.look[0]!, CAM_MENU.look[1]!, CAM_MENU.look[2]!);
    return;
  }
  // pull back from the home position on narrow (portrait) views so the full pyramid width stays in frame
  const [lx, ly, lz] = CAM_HOME.look as [number, number, number];
  camera.position.set(lx + (CAM_HOME.pos[0]! - lx) * camScale, ly + (CAM_HOME.pos[1]! - ly) * camScale, lz + (CAM_HOME.pos[2]! - lz) * camScale);
  camera.lookAt(lx, ly, lz);
}
/**
 * render3d.js resize: the board framed inside `safe` (window px: the old canvas less the lesson panel, padded 6
 * logical px; the whole window in menus) with a view offset over the window.
 */
function fit(safe: Rect, pad: number): void {
  const sw = Math.max(1, safe.width - pad * 2), sh = Math.max(1, safe.height - pad * 2);
  camera.aspect = sw / sh;
  camera.setViewOffset(sw, sh, -(safe.x + pad), -(safe.y + pad), win.w, win.h);
  camScale = Math.max(1, 0.92 / camera.aspect);
  resetCamera();
  camera.updateProjectionMatrix();
}
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

/** The card under a window point (render3d.js pick: gameplay layer only). */
export function pick(x: number, y: number): CardRef | null {
  if (menu) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(gameplay.children.filter((m) => m.visible && !m.userData.removing), false);
  if (!hits.length) return null;
  const u = hits[0]!.object.userData;
  return u.zone ? { zone: u.zone as CardRef["zone"], index: u.index as number | undefined } : null;
}
const corner = new Vector3();
/** A card's box on screen (window px) for its named target; null when it does not show. */
export function cardRect(ref: CardRef): Rect | null {
  const m = ref.zone === "pyramid" ? cardMeshes[ref.index!] : ref.zone === "waste" ? wasteMesh : stockMesh;
  if (!m || !m.visible || menu || m.userData.removing) return null;
  m.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    corner.set(sx * CARD_W, CARD_T / 2, sz * CARD_H).applyMatrix4(m.matrixWorld).project(camera);
    const px = ((corner.x + 1) / 2) * win.w, py = ((1 - corner.y) / 2) * win.h;
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---------------------------------------------------------------- each frame
/** render3d.js frame(): tweens, flights, twinkle, flicker, particles, the marker's pulse; framing to `safe`. */
export function update(dt: number, w: number, h: number, safe: Rect, pad: number, scale: number): void {
  dt = Math.min(0.1, dt);
  if (w > 0 && h > 0) {
    logical.set(w / scale, h / scale);
    const fk = `${w}x${h}:${menu}:${Math.round(safe.x)}:${Math.round(safe.y)}:${Math.round(safe.width)}:${Math.round(safe.height)}`;
    if (fk !== frameKey && safe.width > 0 && safe.height > 0) {
      frameKey = fk;
      win = { w, h };
      fit(menu ? { x: 0, y: 0, width: w, height: h } : safe, menu ? 0 : pad);
    }
  }
  time += dt;
  tweens = tweens.filter((t) => {
    const a = Math.min(1, (time - t.t0) / (t.ms / 1000));
    t.obj[t.key] = t.from + (t.to - t.from) * (1 - Math.pow(1 - a, 3));
    return a < 1;
  });
  stepFlights();
  const moving = !reduced;
  if (stars && moving) stars.rotation.y += dt * 0.004;
  if (starMat) starMat.uniforms.uTime!.value = time;
  // fire flicker (animated sky tier only)
  const flicker = !!look?.animated && moving;
  const fl = flicker ? 0.82 + 0.12 * Math.sin(time * 11) + 0.08 * Math.sin(time * 23.7 + 1.3) : 1;
  accentLight.intensity = FIRE_LIGHT * fl;
  flames.forEach((f, i) => {
    const s = flicker ? 1 + 0.12 * Math.sin(time * (9 + i * 3) + i) : 1;
    f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
    f.rotation.y = flicker ? time * (0.6 + i * 0.3) : 0;
  });
  stepParticles(dt);
  if (marker && marker.visible && moving) (marker.material as MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 1000 / 240);
}
/** Card faces wait for the fonts (natively at once, on the web a frame or two). */
export function ready(): boolean { return fontsReady; }
