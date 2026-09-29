/* Summit Pyramid — Three.js desert-night tableau.
 * Deterministic visual seed; gameplay meshes on a dedicated raycast layer.
 * Graphics quality comes from gfx.js (presets + per-category overrides) and is
 * applied live via setGraphics(). */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { detectPreset, describe, resolve, SHADOW_MAP, PARTICLE_COUNT, STAR_COUNT } from './gfx.js';

const CARD_W = 1, CARD_H = 1.42, CARD_T = 0.03;
const CARD_TILT = 0.42;
// lift so the tilted bottom row's near edge clears the sand
const CARD_LIFT = Math.sin(CARD_TILT) * CARD_H / 2 + 0.03;
const ROW_GAP = 1.06, COL_GAP = 1.06;
const CAM_HOME = { pos: [0, 10.6, 10.4], look: [0, 0, 2.1] };
const CAM_MENU = { pos: [0.6, 2.6, 15.5], look: [7.4, 4.6, -24] };
// play-area bounds the key-light shadow box is fitted to
const PLAY_CENTER = [-0.4, 0, 3.0], PLAY_RADIUS = 6.2;
const FIRE_POS = [4.5, 0, 5.5];
const SPARK_SLOTS = 72;
const FIRE_LIGHT = 5.5;

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'];
const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/* Dispose geometry + materials of a mesh. Textures are shared via texCache and
   shared geometries are flagged, so neither is disposed here. */
function disposeMesh(m) {
  if (!m) return;
  m.traverse(o => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const mat of new Set(mats)) if (!mat.userData.shared) mat.dispose();
  });
}

// Colour grade + vignette, applied in display space after the output transform.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // gentle S-curve, a touch more saturation, cool night shadows / warm lamp-lit highlights
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.07);
      s *= mix(vec3(0.94, 0.97, 1.07), vec3(1.03, 1.0, 0.97), smoothstep(0.15, 0.75, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Star canopy with per-star twinkle (animated sky tier).
const STAR_VERT = `
  attribute float aSize; attribute float aPhase; attribute vec3 aColor;
  uniform float uTime; uniform float uPixel;
  varying vec3 vColor; varying float vTw;
  void main() {
    vColor = aColor;
    vTw = 0.72 + 0.28 * sin(uTime * (0.8 + aPhase * 0.9) + aPhase * 40.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixel;
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FRAG = `
  varying vec3 vColor; varying float vTw;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.0, length(p));
    gl_FragColor = vec4(vColor * vTw * a, a);
  }`;

// Soft additive particles (embers, sand motes, pair sparks).
const FX_VERT = `
  attribute float aAlpha; attribute vec3 aColor; attribute float aSize;
  uniform float uPixel;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vColor = aColor; vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixel * (120.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }`;
const FX_FRAG = `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.05, length(p)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

