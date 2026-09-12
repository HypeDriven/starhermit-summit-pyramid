/* Summit Pyramid — Three.js desert-night tableau.
 * Deterministic visual seed; gameplay meshes on a dedicated raycast layer. */

import * as THREE from '../vendor/three.module.min.js';

const CARD_W = 1, CARD_H = 1.42, CARD_T = 0.03;
const ROW_GAP = 1.06, COL_GAP = 1.06;
const CAM_HOME = { pos: [0, 10.6, 10.4], look: [0, 0, 2.1] };

const TIERS = {
  low: { pixelRatio: 1, shadows: false, stars: 900, particles: 0 },
  medium: { pixelRatio: 1.5, shadows: false, stars: 2200, particles: 200 },
  high: { pixelRatio: 2, shadows: true, stars: 4500, particles: 600 }
};

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

/* Dispose geometry + materials of a mesh. Textures are shared via texCache
   and are intentionally NOT disposed here. */
function disposeMesh(m) {
  if (!m) return;
  if (m.geometry) m.geometry.dispose();
  const mats = Array.isArray(m.material) ? m.material : (m.material ? [m.material] : []);
  for (const mat of new Set(mats)) mat.dispose();
}

export class Renderer3D {
  constructor(canvas, settings) {
    this.settings = settings;
    this.ok = false;
    this.tweens = [];
    this.cardMeshes = [];      // index 0..27 -> mesh or null
    this.particles = [];
    this.onPick = null;
    this.enabled = true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) { return; }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
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
    this.ok = true;
    const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  /* ---- environment ---- */

  buildLights() {
    this.key = new THREE.DirectionalLight(0xbfd0ff, 1.4);   // moon key
    this.key.position.set(-6, 10, 4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.key);
    this.fill = new THREE.HemisphereLight(0x334066, 0x241a10, 0.8);
    this.scene.add(this.fill);
    this.accentLight = new THREE.PointLight(0xffb35c, 12, 20); // campfire accent
    this.accentLight.position.set(4.5, 1.2, 5.5);
    this.scene.add(this.accentLight);
  }

  buildEnv(theme, seed) {
    // dispose previous
    while (this.envGroup.children.length) {
      const c = this.envGroup.children.pop();
      disposeMesh(c);
      this.envGroup.remove(c);
    }
    const rnd = mulberry((seed || 1) ^ 0x9e37);
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.sky, 18, 60);