// Sky dome: fog-matched horizon rising into the theme sky, with a moon-side glow.
const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
  uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uMoonDir;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 c = mix(uHorizon, uSky, smoothstep(0.0, 0.45, h));
    c = mix(c, uGround, smoothstep(0.0, -0.08, h));
    float m = max(dot(normalize(vDir), uMoonDir), 0.0);
    c += vec3(0.14, 0.16, 0.22) * pow(m, 32.0) + vec3(0.03, 0.035, 0.055) * pow(m, 6.0);
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Renderer3D {
  constructor(canvas, settings) {
    this.settings = settings;
    this.ok = false;
    this.tweens = [];
    this.cardMeshes = [];      // index 0..27 -> mesh or null
    this.onPick = null;
    this.enabled = true;
    this.menu = false;
    this.flames = [];
    this.adaptiveScale = 1;
    this._frames = [];
    this.size = [0, 0];
    this.pixelRatio = 1;
    this.postFailed = false;
    this.composer = null;
    this.postKey = null;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { return; }
    if (!this.renderer.getContext()) return;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gpu = this._gpuName();
    const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches &&
      !matchMedia('(any-pointer: fine)').matches) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
    this.detected = detectPreset(this.gpu, mobile);
    this.q = resolve(settings.gfx, this.detected);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
    this.resetCamera();
    this.gameplay = new THREE.Group();       // raycast layer: gameplay only
    this.scene.add(this.gameplay);
    this.envGroup = new THREE.Group();
    this.scene.add(this.envGroup);
    this.texCache = new Map();
    this.buildLights();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.time = 0;
    this._rmq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.ok = true;
    this.setGraphics(settings.gfx, true);
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  _gpuName() {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch (e) { return ''; }
  }

  get reduced() { return !!(this.settings.reducedMotion || (this._rmq && this._rmq.matches)); }

  /* ---- graphics settings ---- */

  /** Apply saved graphics settings ({preset, render_scale, adaptive, show_fps, <cat>}). */
  setGraphics(saved, initial) {
    if (!this.ok) return;
    const prev = this.q;
    const g = resolve(saved, this.detected);
    this.q = g;
    const size = SHADOW_MAP[g.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    this.key.castShadow = size > 0;
    if (size > 0 && this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    this.renderer.shadowMap.needsUpdate = true;
    this._applyEnvironment();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null;          // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
    if (this.canvasEl()) this.canvasEl().dataset.gfxPreset = g.preset;
    if (!initial && prev && this.theme) {
      const envChanged = prev.detail !== g.detail || prev.background !== g.background || prev.particles !== g.particles;
      if (envChanged) this.buildEnv(this.theme, this.envSeed);
      if (prev.detail !== g.detail && this.lastState) {
        this.buildBoard(this.lastState, this.theme);
        this.syncState(this.lastState, this.lastSelection || []);
      }
    }
    // materials pick up shadow-map / environment changes on recompile
    this.scene.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) m.needsUpdate = true;
    });
    this.resize();
  }

  canvasEl() { return this.renderer && this.renderer.domElement; }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo(t) {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || '',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, t),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _applyEnvironment() {
    if (this.q.reflections === 'on') {
      if (!this.envTex) {
        const pm = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.envTex = pm.fromScene(room, 0.04).texture;
        room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        pm.dispose();
      }
      this.scene.environment = this.envTex;
      this.scene.environmentIntensity = 0.24;   // a moonlit night: reflections, not daylight
    } else {
      this.scene.environment = null;
    }
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '— fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _ratio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(0.5, Math.min(3, Math.min(dpr, this.q.cap) * this.q.scale * this.adaptiveScale));
  }

  _postKey(w, h) {
    const g = this.q;
    // size changes resize the chain in place (no shader recompiles); only effect changes rebuild it
    return g.post && w && h ? [g.ao, g.bloom, g.grade, g.antialias].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) { this.composer.dispose(); this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.composer = null;
    this.fxaaPass = null;
    if (!g.post || this.postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio)), ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // high threshold: only the moon, fire, embers and the selection ring glow
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.42, 0.9));
      }
      composer.addPass(new OutputPass());
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
        this.fxaaPass = fxaa;
      }
      this.composer = composer;
    } catch (e) {
      // post-processing is an enhancement: render directly if the chain cannot be built
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(this.fps) + ' fps · ' + (Math.round(this.pixelRatio * 100) / 100) + '×';
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  /* ---- environment ---- */

  buildLights() {
    this.key = new THREE.DirectionalLight(0xbfd0ff, 1.0);   // moon key
    this.key.position.set(PLAY_CENTER[0] - 7, 12, PLAY_CENTER[2] + 4.5);
    this.key.target.position.set(...PLAY_CENTER);
    this.scene.add(this.key.target);
    this.key.castShadow = false;
    // shadow box fitted tightly around the pyramid, stock and waste
    const sc = this.key.shadow.camera;
    sc.left = -PLAY_RADIUS; sc.right = PLAY_RADIUS; sc.top = PLAY_RADIUS; sc.bottom = -PLAY_RADIUS;
    sc.near = 2; sc.far = 32;
    sc.updateProjectionMatrix();
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.key.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.key);
    this.fill = new THREE.HemisphereLight(0x3a4a78, 0x2a1d12, 0.62);
    this.scene.add(this.fill);
    this.accentLight = new THREE.PointLight(0xffb35c, FIRE_LIGHT, 11, 1.6); // campfire accent
    this.accentLight.position.set(FIRE_POS[0], 1.2, FIRE_POS[2]);
    this.scene.add(this.accentLight);
  }

  _sandTexture() {
    if (this.texCache.has('sand')) return this.texCache.get('sand');
    const n = 256, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const img = g.createImageData(n, n);
    const rnd = mulberry(77);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      // wind ripples (tileable: whole periods across the tile) + grain
      const u = x / n, v = y / n;
      const warp = Math.sin(u * Math.PI * 2 * 2) * 0.3 + Math.sin((u + v) * Math.PI * 2 * 3) * 0.12;
      const rip = Math.pow(Math.sin((v * 7 + warp) * Math.PI * 2) * 0.5 + 0.5, 3);
      const val = 0.92 + rip * 0.045 + (rnd() - 0.5) * 0.07;
      const c = Math.max(0, Math.min(255, val * 255));
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(34, 22);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.texCache.set('sand', tex);
    return tex;
  }

  _glowTexture() {
    if (this.texCache.has('glow')) return this.texCache.get('glow');
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    this.texCache.set('glow', tex);
    return tex;
  }

  buildEnv(theme, seed) {
    this.theme = theme;
    this.envSeed = seed;
    while (this.envGroup.children.length) {
      const c = this.envGroup.children[this.envGroup.children.length - 1];
      this.envGroup.remove(c);
      disposeMesh(c);
    }
    this.stars = null; this.starMat = null; this.fx = null; this.flames = [];
    const q = this.q;
    const detailed = q.detail === 'detailed';
    const rnd = mulberry((seed || 1) ^ 0x9e37);
    const sky = new THREE.Color(theme.sky), horizon = new THREE.Color(theme.horizon);
    const fogColor = detailed ? sky.clone().lerp(horizon, 0.45) : sky.clone();
    this.scene.background = sky.clone();
    this.scene.fog = new THREE.Fog(fogColor, 18, 60);

    // sand floor
    const sandMat = detailed
      ? new THREE.MeshStandardMaterial({ color: theme.sand, map: this._sandTexture(), bumpMap: this._sandTexture(), bumpScale: 0.12, roughness: 0.96, metalness: 0 })
      : new THREE.MeshStandardMaterial({ color: theme.sand, roughness: 1, metalness: 0 });
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 1, 1), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.receiveShadow = true;
    this.envGroup.add(sand);

    // dunes
    const duneCount = detailed ? 12 : 7;
    const duneColor = new THREE.Color(theme.sand).multiplyScalar(0.75);
    const duneMat = detailed
      ? new THREE.MeshStandardMaterial({ color: duneColor, map: this._sandTexture(), roughness: 1 })
      : new THREE.MeshStandardMaterial({ color: duneColor, roughness: 1, flatShading: true });
    const duneGeo = detailed ? new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2) : null;
    for (let i = 0; i < duneCount; i++) {
      const a = (i / duneCount) * Math.PI * 2 + rnd() * 0.4;
      const dist = 22 + rnd() * 18;
      const h = 2.5 + rnd() * 3.5;
      const r = 6 + rnd() * 6;
      let dune;
      if (detailed) {
        dune = new THREE.Mesh(duneGeo.clone(), duneMat);
        dune.scale.set(r * 1.3, h, r * 0.8);
        dune.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist - 6);
      } else {
        dune = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7 + Math.floor(rnd() * 4)), duneMat.clone());
        dune.position.set(Math.cos(a) * dist, h * 0.28, Math.sin(a) * dist - 6);
      }
      dune.rotation.y = rnd() * Math.PI;
      this.envGroup.add(dune);
    }
    if (duneGeo) duneGeo.dispose();

    const moonPos = new THREE.Vector3(-18, 20, -50);
    if (detailed) {
      // sky dome: horizon band matched to the fog, glow toward the moon
      const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
        uniforms: {
          uSky: { value: sky.clone() }, uHorizon: { value: fogColor.clone() },
          uGround: { value: new THREE.Color(theme.sand).multiplyScalar(0.12) },
          uMoonDir: { value: moonPos.clone().normalize() },
        },
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      }));
      dome.renderOrder = -2;
      this.envGroup.add(dome);
    } else {
      // horizon glow band
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(160, 14),
        new THREE.MeshBasicMaterial({ color: theme.horizon, transparent: true, opacity: 0.55, fog: false }));
      glow.position.set(0, 5, -55);
      this.envGroup.add(glow);
    }

    // star canopy
    const n = STAR_COUNT[q.background];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = rnd() * Math.PI * 2, p = Math.acos(rnd() * 0.85);
      const r = 80;
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p) * 0.6 + 6;
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (q.background === 'animated') {
      const size = new Float32Array(n), phase = new Float32Array(n), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const b = rnd();
        size[i] = 1.2 + Math.pow(b, 6) * 3.4;
        phase[i] = rnd();
        const warm = rnd();
        const lum = 0.55 + Math.pow(b, 5) * 1.3;   // a few bright stars cross the bloom threshold
        col[i * 3] = lum * (0.8 + warm * 0.25); col[i * 3 + 1] = lum * 0.86; col[i * 3 + 2] = lum * (1.05 - warm * 0.15);
      }
      sg.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      this.starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPixel: { value: this.pixelRatio } },
        vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.stars = new THREE.Points(sg, this.starMat);
    } else {
      this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.14, fog: false }));
    }
    this.envGroup.add(this.stars);

    // moon disc (+ halo when detailed)
    const moonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8ecf8).multiplyScalar(detailed ? 2.2 : 1), fog: false });
    const moon = new THREE.Mesh(new THREE.CircleGeometry(3, 40), moonMat);
    moon.position.copy(moonPos);
    this.envGroup.add(moon);
    if (detailed) {
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({
        map: this._glowTexture(), color: 0x8fa4d8, transparent: true, opacity: 0.28, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      }));
      halo.position.copy(moonPos).add(new THREE.Vector3(0, 0, -0.5));
      this.envGroup.add(halo);
    }

    // campfire (environmental storytelling, never raycast)
    const fireGroup = new THREE.Group();
    fireGroup.position.set(FIRE_POS[0], 0, FIRE_POS[2]);
    if (detailed) {
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.9, flatShading: true });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13 + rnd() * 0.05, 0), stoneMat);
        s.position.set(Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5);
        s.rotation.set(rnd() * 3, rnd() * 3, 0);
        s.castShadow = true; s.receiveShadow = true;
        fireGroup.add(s);
      }
      const logMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1c, roughness: 0.85 });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 7), logMat);
        log.rotation.set(Math.PI / 2 - 0.25, (i / 3) * Math.PI, 0);
        log.position.y = 0.12;
        fireGroup.add(log);
      }
      const flameCols = [0xff4a10, 0xff8a20, 0xffd070];
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.26 - i * 0.07, 0.75 - i * 0.12, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(flameCols[i]).multiplyScalar(1.1 + i * 0.25), transparent: true, opacity: 0.8 - i * 0.12, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
        f.position.y = 0.42 - i * 0.02;
        f.userData.base = 1;
        fireGroup.add(f);
        this.flames.push(f);
      }
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({
        map: this._glowTexture(), color: theme.accent, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02;
      fireGroup.add(glow);
    } else {
      const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff7043, emissive: 0xff5010, emissiveIntensity: 2 }));
      fire.position.y = 0.4;
      fireGroup.add(fire);
    }
    this.envGroup.add(fireGroup);
    this.accentLight.color.set(theme.accent);
    this._buildParticles(theme);
  }

  /* ---- particles: embers from the fire, sand motes over the board, pair sparks ---- */

  _buildParticles(theme) {
    const count = PARTICLE_COUNT[this.q.particles];
    if (!count) { this.fx = null; return; }
    const total = count + SPARK_SLOTS;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const alpha = new Float32Array(total), size = new Float32Array(total);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uPixel: { value: this.pixelRatio } }, vertexShader: FX_VERT, fragmentShader: FX_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.fx = {
      pts, pos, col, alpha, size, count, total,
      vel: new Float32Array(total * 3), life: new Float32Array(total), max: new Float32Array(total),
      kind: new Uint8Array(total), rnd: mulberry(((this.envSeed || 1) ^ 0x51ed) >>> 0), next: 0,
      ember: new THREE.Color(theme.accent), mote: new THREE.Color(theme.sand).lerp(new THREE.Color(0xfff0dd), 0.3),
    };
    for (let i = 0; i < count; i++) {
      this.fx.kind[i] = i % 5 < 2 ? 0 : 1;   // 0 ember, 1 mote
      this._spawn(i, true);
    }
    this.envGroup.add(pts);
  }

  _spawn(i, scatter) {
    const f = this.fx, r = f.rnd;
    const j = i * 3;
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
    f.life[i] = scatter ? r() * f.max[i] : 0;
  }

  _burst(p, color) {
    const f = this.fx;
    if (!f || this.reduced) return;
    const c = new THREE.Color(color);
    for (let k = 0; k < 18; k++) {
      const i = f.count + (f.next++ % SPARK_SLOTS), j = i * 3, r = f.rnd;
      f.kind[i] = 2;
      f.pos[j] = p.x; f.pos[j + 1] = p.y; f.pos[j + 2] = p.z;
      const a = r() * Math.PI * 2, s = 1.2 + r() * 1.6;
      f.vel[j] = Math.cos(a) * s; f.vel[j + 1] = 1.2 + r() * 1.8; f.vel[j + 2] = Math.sin(a) * s;
      f.life[i] = 0; f.max[i] = 0.5 + r() * 0.4;
      f.col[j] = c.r * 2.2; f.col[j + 1] = c.g * 2.2; f.col[j + 2] = c.b * 2.2;
      f.size[i] = 0.9 + r() * 0.6;
    }
  }

  _stepParticles(dt) {
    const f = this.fx;
    if (!f) return;
    f.pts.visible = !this.reduced;
    if (this.reduced) return;
    for (let i = 0; i < f.total; i++) {
      const j = i * 3;
      if (f.kind[i] === 2 && f.max[i] === 0) { f.alpha[i] = 0; continue; }
      f.life[i] += dt;
      if (f.life[i] >= f.max[i]) {
        if (i < f.count) this._spawn(i, false);
        else { f.max[i] = 0; f.alpha[i] = 0; continue; }
      }
      const t = f.life[i] / f.max[i];
      if (f.kind[i] === 2) f.vel[j + 1] -= 5 * dt;
      else if (f.kind[i] === 0) f.vel[j] += Math.sin(this.time * 2 + i) * 0.1 * dt;
      f.pos[j] += f.vel[j] * dt; f.pos[j + 1] += f.vel[j + 1] * dt; f.pos[j + 2] += f.vel[j + 2] * dt;
      f.alpha[i] = f.kind[i] === 1 ? Math.sin(t * Math.PI) * 0.55 : (1 - t);
    }
    const g = f.pts.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  /* ---- card textures ---- */

  cardTexture(card, cvd) {
    const hi = this.q.detail === 'detailed';
    const key = 'c' + card + ':' + cvd + (hi ? ':hi' : '');
    if (this.texCache.has(key)) return this.texCache.get(key);
    const red = card >= 13 && card < 39;
    let color = red ? '#b02020' : '#1c1c2a';
    if (cvd === 'deuter') color = red ? '#0072b2' : '#1c1c2a';
    if (cvd === 'tritan') color = red ? '#d55e00' : '#1c1c2a';
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    const rank = RANK_LABEL[card % 13], suit = SUIT_GLYPH[Math.floor(card / 13)];
    if (!hi) {
      cv.width = 128; cv.height = 180;
      g.fillStyle = '#f4f0e4'; g.fillRect(0, 0, 128, 180);
      g.strokeStyle = '#8a8578'; g.lineWidth = 4; g.strokeRect(3, 3, 122, 174);
      g.fillStyle = color;
      g.font = 'bold 34px system-ui';
      g.textAlign = 'center';
      g.fillText(rank, 64, 70);
      g.font = '44px system-ui';
      g.fillText(suit, 64, 130);
      g.font = 'bold 18px system-ui';
      g.textAlign = 'left'; g.fillText(rank, 10, 26);
    } else {
      const W = 256, H = 364;
      cv.width = W; cv.height = H;
      // warm paper with a soft centre light and fine grain
      const bg = g.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H / 2, H * 0.7);
      bg.addColorStop(0, '#fbf8ee'); bg.addColorStop(1, '#ebe4d2');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const rnd = mulberry(card * 131 + 7);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(120,100,70,0.05)' : 'rgba(255,255,255,0.08)';
        g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
      }
      // inset frame
      g.strokeStyle = 'rgba(120,110,90,0.55)'; g.lineWidth = 2;
      roundRect(g, 14, 14, W - 28, H - 28, 14); g.stroke();
      g.fillStyle = color;
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = 'bold 76px Georgia, "Times New Roman", serif';
      g.fillText(rank, W / 2, 150);
      g.font = '96px system-ui, "Segoe UI Symbol", sans-serif';
      g.fillText(suit, W / 2, 262);
      // corner indices (top-left, and rotated bottom-right)
      const corner = () => {
        g.textAlign = 'center';
        g.font = 'bold 36px Georgia, "Times New Roman", serif'; g.fillText(rank, 38, 52);
        g.font = '30px system-ui, "Segoe UI Symbol", sans-serif'; g.fillText(suit, 38, 84);
      };
      corner();
      g.save(); g.translate(W, H); g.rotate(Math.PI); corner(); g.restore();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = hi ? 8 : 4;
    this.texCache.set(key, tex);
    return tex;
  }

  backTexture(theme) {
    const hi = this.q.detail === 'detailed';
    const key = 'back:' + theme.id + (hi ? ':hi' : '');
    if (this.texCache.has(key)) return this.texCache.get(key);
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    const base = '#' + new THREE.Color(theme.cardBack).getHexString();
    const acc = '#' + new THREE.Color(theme.accent).getHexString();
    if (!hi) {
      cv.width = 128; cv.height = 180;
      g.fillStyle = base; g.fillRect(0, 0, 128, 180);
      g.strokeStyle = acc; g.lineWidth = 3;
      for (let i = 0; i < 5; i++) {  // original peak motif
        g.beginPath();
        g.moveTo(14, 160 - i * 30); g.lineTo(64, 132 - i * 30); g.lineTo(114, 160 - i * 30);
        g.stroke();
      }
    } else {
      const W = 256, H = 364;
      cv.width = W; cv.height = H;
      const c = new THREE.Color(theme.cardBack);
      const top = '#' + c.clone().multiplyScalar(1.25).getHexString(), bot = '#' + c.clone().multiplyScalar(0.7).getHexString();
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, top); bg.addColorStop(1, bot);
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = acc; g.lineWidth = 3;
      roundRect(g, 12, 12, W - 24, H - 24, 14); g.stroke();
      g.globalAlpha = 0.85; g.lineWidth = 5;
      for (let i = 0; i < 5; i++) {  // peak motif, layered like far ridges
        g.globalAlpha = 0.45 + i * 0.12;
        g.beginPath();
        g.moveTo(34, 320 - i * 52); g.lineTo(W / 2, 266 - i * 52); g.lineTo(W - 34, 320 - i * 52);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = acc;
      g.beginPath(); g.arc(W / 2, 46, 11, 0, Math.PI * 2); g.fill();   // summit star
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = hi ? 8 : 4;
    this.texCache.set(key, tex);
    return tex;
  }

  // Rounded card slab: +y face (material 0), -y back (material 1), edges (material 2);
  // cap UVs span the card rectangle so face art maps like the box version.
  _roundedCardGeometry() {
    if (this._cardGeo) return this._cardGeo;
    const w = CARD_W, h = CARD_H, r = 0.08;
    const s = new THREE.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geo = new THREE.ExtrudeGeometry(s, { depth: CARD_T, bevelEnabled: false, curveSegments: 5 });
    // lids come first (bottom half then top half), then the side walls
    const lid = geo.groups[0], side = geo.groups[1];
    const half = lid.count / 2;
    geo.clearGroups();
    geo.addGroup(lid.start + half, half, 0);   // top lid (z = depth) → face
    geo.addGroup(lid.start, half, 1);          // bottom lid → back
    geo.addGroup(side.start, side.count, 2);
    const uv = geo.attributes.uv, p = geo.attributes.position;
    for (let i = 0; i < lid.count; i++) {
      const x = p.getX(lid.start + i), y = p.getY(lid.start + i);
      uv.setXY(lid.start + i, (x + w / 2) / w, (y + h / 2) / h);
    }
    geo.rotateX(-Math.PI / 2);                 // shape top → -z, depth → +y
    geo.translate(0, -CARD_T / 2, 0);
    geo.computeBoundingSphere();
    geo.userData.shared = true;
    this._cardGeo = geo;
    return geo;
  }

  makeCardMesh(card, theme) {
    if (this.q.detail === 'detailed') {
      const edge = new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.7 });
      const faceMap = card == null ? this.backTexture(theme) : this.cardTexture(card, this.settings.cvd);
      const face = new THREE.MeshPhysicalMaterial({
        map: faceMap, roughness: 0.55, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.8,
      });
      const back = new THREE.MeshPhysicalMaterial({
        map: this.backTexture(theme), roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 1,
      });
      const m = new THREE.Mesh(this._roundedCardGeometry(), [face, back, edge]);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    }
    // BoxGeometry(w, t, h): the card-sized faces are ±y (material slots 2/3),
    // the thin edges are ±x/±z. Face art goes on +y, the back motif on -y.
    const edge = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.8 });
    const face = card == null
      ? new THREE.MeshStandardMaterial({ map: this.backTexture(theme), roughness: 0.7 })
      : new THREE.MeshStandardMaterial({ map: this.cardTexture(card, this.settings.cvd), roughness: 0.7 });
    const back = new THREE.MeshStandardMaterial({ map: this.backTexture(theme), roughness: 0.7 });
    const mats = [edge, edge, face, back, edge, edge];
    const m = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H), mats);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /* ---- board ---- */

  pyramidPos(index) {
    let r = 0;
    while (index >= ((r + 1) * (r + 2)) / 2) r++;
    const c = index - (r * (r + 1)) / 2;
    const x = (c - r / 2) * COL_GAP;
    const z = r * ROW_GAP * 0.78;
    const y = (6 - r) * 0.5 + 0.05 + CARD_LIFT;
    return [x, y, z];
  }

  buildBoard(state, theme) {
    this.theme = theme;
    this.lastState = state;
    while (this.gameplay.children.length) {
      const c = this.gameplay.children[this.gameplay.children.length - 1];
      this.gameplay.remove(c);
      disposeMesh(c);
    }
    this.tweens = [];
    this.cardMeshes = new Array(28).fill(null);
    this.wasteTopCard = undefined;
    for (let i = 0; i < 28; i++) {
      if (state.pyramid[i] == null) continue;
      const mesh = this.makeCardMesh(state.pyramid[i], theme);
      const [x, y, z] = this.pyramidPos(i);
      mesh.position.set(x, y, z);
      mesh.rotation.x = CARD_TILT;   // face-up, leaning toward the camera
      mesh.userData = { zone: 'pyramid', index: i };
      this.gameplay.add(mesh);
      this.cardMeshes[i] = mesh;
    }
    // stock pile
    this.stockMesh = this.makeCardMesh(null, theme);
    this.stockMesh.position.set(-4.25, 0.06, 5.6);
    this.stockMesh.rotation.x = Math.PI;   // face down, back motif up
    this.stockMesh.userData = { zone: 'stock' };
    this.gameplay.add(this.stockMesh);
    // waste
    this.wasteMesh = null;
    this.syncState(state, []);
    // selection marker ring (HDR colour so it glows under bloom)
    if (this.marker) { this.scene.remove(this.marker); disposeMesh(this.marker); }
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.marker).multiplyScalar(1.6), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  /** Menu hero: hide the board and look out over the dunes toward the moon. */
  setMenuMode(on) {
    this.menu = !!on;
    if (!this.ok) return;
    this.gameplay.visible = !on;
    if (this.marker && on) this.marker.visible = false;
    this.resize();
  }

  syncState(state, selection) {
    this.lastState = state;
    this.lastSelection = selection;
    // pyramid
    for (let i = 0; i < 28; i++) {
      const mesh = this.cardMeshes[i];
      if (!mesh) continue;
      if (state.pyramid[i] == null) {
        // keep a card visible while its removal flight animation runs
        if (!mesh.userData.removing) mesh.visible = false;
        continue;
      }
      mesh.visible = true;   // undo may restore a previously removed card
      const sel = selection.some(s => s.zone === 'pyramid' && s.index === i);
      const [x, y, z] = this.pyramidPos(i);
      const targetY = y + (sel ? 0.35 : 0);
      if (this.reduced) mesh.position.set(x, targetY, z);
      else this.tween(mesh.position, { y: targetY }, 140);
    }
    // stock visibility
    this.stockMesh.visible = state.stock.length > 0;
    // waste top — rebuild the mesh only when the top card actually changes
    const top = state.waste.length ? state.waste[state.waste.length - 1] : null;
    if (top !== this.wasteTopCard) {
      this.wasteTopCard = top;
      if (this.wasteMesh && !this.wasteMesh.userData.removing) {
        this.gameplay.remove(this.wasteMesh);
        disposeMesh(this.wasteMesh);
        this.wasteMesh = null;
      }
      if (top != null) {
        this.wasteMesh = this.makeCardMesh(top, this.theme);
        this.wasteMesh.position.set(-2.95, 0.06, 5.6);
        this.wasteMesh.rotation.x = 0;   // face up
        this.wasteMesh.userData = { zone: 'waste' };
        this.gameplay.add(this.wasteMesh);
      } else this.wasteMesh = null;
    }
    if (this.wasteMesh && !this.wasteMesh.userData.removing) {
      const sel = selection.some(s => s.zone === 'waste');
      const targetY = 0.06 + (sel ? 0.35 : 0);
      if (this.reduced) this.wasteMesh.position.y = targetY;
      else this.tween(this.wasteMesh.position, { y: targetY }, 140);
    }
    // marker at first selection
    if (selection.length && this.marker) {
      const s = selection[0];
      let p = null;
      if (s.zone === 'pyramid' && this.cardMeshes[s.index]) p = this.cardMeshes[s.index].position;
      if (s.zone === 'waste' && this.wasteMesh) p = this.wasteMesh.position;
      if (p) { this.marker.position.set(p.x, 0.04, p.z); this.marker.visible = !this.menu; }
      else this.marker.visible = false;
    } else if (this.marker) this.marker.visible = false;
  }

  animateRemoval(refs, done) {
    const meshes = [];
    for (const r of refs) {
      const m = r.zone === 'waste' ? this.wasteMesh : this.cardMeshes[r.index];
      if (m) meshes.push(m);
    }
    if (this.reduced || !meshes.length) { done(); return; }
    for (const m of meshes) this._burst(m.position, this.theme ? this.theme.marker : 0xffffff);
    const start = performance.now();
    const dur = 320;
    meshes.forEach(m => { m.userData.removing = true; m.userData.flyFrom = m.position.clone(); });
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / dur);
      for (const m of meshes) {
        m.position.y = m.userData.flyFrom.y + t * 2.2;
        m.rotation.z = t * 1.5;
        m.scale.setScalar(1 - t * 0.4);
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        meshes.forEach(m => {
          delete m.userData.removing;
          m.visible = false; m.scale.setScalar(1); m.rotation.z = 0;
          if (m.userData.zone === 'waste') { this.gameplay.remove(m); disposeMesh(m); }
        });
        done();
      }
    };
    step();
  }

  tween(vec, to, ms) {
    for (const k of Object.keys(to)) {
      this.tweens = this.tweens.filter(t => !(t.vec === vec && t.key === k));
      this.tweens.push({ vec, key: k, from: vec[k], to: to[k], t0: performance.now(), ms });
    }
  }

  frame() {
    if (document.hidden) return;
    const dt = Math.min(0.1, this.clock.getDelta());
    const now = performance.now();
    if (this._adapt(dt * 1000)) this.resize();
    this.tweens = this.tweens.filter(t => {
      const a = Math.min(1, (now - t.t0) / t.ms);
      const e = 1 - Math.pow(1 - a, 3);
      t.vec[t.key] = t.from + (t.to - t.from) * e;
      return a < 1;
    });
    const moving = !this.reduced;
    if (moving) this.time += dt;
    if (this.stars && moving) this.stars.rotation.y += dt * 0.004;
    if (this.starMat) { this.starMat.uniforms.uTime.value = this.time; this.starMat.uniforms.uPixel.value = this.pixelRatio; }
    if (this.fx) this.fx.pts.material.uniforms.uPixel.value = this.pixelRatio;
    // fire flicker (animated sky tier only)
    const flicker = this.q.background === 'animated' && moving;
    const fl = flicker ? 0.82 + 0.12 * Math.sin(this.time * 11) + 0.08 * Math.sin(this.time * 23.7 + 1.3) : 1;
    this.accentLight.intensity = FIRE_LIGHT * fl;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const s = flicker ? 1 + 0.12 * Math.sin(this.time * (9 + i * 3) + i) : 1;
      f.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      f.rotation.y = flicker ? this.time * (0.6 + i * 0.3) : 0;
    }
    this._stepParticles(dt);
    if (this.marker && this.marker.visible && moving)
      this.marker.material.opacity = 0.6 + 0.3 * Math.sin(now / 240);
    const w = this.size[0], h = this.size[1];
    const key = this._postKey(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(w, h);
    }
    if (this.composer) {
      try { this.composer.render(dt); }
      catch (e) { this.postFailed = true; this.composer = null; this.renderer.render(this.scene, this.camera); }
    } else this.renderer.render(this.scene, this.camera);
  }

  resetCamera() {
    if (this.menu) {
      this.camera.position.set(...CAM_MENU.pos);
      this.camera.lookAt(...CAM_MENU.look);
      return;
    }
    // pull back from the home position on narrow (portrait) viewports so the
    // full pyramid width stays inside the frame
    const s = this.camScale || 1;
    const [lx, ly, lz] = CAM_HOME.look;
    this.camera.position.set(
      lx + (CAM_HOME.pos[0] - lx) * s,
      ly + (CAM_HOME.pos[1] - ly) * s,
      lz + (CAM_HOME.pos[2] - lz) * s);
    this.camera.lookAt(lx, ly, lz);
  }

  // Part of the canvas covered by the lesson panel (or other chrome laid over
  // it); the board is framed inside the remaining rectangle via a view offset.
  _safeRect(w, h) {
    let top = 0, bottom = h, left = 0, right = w;
    const host = this.renderer.domElement.getBoundingClientRect();
    const tut = document.querySelector('#scr-tut:not([hidden]) .tut-panel');
    if (tut) {
      const r = tut.getBoundingClientRect();
      const rr = { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
      if (rr.w < w * 0.5 && rr.h > h * 0.5) { if (rr.x + rr.w / 2 < w / 2) left = rr.x + rr.w; else right = rr.x; }
      else if (rr.y + rr.h / 2 > h / 2) bottom = Math.min(bottom, rr.y); else top = Math.max(top, rr.y + rr.h);
    }
    if (right - left < w * 0.4) { left = 0; right = w; }
    if (bottom - top < h * 0.4) { top = 0; bottom = h; }
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  resize() {
    if (!this.ok) return;
    const el = this.renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const sr = this.menu ? { x: 0, y: 0, w, h } : this._safeRect(w, h);
    const pad = this.menu ? 0 : 6;
    const sw = Math.max(1, sr.w - pad * 2), sh = Math.max(1, sr.h - pad * 2);
    this.camera.aspect = sw / sh;
    this.camera.setViewOffset(sw, sh, -(sr.x + pad), -(sr.y + pad), w, h);
    this.camScale = Math.max(1, 0.92 / this.camera.aspect);
    this.resetCamera();
    this.camera.updateProjectionMatrix();
    const ratio = this._ratio();
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
      if (this.composer) {
        this.composer.setPixelRatio(ratio);
        this.composer.setSize(w, h);
        if (this.fxaaPass) this.fxaaPass.material.uniforms.resolution.value.set(1 / Math.round(w * ratio), 1 / Math.round(h * ratio));
      }
    }
  }

  pick(clientX, clientY) {
    if (!this.ok || this.menu) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.gameplay.children.filter(m => m.visible), false);
    if (!hits.length) return null;
    const u = hits[0].object.userData;
    return u && u.zone ? { zone: u.zone, index: u.index } : null;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const t of this.texCache.values()) t.dispose();
    this.texCache.clear();
    if (this.composer) this.composer.dispose();
    if (this.envTex) this.envTex.dispose();
    this.renderer.dispose();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