    // sand plane
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120, 1, 1),
      new THREE.MeshStandardMaterial({ color: theme.sand, roughness: 1, metalness: 0 })
    );
    sand.rotation.x = -Math.PI / 2;
    sand.receiveShadow = true;
    this.envGroup.add(sand);

    // dunes: displaced low-poly ring hills
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
      const dist = 22 + rnd() * 18;
      const h = 2.5 + rnd() * 3.5;
      const dune = new THREE.Mesh(
        new THREE.ConeGeometry(6 + rnd() * 6, h, 7 + Math.floor(rnd() * 4)),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.sand).multiplyScalar(0.75), roughness: 1, flatShading: true })
      );
      dune.position.set(Math.cos(a) * dist, h * 0.28, Math.sin(a) * dist - 6);
      dune.rotation.y = rnd() * Math.PI;
      this.envGroup.add(dune);
    }

    // horizon glow band
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 14),
      new THREE.MeshBasicMaterial({ color: theme.horizon, transparent: true, opacity: 0.55, fog: false })
    );
    glow.position.set(0, 5, -55);
    this.envGroup.add(glow);

    // star canopy
    const n = TIERS[this.settings.tier].stars;
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
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.14, fog: false }));
    this.envGroup.add(this.stars);

    // moon disc
    const moon = new THREE.Mesh(new THREE.CircleGeometry(3, 32),
      new THREE.MeshBasicMaterial({ color: 0xe8ecf8, fog: false }));
    moon.position.set(-18, 20, -50);
    this.envGroup.add(moon);

    // campfire ember glow prop (environmental storytelling, no raycast)
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff7043, emissive: 0xff5010, emissiveIntensity: 2 }));
    fire.position.set(4.5, 0.4, 5.5);
    this.envGroup.add(fire);

    this.key.castShadow = TIERS[this.settings.tier].shadows;
    this.renderer.shadowMap.enabled = TIERS[this.settings.tier].shadows;
    this.accentLight.color.set(theme.accent);
  }

  /* ---- card textures ---- */

  cardTexture(card, cvd) {
    const key = 'c' + card + ':' + cvd;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 180;
    const g = cv.getContext('2d');
    g.fillStyle = '#f4f0e4'; g.fillRect(0, 0, 128, 180);
    g.strokeStyle = '#8a8578'; g.lineWidth = 4; g.strokeRect(3, 3, 122, 174);
    const red = card >= 13 && card < 39;
    let color = red ? '#b02020' : '#1c1c2a';
    if (cvd === 'deuter') color = red ? '#0072b2' : '#1c1c2a';
    if (cvd === 'tritan') color = red ? '#d55e00' : '#1c1c2a';
    g.fillStyle = color;
    g.font = 'bold 34px system-ui';
    g.textAlign = 'center';
    g.fillText(RANK_LABEL[card % 13], 64, 70);
    g.font = '44px system-ui';
    g.fillText(SUIT_GLYPH[Math.floor(card / 13)], 64, 130);
    g.font = 'bold 18px system-ui';
    g.textAlign = 'left'; g.fillText(RANK_LABEL[card % 13], 10, 26);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.texCache.set(key, tex);
    return tex;
  }

  backTexture(theme) {
    const key = 'back:' + theme.id;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 180;
    const g = cv.getContext('2d');
    const c = new THREE.Color(theme.cardBack);
    g.fillStyle = '#' + c.getHexString(); g.fillRect(0, 0, 128, 180);
    g.strokeStyle = '#' + new THREE.Color(theme.accent).getHexString();
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {  // original peak motif
      g.beginPath();
      g.moveTo(14, 160 - i * 30);
      g.lineTo(64, 132 - i * 30);
      g.lineTo(114, 160 - i * 30);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, tex);
    return tex;
  }

  makeCardMesh(card, theme) {
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
    const y = (6 - r) * 0.5 + 0.05;
    return [x, y, z];
  }

  buildBoard(state, theme) {
    this.theme = theme;
    while (this.gameplay.children.length) {
      const c = this.gameplay.children.pop();
      disposeMesh(c);
      this.gameplay.remove(c);
    }
    this.cardMeshes = new Array(28).fill(null);
    this.wasteTopCard = undefined;
    for (let i = 0; i < 28; i++) {
      if (state.pyramid[i] == null) continue;
      const mesh = this.makeCardMesh(state.pyramid[i], theme);
      const [x, y, z] = this.pyramidPos(i);
      mesh.position.set(x, y, z);
      mesh.rotation.x = 0.42;   // face-up, leaning toward the camera
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
    // selection marker ring
    if (this.marker) { this.scene.remove(this.marker); disposeMesh(this.marker); }
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 32),
      new THREE.MeshBasicMaterial({ color: theme.marker, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  syncState(state, selection) {
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
      if (this.settings.reducedMotion) mesh.position.set(x, targetY, z);
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
      if (this.settings.reducedMotion) this.wasteMesh.position.y = targetY;
      else this.tween(this.wasteMesh.position, { y: targetY }, 140);
    }
    // marker at first selection
    if (selection.length && this.marker) {
      const s = selection[0];
      let p = null;
      if (s.zone === 'pyramid' && this.cardMeshes[s.index]) p = this.cardMeshes[s.index].position;
      if (s.zone === 'waste' && this.wasteMesh) p = this.wasteMesh.position;
      if (p) { this.marker.position.set(p.x, 0.04, p.z); this.marker.visible = true; }
      else this.marker.visible = false;
    } else if (this.marker) this.marker.visible = false;
  }

  animateRemoval(refs, done) {
    const meshes = [];
    for (const r of refs) {
      const m = r.zone === 'waste' ? this.wasteMesh : this.cardMeshes[r.index];
      if (m) meshes.push(m);
    }
    if (this.settings.reducedMotion || !meshes.length) { done(); return; }
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
    const dt = this.clock.getDelta();
    const now = performance.now();
    this.tweens = this.tweens.filter(t => {
      const a = Math.min(1, (now - t.t0) / t.ms);
      const e = 1 - Math.pow(1 - a, 3);
      t.vec[t.key] = t.from + (t.to - t.from) * e;
      return a < 1;
    });
    if (this.stars && !this.settings.reducedMotion) this.stars.rotation.y += dt * 0.004;
    if (this.marker && this.marker.visible && !this.settings.reducedMotion)
      this.marker.material.opacity = 0.6 + 0.3 * Math.sin(now / 240);
    this.renderer.render(this.scene, this.camera);
  }

  resetCamera() {
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
    const el = this.renderer.domElement.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    const sr = this._safeRect(w, h);
    const pad = 6;
    const sw = Math.max(1, sr.w - pad * 2), sh = Math.max(1, sr.h - pad * 2);
    this.camera.aspect = sw / sh;
    this.camera.setViewOffset(sw, sh, -(sr.x + pad), -(sr.y + pad), w, h);
    this.camScale = Math.max(1, 0.92 / this.camera.aspect);
    this.resetCamera();
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[this.settings.tier].pixelRatio));
    this.renderer.setSize(w, h, false);
  }

  pick(clientX, clientY) {
    if (!this.ok) return null;
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
    this.renderer.dispose();
  }
}
