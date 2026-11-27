// Biodiversity Grassland – 3D version built FROM the approved 2D prototype (v2.2) pictures.
// The three approved pictures (levels 1, 3, 5) are turned into a 3D scene:
//  • sky, horizon, trees, farmhouse and hedge: the photo itself, as a distant curved backdrop
//  • the field: the photo laid onto the ground exactly where it is in the picture (projection)
//  • grass: 3D blades whose colours are taken from the photo at their spot
//  • flowers: 3D daisies, buttercups and clover at the positions detected in the photo
//  • species, markers, cards, texts: same positions and content as the 2D prototype
import * as THREE from './lib/three.module.min.js';
window.THREE = THREE; // the AR engine (8th Wall) will use this in the next step

// ---------------- photo camera model (shared by the 2D pictures and the 3D scene) ----------------
const IMG_W = 2172, IMG_H = 724;          // approved pictures (pixels)
const Y0 = 297;                           // horizon row in the pictures
const F = IMG_W / Math.PI;                // 180° cylindrical panorama → pixels per radian
const H0 = 0.9;                           // camera height of the photo (m), estimated from the size of the daisies (≈5 cm)
const R_BG = 25;                          // distance of the backdrop (m); ground and backdrop meet exactly there
const R_IN = 0.55, VEG_MAX = 8;           // 3D grass and flowers from 0.55 m to 8 m; beyond that the photo ground is enough
const PRODUCT_LEVEL = 3, LV = [1, 3, 5];
const SEED = 20261110;                    // fixed seed: every participant sees exactly the same scene
const START_X = 1450;                     // same start view as the 2D prototype

const D2R = Math.PI / 180;
const toImg = (az, d, h = 0) => ({ x: IMG_W / 2 + az * F, y: Y0 + F * (H0 - h) / d });
const fromImg = (x, y, h = 0) => ({ az: (x - IMG_W / 2) / F, d: F * (H0 - h) / (y - Y0) });
const world = (az, d, y = 0) => new THREE.Vector3(d * Math.sin(az), y, -d * Math.cos(az));
// edges of the unmown vegetation, exactly as used to make the approved pictures (lines through the vanishing point)
const lx = (y, xb) => 1327 + (xb - 1327) * (y - 297) / (723 - 297);
const TALL = { 1: () => false, 3: (x, y) => y > Y0 && x > lx(y, 1880), 5: (x, y) => y > Y0 && x > lx(y, 760) };

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const smooth = (x) => x * x * (3 - 2 * x);

// ---------------- renderer ----------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;   // keep the photo's colours unchanged
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 80);
scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x8a9a62, 1.6));
const sun = new THREE.DirectionalLight(0xfff4e2, 1.5); sun.position.set(2, 5, 3); scene.add(sun);
// Preview only: a neutral floor around the scene (in AR: the real room)
const previewFloor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: 0x9d9b95 }));
previewFloor.rotation.x = -Math.PI / 2; previewFloor.position.y = -0.004; scene.add(previewFloor);

// ---------------- loading ----------------
const texLoader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res, rej) => texLoader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
function imageData(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height); }
const _c = new THREE.Color();
function sample(data, x, y) {          // photo colour at picture pixel (x, y); below the picture, mirror the bottom rows
  if (y > IMG_H - 1) { const k = (y - (IMG_H - 1)) % 300; y = IMG_H - 1 - (k < 150 ? k : 300 - k); }
  const xi = Math.max(0, Math.min(IMG_W - 1, Math.round(x))), yi = Math.max(0, Math.min(IMG_H - 1, Math.round(y)));
  const i = (yi * IMG_W + xi) * 4; return _c.setRGB(data.data[i] / 255, data.data[i + 1] / 255, data.data[i + 2] / 255, THREE.SRGBColorSpace).clone();
}

// shared level weights (cross-fade between levels)
const U = { uFrom: { value: new THREE.Vector3(0, 1, 0) }, uTo: { value: new THREE.Vector3(0, 1, 0) }, uT: { value: 1 }, uTime: { value: 0 } };

// ---------------- photo ground and backdrop ----------------
const photoFrag = (sampler) => /* glsl */`
  uniform sampler2D tG1, tG3, tG5, tP1, tP3, tP5; uniform vec3 uFrom, uTo; uniform float uT;
  vec3 pick(vec2 uv, float d) {
    vec3 w = mix(uFrom, uTo, smoothstep(0.0, 1.0, uT));
    vec3 g = texture2D(tG1, uv).rgb * w.x + texture2D(tG3, uv).rgb * w.y + texture2D(tG5, uv).rgb * w.z;
    vec3 p = texture2D(tP1, uv).rgb * w.x + texture2D(tP3, uv).rgb * w.y + texture2D(tP5, uv).rgb * w.z;
    return mix(g, p, smoothstep(${VEG_MAX.toFixed(1)}, ${(VEG_MAX + 2).toFixed(1)}, d));   // near: flowers are 3D, so use the flower-free photo
  }`;
function photoUniforms(tex) { return { ...U, tG1: { value: tex.g1 }, tG3: { value: tex.g3 }, tG5: { value: tex.g5 }, tP1: { value: tex.p1 }, tP3: { value: tex.p3 }, tP5: { value: tex.p5 } }; }
function buildPhotoScene(tex) {
  // ground: every pixel looks up where it appears in the photo
  const groundGeo = new THREE.RingGeometry(R_IN - 0.15, R_BG, 240, 90, -0.05, Math.PI + 0.1); groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.ShaderMaterial({
    uniforms: photoUniforms(tex), transparent: true, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
    fragmentShader: photoFrag() + /* glsl */`
      varying vec3 vW;
      void main(){
        float az = atan(vW.x, -vW.z); float d = length(vW.xz);
        float x = ${(IMG_W / 2).toFixed(1)} + az * ${F.toFixed(4)};
        float y = ${Y0.toFixed(1)} + ${(F * H0).toFixed(4)} / d;
        if (y > ${IMG_H - 1}.0) { float k = mod(y - ${IMG_H - 1}.0, 300.0); y = ${IMG_H - 1}.0 - (k < 150.0 ? k : 300.0 - k); }
        vec2 uv = vec2(x / ${IMG_W}.0, 1.0 - y / ${IMG_H}.0);
        float a = smoothstep(${(R_IN - 0.15).toFixed(2)}, ${(R_IN + 0.15).toFixed(2)}, d) * (1.0 - smoothstep(1.5208, 1.5708, abs(az)));
        gl_FragColor = vec4(pick(uv, d), a);
        #include <colorspace_fragment>
      }`
  });
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.renderOrder = -1; scene.add(ground);

  // backdrop: the photo above the field (sky, horizon, trees, farmhouse, hedge), on a curved wall 25 m away
  const cols = 180, top = H0 + R_BG * Y0 / F, rows = 24, pos = [], uv = [], idx = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const az = (-90 + 180 * i / cols) * D2R, y = top * j / rows, p = world(az, R_BG, y);
    pos.push(p.x, p.y, p.z); uv.push((IMG_W / 2 + az * F) / IMG_W, 1 - (Y0 - F * (y - H0) / R_BG) / IMG_H);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx);
  const bgMat = new THREE.ShaderMaterial({
    uniforms: photoUniforms(tex), side: THREE.DoubleSide,
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: photoFrag() + /* glsl */`varying vec2 vUv; void main(){ gl_FragColor = vec4(pick(vUv, 99.0), 1.0);
      #include <colorspace_fragment>
    }`
  });
  scene.add(new THREE.Mesh(bg, bgMat));
}

// ---------------- 3D grass coloured from the photo ----------------
function buildGrass(img) {
  const A = { off: [], rot: [], h: [], c1: [], c3: [], c5: [], w: [], bend: [], lean: [] };
  const add = (az, d, hs, mid, w, bend, lean) => {
    const p = world(az, d), x = IMG_W / 2 + az * F;
    A.off.push(p.x, p.z); A.rot.push(rand() * Math.PI * 2); A.h.push(...hs); A.w.push(w); A.bend.push(bend); A.lean.push(lean);
    [[A.c1, img.g1, 0], [A.c3, img.g3, 1], [A.c5, img.g5, 2]].forEach(([arr, data, k]) => {
      const hm = Math.max(hs[k], 0.03) * mid, y = Y0 + F * (H0 - hm) / d;
      const c = sample(data, x + rr(-2, 2), y + rr(-2, 2)); arr.push(c.r, c.g, c.b);
    });
  };
  const edge = (az, d) => Math.min(smooth(Math.min(1, (d - R_IN) / 0.35)), smooth(Math.min(1, (90 * D2R - Math.abs(az)) / (5 * D2R))), smooth(Math.min(1, (VEG_MAX - d) / 2)));
  const logD = () => R_IN * Math.pow(VEG_MAX / R_IN, Math.pow(rand(), 1.15));
  // base sward everywhere (short where mown, medium where unmown)
  for (let i = 0; i < 46000; i++) {
    const az = rr(-90, 90) * D2R, d = logD(), e = edge(az, d); if (rand() > 0.15 + 0.85 * e) continue;
    const { x, y } = toImg(az, d);
    const hs = LV.map(lv => (TALL[lv](x, y) ? rr(0.12, 0.26) : (lv === 1 ? rr(0.025, 0.05) : rr(0.03, 0.06))) * (0.5 + 0.5 * e));
    add(az, d, hs, 0.6, rr(0.006, 0.011), rr(0.05, 0.35), rr(-0.15, 0.15));
  }
  // tall grasses where the pictures show unmown vegetation (they disappear when mown)
  for (let i = 0, n = 0; i < 60000 && n < 7000; i++) {
    const az = rr(-90, 90) * D2R, d = logD(); const { x, y } = toImg(az, d); if (!TALL[5](x, y)) continue;
    const e = edge(az, d) * smooth(Math.min(1, (d - R_IN) / 1.0)); if (rand() > e) continue; n++;   // fewer tall stems right in front of the viewer
    const t = rr(0.25, 0.5) * (0.6 + 0.4 * e);
    add(az, d, LV.map(lv => (TALL[lv](x, y) ? t : 0)), 0.45, rr(0.004, 0.008), rr(0.1, 0.4), rr(-0.15, 0.15));
  }
  const geo = new THREE.InstancedBufferGeometry();
  { const ys = [0, 0.25, 0.5, 0.75], pos = [], idx = []; ys.forEach(y => pos.push(-0.5, y, 0, 0.5, y, 0)); pos.push(0, 1, 0);
    for (let k = 0; k < 3; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } idx.push(6, 7, 8);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); }
  const ib = (arr, n) => new THREE.InstancedBufferAttribute(new Float32Array(arr), n);
  geo.setAttribute('aOffset', ib(A.off, 2)); geo.setAttribute('aRot', ib(A.rot, 1)); geo.setAttribute('aH', ib(A.h, 3));
  geo.setAttribute('aC1', ib(A.c1, 3)); geo.setAttribute('aC3', ib(A.c3, 3)); geo.setAttribute('aC5', ib(A.c5, 3));
  geo.setAttribute('aWidth', ib(A.w, 1)); geo.setAttribute('aBend', ib(A.bend, 1)); geo.setAttribute('aLean', ib(A.lean, 1));
  geo.instanceCount = A.w.length;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: U,
    vertexShader: /* glsl */`
      attribute vec2 aOffset; attribute float aRot; attribute vec3 aH; attribute vec3 aC1; attribute vec3 aC3; attribute vec3 aC5; attribute float aWidth; attribute float aBend; attribute float aLean;
      uniform float uTime, uT; uniform vec3 uFrom, uTo; varying vec3 vCol; varying float vY;
      void main() {
        vec3 w = mix(uFrom, uTo, smoothstep(0.0, 1.0, uT));
        float h = dot(aH, w); float y = position.y;
        vec3 p = vec3(position.x * aWidth * (1.0 - 0.8 * y), y * h, 0.0);
        p.z += aBend * y * y * h; p.x += aLean * y * h;
        float c = cos(aRot), s = sin(aRot); p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
        float wind = sin(uTime * 1.7 + aOffset.x * 0.9 + aOffset.y * 0.7) + 0.5 * sin(uTime * 3.1 + aOffset.x * 2.3);
        float amp = 0.06 * smoothstep(0.08, 0.6, h); p.x += wind * amp * y * y; p.z += wind * amp * 0.5 * y * y;
        vCol = aC1 * w.x + aC3 * w.y + aC5 * w.z; vY = y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p + vec3(aOffset.x, 0.0, aOffset.y), 1.0);
      }`,
    fragmentShader: /* glsl */`varying vec3 vCol; varying float vY;
      void main() { gl_FragColor = vec4(vCol * mix(0.62, 1.08, pow(vY, 0.6)), 1.0);
        #include <colorspace_fragment>
      }`
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; scene.add(m);
  return A.w.length;
}

// ---------------- 3D flowers at the positions detected in the photo ----------------
const FL = [];
const HEADS = {}; let stems = null;
function buildFlowers(list) {
  const H = { daisy: [0.4, 0.52], butter: [0.36, 0.5], clover: [0.26, 0.36] };
  for (const f of list) {
    const hf = rr(...H[f.t]); if (f.y <= Y0 + 2) continue;
    const { az, d } = fromImg(f.x, f.y, hf); if (!(d > R_IN && d < VEG_MAX) || Math.abs(az) > 89 * D2R) continue;
    const size = THREE.MathUtils.clamp(f.w * d / F, 0.035, 0.07);
    const p = world(az, d), toViewer = Math.atan2(-p.x, -p.z);   // flower heads turned towards the viewer, as in the photo
    FL.push({ type: f.t, p, h: hf, size, vis: [0, f.v3, 1], yaw: f.t === 'clover' ? rand() * 6.28 : toViewer + rr(-0.4, 0.4), tilt: f.t === 'daisy' ? rr(0.5, 0.95) : rr(0.15, 0.4), top: new THREE.Vector3() });
  }
  const daisyTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64);
    for (let i = 0; i < 24; i++) { g.save(); g.rotate(i / 24 * Math.PI * 2); g.fillStyle = i % 2 ? '#f4f2ec' : '#ffffff'; g.beginPath(); g.ellipse(0, -36, 5.5, 25, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    g.fillStyle = '#e9b41b'; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const cloverTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#b0708e'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 300; i++) { g.fillStyle = ['#d396b3', '#93506f', '#e6b8cc', '#bd7898'][i % 4]; g.fillRect(Math.random() * 64, Math.random() * 64, 3, 3); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const count = (t) => FL.filter(f => f.type === t).length;
  const stemGeo = new THREE.CylinderGeometry(0.0016, 0.0024, 1, 4, 1, true); stemGeo.translate(0, 0.5, 0);
  stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x6a8f3a }), FL.length);
  const daisyGeo = new THREE.CircleGeometry(0.5, 18); daisyGeo.rotateX(-Math.PI / 2);
  HEADS.daisy = new THREE.InstancedMesh(daisyGeo, new THREE.MeshBasicMaterial({ map: daisyTex, alphaTest: 0.4, side: THREE.DoubleSide }), count('daisy'));
  HEADS.butter = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), new THREE.MeshLambertMaterial({ color: 0xf0bf1a, emissive: 0x6a5000, side: THREE.DoubleSide }), count('butter'));
  HEADS.clover = new THREE.InstancedMesh((() => { const g = new THREE.SphereGeometry(0.4, 10, 8); g.scale(1, 1.25, 1); return g; })(), new THREE.MeshLambertMaterial({ map: cloverTex, emissive: 0x2a1420 }), count('clover'));
  [stems, ...Object.values(HEADS)].forEach(m => { m.frustumCulled = false; scene.add(m); });
  const counters = { daisy: 0, butter: 0, clover: 0 }; FL.forEach(f => { f.hi = counters[f.type]++; });
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function updateFlowers(wFrom, wTo, t) {
  if (!stems) return;
  for (let i = 0; i < FL.length; i++) {
    const f = FL[i];
    const a = f.vis[0] * wFrom[0] + f.vis[1] * wFrom[1] + f.vis[2] * wFrom[2], b = f.vis[0] * wTo[0] + f.vis[1] * wTo[1] + f.vis[2] * wTo[2];
    const s = Math.max(1e-4, a + (b - a) * t);
    _p.set(f.p.x, 0, f.p.z); _e.set(f.tilt * 0.3, f.yaw, 0, 'YXZ'); _q.setFromEuler(_e); _s.set(1, f.h * s, 1); _m.compose(_p, _q, _s); stems.setMatrixAt(i, _m);
    f.top.set(0, f.h * s, 0).applyQuaternion(_q).add(_p);
    _e.set(f.type === 'clover' ? 0 : f.tilt, f.yaw, 0, 'YXZ'); _q.setFromEuler(_e); _s.setScalar(s * f.size); _m.compose(f.top, _q, _s); HEADS[f.type].setMatrixAt(f.hi, _m);
  }
  stems.instanceMatrix.needsUpdate = true; Object.values(HEADS).forEach(m => { m.instanceMatrix.needsUpdate = true; });
}

// ---------------- species: same positions and on-screen size as the 2D prototype ----------------
// 2D prototype placement (picture pixels): x, y = centre of the species picture, h = its height in pixels
const SPECIES_2D = {
  3: { bee: { x: 1990, y: 500, h: 36, flip: true }, butterfly: { x: 1735, y: 448, h: 40 } },
  5: { bee: { x: 1330, y: 505, h: 37 }, butterfly: { x: 1690, y: 452, h: 44, flip: true }, bird: { x: 520, y: 470, h: 52 } }
};
const FLY_H = { bee: 0.4, butterfly: 0.42 };          // assumed height above ground of the insects (m)
// 2D markers of landscape elements (picture pixels), as in prototype v2.2
const POINTS_2D = {
  1: [['mown', 760, 470], ['margin', 1800, 395], ['hedge', 1960, 225]],
  3: [['flower', 2070, 545], ['margin', 1542, 440], ['hedge', 1960, 225]],
  5: [['flower', 1840, 540], ['strip', 1480, 515], ['margin', 1126, 440], ['hedge', 1960, 225]]
};
function pointTo3D(x, y) {   // marker position: on the ground (just above the grass) or, above the horizon, on the backdrop
  if (y <= Y0 + 3) { const az = (x - IMG_W / 2) / F; return world(az, R_BG - 0.5, H0 + R_BG * (Y0 - y) / F); }
  const { az, d } = fromImg(x, y, 0.12); return world(az, d, 0.12);
}

function loftGeometry(prof, lengthM, depthRatio) {   // rounded 3D body from the outline of the side-view picture, coloured by that picture
  const W = prof.w, H = prof.h; let cols = prof.cols.filter(c => c[1] !== null);
  const first = cols[0], last = cols[cols.length - 1];
  cols = [[first[0], (first[1] + first[2]) / 2, (first[1] + first[2]) / 2], ...cols, [last[0], (last[1] + last[2]) / 2, (last[1] + last[2]) / 2]];
  const x0 = first[0] * W, x1 = last[0] * W, S = lengthM / (x1 - x0), cx = (x0 + x1) / 2, M = 16, pos = [], uv = [], idx = [];
  cols.forEach(c => { const xpx = c[0] * W, top = c[1] * H, bot = c[2] * H, yc = (top + bot) / 2, ry = (bot - top) / 2, rz = ry * depthRatio;
    for (let j = 0; j <= M; j++) { const a = j / M * Math.PI * 2, yimg = yc - ry * Math.cos(a); pos.push((xpx - cx) * S, -yimg * S, rz * Math.sin(a) * S); uv.push(c[0], 1 - yimg / H); } });
  for (let i = 0; i < cols.length - 1; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, S, cx };
}
const imgToModel = (L, px, py) => new THREE.Vector3((px - L.cx) * L.S, -py * L.S, 0);

const animals = []; window.__ar3dAnimals = animals;
function makeBee(beeTex, wingTex, wingInfo, prof, lengthM) {
  const L = loftGeometry(prof.bee, lengthM, 0.85);
  const inner = new THREE.Group(); const body = new THREE.Mesh(L.geo, new THREE.MeshLambertMaterial({ map: beeTex, side: THREE.DoubleSide })); inner.add(body);
  const [wx0, wx1, wy0, wy1] = wingInfo.bbox; const wW = (wx1 - wx0) * L.S, wH = (wy1 - wy0) * L.S;
  const wingGeo = new THREE.PlaneGeometry(wW, wH); wingGeo.translate(-(wx1 - wx0) * 0.25 * L.S, wH / 2, 0);
  const wingMat = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85 });
  const wings = [1, -1].map(sgn => { const piv = new THREE.Group(); piv.position.copy(imgToModel(L, (wx0 + wx1) / 2 + (wx1 - wx0) * 0.25, wy1)); piv.add(new THREE.Mesh(wingGeo, wingMat)); piv.userData.sgn = sgn; inner.add(piv); return piv; });
  const ctr = new THREE.Box3().setFromObject(body).getCenter(new THREE.Vector3()); inner.position.sub(ctr);
  const g = new THREE.Group(); g.add(inner); return { g, wings };
}
function makeButterfly(tex, span) {
  const W = 1536, H = 1024, xL = 97, xC = 765.5, xR = 1434, yT = 49, yB = 958, S = span / (xR - xL);
  const mk = (u0, u1, left) => { const w = (u1 - u0) * S, h = (yB - yT) * S, g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) ? u1 : u0) / W, 1 - (uv.getY(i) ? yT : yB) / H);
    g.translate(left ? -w / 2 : w / 2, 0, 0); g.rotateX(-Math.PI / 2); return g; };
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const pl = new THREE.Group(), pr = new THREE.Group(); pl.add(new THREE.Mesh(mk(xL, xC, true), mat)); pr.add(new THREE.Mesh(mk(xC, xR, false), mat));
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(span * 0.035, span * 0.28, 4, 8), new THREE.MeshLambertMaterial({ color: 0x3b2a1c })); body.rotation.x = Math.PI / 2;
  const g = new THREE.Group(); g.add(pl, pr, body); return { g, pl, pr };
}
function makeBird(tex, prof, lengthM) {
  const L = loftGeometry(prof.skylark, lengthM, 0.55);
  const inner = new THREE.Group(); inner.add(new THREE.Mesh(L.geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })));
  const legMat = new THREE.MeshLambertMaterial({ color: 0xc49a86 }); let footY = 0; const sc = lengthM / 0.23;
  prof.skylark.legs.forEach(leg => {
    const a = imgToModel(L, leg.top[0] * prof.skylark.w, leg.top[1] * prof.skylark.h), b = imgToModel(L, leg.foot[0] * prof.skylark.w, leg.foot[1] * prof.skylark.h); footY = Math.min(footY, b.y);
    [-0.012 * sc, 0.012 * sc].forEach(z => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0022 * sc, 0.0022 * sc, a.distanceTo(b), 5), legMat);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.position.z = z; m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); inner.add(m);
      for (let t = -1; t <= 1; t++) { const toe = new THREE.Mesh(new THREE.CylinderGeometry(0.0012 * sc, 0.0012 * sc, 0.022 * sc, 4), legMat); toe.rotation.z = Math.PI / 2; toe.rotation.y = t * 0.45; toe.position.set(b.x - 0.008 * sc, b.y + 0.001, z); inner.add(toe); }
    });
  });
  inner.position.y = -footY; inner.userData.baseY = -footY;
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(20,24,12,.5)'); r.addColorStop(1, 'rgba(20,24,12,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(lengthM * 0.45, 24), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.004; shadow.scale.set(1.2, 0.7, 1);
  const g = new THREE.Group(); g.add(inner, shadow); return { g, inner };
}

async function buildAnimals(prof, tx, wingInfo) {
  for (const [lvs, spec] of Object.entries(SPECIES_2D)) for (const [kind, s] of Object.entries(spec)) {
    const lv = Number(lvs); let a;
    if (kind === 'bird') {
      const yFeet = s.y + s.h / 2, { az, d } = fromImg(s.x, yFeet, 0);
      const len = s.h * (1312 / 1199) * 0.795 * d / F;                              // same on-screen size as in the 2D picture
      const b = makeBird(tx.lark, prof, len); b.g.position.copy(world(az, d));
      const baseYaw = -az;                                                           // side-on to the viewer, head to the left as in the picture
      a = { kind, lv, g: b.g, inner: b.inner, home: b.g.position.clone(), baseYaw, yaw: baseYaw, targetYaw: baseYaw, timer: 2, action: 'idle', t: 0,
        pinOffset: (s.h + 18) * d / F };
    } else {
      const hI = FLY_H[kind], { az, d } = fromImg(s.x, s.y, hI);
      if (kind === 'bee') { const len = s.h * 1.5 * 0.5625 * d / F; const b = makeBee(tx.bee, tx.wing, wingInfo, prof, len); a = { kind, lv, g: b.g, wings: b.wings }; a.g.rotation.y = -az + (s.flip ? Math.PI : 0); }
      else { const span = s.h * 1.5 * 0.87 * d / F; const b = makeButterfly(tx.bfly, span); a = { kind, lv, g: b.g, pl: b.pl, pr: b.pr }; a.g.rotation.y = -az; }
      a.home = world(az, d, hI); a.g.position.copy(a.home); a.pinOffset = (s.h * 0.5 + 18) * d / F;
    }
    a.presence = lv === PRODUCT_LEVEL ? 1 : 0; a.phase = rand() * 10; scene.add(a.g); animals.push(a);
  }
}
function updateAnimals(dt, time) {
  for (const a of animals) {
    const want = a.lv === curLevel ? 1 : 0; a.presence += (want - a.presence) * Math.min(1, dt * 3);
    a.g.visible = a.presence > 0.02; a.g.scale.setScalar(Math.max(0.001, a.presence)); if (!a.g.visible) continue;
    const t = time + a.phase;
    if (a.kind === 'bee') {            // hovers around its spot among the flowers
      a.g.position.set(a.home.x + Math.sin(t * 0.9) * 0.05, a.home.y + Math.sin(t * 2.1) * 0.025, a.home.z + Math.sin(t * 1.3) * 0.04);
      const flap = 0.25 + 1.05 * Math.abs(Math.sin(t * 38)); a.wings.forEach(w => { w.rotation.x = w.userData.sgn * flap; });
    } else if (a.kind === 'butterfly') { // rests on its flower with open wings (as in the picture), now and then a short flutter
      const cycle = t % 9, flying = cycle > 7;
      const open = flying ? 0.15 + 1.1 * Math.abs(Math.sin(t * 13)) : 0.25 + 0.12 * Math.sin(t * 1.4) + (cycle > 5.5 && cycle < 6 ? 0.9 : 0);
      a.pl.rotation.z = -open; a.pr.rotation.z = open;
      const k = flying ? Math.sin((cycle - 7) / 2 * Math.PI) : 0; a.g.position.set(a.home.x + k * 0.08, a.home.y + k * 0.1, a.home.z);
    } else {                           // skylark: pecks, turns a little, hops
      a.timer -= dt; a.t += dt;
      if (a.timer <= 0) { const r = rand(); a.t = 0;
        if (r < 0.45) { a.action = 'peck'; a.timer = 0.7; } else if (r < 0.75) { a.action = 'turn'; a.targetYaw = a.baseYaw + rr(-0.35, 0.35); a.timer = 0.6; }
        else { a.action = 'idle'; a.timer = rr(1.5, 3.5); } }
      a.yaw += (a.targetYaw - a.yaw) * Math.min(1, dt * 6); a.g.rotation.y = a.yaw;
      a.inner.rotation.z = a.action === 'peck' ? Math.sin(Math.min(1, a.t / 0.7) * Math.PI) * 0.45 : 0;
    }
  }
}

// ---------------- markers, cards, levels (same content as prototype v2.2) ----------------
const levels = {
  1: { short: 'Low', line: 'Frequent mowing and high fertilisation → few plants, insects and birds.' },
  3: { short: 'Moderate', line: 'Moderate mowing with a flower-rich margin → habitat for several species.' },
  5: { short: 'Very high', line: 'Extensive management with wide flower-rich areas → rich habitat for many species.' }
};
const hotspots = {
  mown: { type: 'Grassland element', icon: '≡', title: 'Frequently mown grassland', text: 'Frequent mowing and high fertilisation favour a few fast-growing grasses, so flowering plants have little time to bloom.', link: 'Main effect: few food resources for insects and little cover for ground-nesting birds.' },
  flower: { type: 'Species', icon: '✿', title: 'Meadow flowers', text: 'Flower-rich areas provide food and habitat for insects and support a more diverse grassland ecosystem.', link: 'Linked practice: allowing grassland plants time to flower before mowing.' },
  bee: { type: 'Species', icon: '⌁', title: 'Bee', text: 'Bees benefit from flowering grasslands because they depend on pollen and nectar resources.', link: 'Linked practice: maintaining flower resources throughout the season.' },
  butterfly: { type: 'Species', icon: '⋈', title: 'Butterfly', text: 'Butterflies benefit from less intensive grassland management and the presence of flowering plants.', link: 'Linked practice: reducing mowing pressure and retaining flowering vegetation.' },
  bird: { type: 'Species', icon: '♩', title: 'Grassland bird', text: 'Ground-nesting birds such as skylarks need sufficient time and undisturbed space to breed successfully in grassland.', link: 'Linked practice: later or less frequent mowing during the nesting period.' },
  strip: { type: 'Grassland element', icon: '≋', title: 'Flower strip', text: 'Leaving parts of the grassland unmown allows more flowers to bloom and provides food and shelter for wildlife.', link: 'Main effect: continuous refuge and feeding areas within the managed meadow.' },
  margin: { type: 'Grassland element', icon: '↟', title: 'Field margin', text: 'Field margins provide structure, shelter, and resources for a variety of plants, insects, and birds.', link: 'Main effect: a transition zone between productive grassland and surrounding habitat.' },
  hedge: { type: 'Grassland element', icon: '♧', title: 'Hedgerow', text: 'Hedgerows create habitat, provide shelter, and improve landscape connectivity for many species.', link: 'Main effect: connected habitat for movement, nesting, and protection.' }
};
const LABEL = { mown: 'Mown area', flower: 'Meadow flowers', bee: 'Bee', butterfly: 'Butterfly', bird: 'Grassland bird', strip: 'Flower strip', margin: 'Field margin', hedge: 'Hedgerow' };
const OVERRIDES = { 1: { margin: { title: 'No field margin', label: 'No field margin', text: 'The grassland is managed right up to the edge, so no unmown margin is left for shelter or food.', link: 'Main effect: less refuge and fewer resources for insects and birds.' } } };
const SPRITE = { bee: 'assets/bee.png', butterfly: 'assets/butterfly.png', bird: 'assets/skylark.png' };
const $ = (s) => document.querySelector(s);
const pinLayer = $('#pins'), sceneEl = $('#scene');
const hotspotCard = $('#hotspotCard'), seenCount = $('#seenCount'), badge = $('#badge'), productPill = $('#productPill'), levelLine = $('#levelLine');
const pinEls = [];
function makePin(lv, id, at, species) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pin pin3d' + (species ? ' pin--species' : ''); b.dataset.hotspot = id; b.dataset.level = lv;
  const lab = OVERRIDES[lv]?.[id]?.label || LABEL[id]; b.setAttribute('aria-label', `Learn about: ${lab}`); b.innerHTML = `<span class="pin-label">${lab}</span>`;
  pinLayer.append(b); pinEls.push({ el: b, at, lv: Number(lv), id }); b.addEventListener('click', (e) => { e.stopPropagation(); openCard(b); });
}
function buildPins() {
  for (const lv of LV) {
    for (const a of animals.filter(a => a.lv === lv)) makePin(lv, a.kind, () => a.g.position.clone().add(new THREE.Vector3(0, a.pinOffset, 0)), true);
    for (const [id, x, y] of POINTS_2D[lv]) { const p = pointTo3D(x, y); makePin(lv, id, () => p, false); }
  }
}
const _v = new THREE.Vector3();
const overlap = (a, b, m = 4) => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;
function updatePins() {
  const sb = sceneEl.getBoundingClientRect(), w = sb.width, h = sb.height;
  const ui = ['#badge', '#productPill', '.score-dock', '#statusPill', '#topHint', '#fsBtn', '#hotspotCard'].map(s => $(s)).filter(n => n && !n.hidden && !n.classList.contains('is-faded')).map(n => n.getBoundingClientRect());
  const placed = [];
  for (const p of pinEls) {
    if (p.lv !== curLevel) { p.el.hidden = true; continue; }
    p.el.hidden = false; _v.copy(p.at()).project(camera);
    const x = (_v.x + 1) / 2 * w, y = (1 - _v.y) / 2 * h;
    p.el.style.left = `${x}px`; p.el.style.top = `${y}px`;
    const behind = _v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1;
    const dot = { left: sb.left + x - 14, right: sb.left + x + 14, top: sb.top + y - 14, bottom: sb.top + y + 14 };
    const underUi = ui.some(r => overlap(dot, r, 2));
    p.el.dataset.off = behind || underUi ? '1' : '0'; if (behind || underUi) continue;
    // label: right of the marker, else left, else hidden (never on top of the interface or another label)
    p.el.classList.remove('no-label'); let ok = false;
    for (const left of [x > w * 0.62, !(x > w * 0.62)]) {
      p.el.classList.toggle('label-left', left);
      const r = p.el.querySelector('.pin-label').getBoundingClientRect();
      if (!ui.some(u => overlap(r, u)) && !placed.some(q => overlap(r, q)) && r.left > sb.left && r.right < sb.right) { placed.push(r, dot); ok = true; break; }
    }
    if (!ok) { p.el.classList.add('no-label'); placed.push(dot); }
  }
}

// ---------------- interaction log ----------------
const t0 = performance.now(); const log = [];
let curLevel = PRODUCT_LEVEL;
const record = (type, id, extra = {}) => log.push({ t_ms: Math.round(performance.now() - t0), type, id, level: curLevel, ...extra });

// ---------------- levels ----------------
const seen = new Set();
const idsAt = (lv) => [...new Set(pinEls.filter(p => p.lv === lv).map(p => p.id))];
function updateCounter() { const ids = idsAt(curLevel); seenCount.textContent = `${ids.filter(id => seen.has(`${curLevel}:${id}`)).length} of ${ids.length} explored`; }
const onehot = (lv) => [lv === 1 ? 1 : 0, lv === 3 ? 1 : 0, lv === 5 ? 1 : 0];
let wFrom = onehot(PRODUCT_LEVEL), wTo = onehot(PRODUCT_LEVEL), tAnim = 1;
function setLevel(level, initial = false) {
  const changed = level !== curLevel;
  if (changed) { const k = smooth(Math.min(1, tAnim)); wFrom = wFrom.map((a, i) => a + (wTo[i] - a) * k); wTo = onehot(level); tAnim = 0; }
  curLevel = level;
  badge.dataset.level = String(level); $('#badgeNumber').textContent = String(level);
  $('#badgeLevel').textContent = `Level ${level} · ${levels[level].short}`; badge.setAttribute('aria-label', `Biodiversity label, level ${level} out of 5`);
  if (changed && !initial) { badge.classList.remove('is-changing'); void badge.offsetWidth; badge.classList.add('is-changing'); }
  const isProduct = level === PRODUCT_LEVEL;
  productPill.textContent = isProduct ? `This product · Level ${PRODUCT_LEVEL}` : `Showing level ${level} · This product is level ${PRODUCT_LEVEL}`;
  productPill.classList.toggle('is-comparison', !isProduct);
  levelLine.innerHTML = `<strong>Level ${level}:</strong> ${levels[level].line}` + (isProduct ? '' : ' <span class="cmp">(comparison)</span>');
  document.querySelectorAll('.level-button:not([disabled])').forEach(btn => { const a = Number(btn.dataset.level) === level; btn.classList.toggle('is-active', a); btn.setAttribute('aria-pressed', String(a)); });
  pinEls.forEach(p => p.el.classList.toggle('is-seen', seen.has(`${p.lv}:${p.id}`)));
  updateCounter(); closeCard();
}
document.querySelectorAll('.level-button:not([disabled])').forEach(btn => btn.addEventListener('click', (e) => {
  e.stopPropagation(); const lv = Number(btn.dataset.level); if (lv === curLevel) return;
  record('level', `level_${lv}`, { from: curLevel }); setLevel(lv);
}));

// ---------------- cards: high up, on the side away from the tapped point ----------------
let activeTarget = null;
function positionCard() {
  if (hotspotCard.hidden || !activeTarget) return;
  const sb = sceneEl.getBoundingClientRect(), tb = activeTarget.getBoundingClientRect(), dock = $('.score-dock').getBoundingClientRect(), bB = badge.getBoundingClientRect();
  const cw = hotspotCard.offsetWidth, m = 16, onRight = (tb.left + tb.right) / 2 - sb.left > sb.width / 2;
  let left = onRight ? m : sb.width - cw - m;
  if (onRight && left + cw > bB.left - sb.left - 8) left = Math.max(m, bB.left - sb.left - cw - 8);
  if (!onRight && left < bB.right - sb.left + 8) left = Math.min(sb.width - cw - m, bB.right - sb.left + 8);
  const top = Math.max(16, $('#topHint').classList.contains('is-faded') ? 16 : $('#topHint').getBoundingClientRect().bottom - sb.top + 10);
  hotspotCard.style.left = `${left}px`; hotspotCard.style.top = `${top}px`; hotspotCard.style.maxHeight = `${Math.max(120, dock.top - sb.top - top - 20)}px`;
}
function openCard(target) {
  const key = target.dataset.hotspot, info = { ...hotspots[key], ...(OVERRIDES[curLevel]?.[key] || {}) };
  activeTarget = target; hotspotCard.hidden = false; seen.add(`${curLevel}:${key}`); target.classList.add('is-seen'); updateCounter(); record('point', key);
  $('#hotspotType').textContent = info.type; $('#hotspotIcon').innerHTML = SPRITE[key] ? `<img src="${SPRITE[key]}" alt="" />` : info.icon;
  $('#hotspotTitle').textContent = info.title; $('#hotspotText').textContent = info.text; $('#hotspotLink').textContent = info.link;
  hotspotCard.scrollTop = 0; positionCard();
}
function closeCard() { activeTarget = null; hotspotCard.hidden = true; }
$('#closeHotspot').addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });

// ---------------- preview camera: starts exactly where the photo was taken (in AR: the participant's own position) ----------------
let yaw = (START_X - IMG_W / 2) / F, pitch = -4.3 * D2R; const camPos = new THREE.Vector3(0, H0, 0);
function updateCamera() { camera.position.copy(camPos); camera.lookAt(camPos.x + Math.sin(yaw) * Math.cos(pitch), camPos.y + Math.sin(pitch), camPos.z - Math.cos(yaw) * Math.cos(pitch)); }
function step(d) { camPos.x = THREE.MathUtils.clamp(camPos.x + Math.sin(yaw) * d, -2, 2); camPos.z = THREE.MathUtils.clamp(camPos.z - Math.cos(yaw) * d, -3, 0.5); }
const pointers = new Map(); let dragMoved = 0, pinchD = 0;
canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragMoved = 0; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId); if (!prev) return;
  if (pointers.size === 1) { const dx = e.clientX - prev.x, dy = e.clientY - prev.y; dragMoved += Math.abs(dx) + Math.abs(dy);
    yaw = THREE.MathUtils.clamp(yaw - dx * 0.004, -80 * D2R, 80 * D2R); pitch = THREE.MathUtils.clamp(pitch + dy * 0.003, -65 * D2R, 20 * D2R); }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchD) step((d - pinchD) * 0.006); pinchD = d; }
});
const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchD = 0; };
canvas.addEventListener('pointerup', (e) => { endPointer(e); if (dragMoved < 6) closeCard(); });
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); step(-e.deltaY * 0.002); }, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'w') step(0.1); if (e.key === 'ArrowDown' || e.key === 's') step(-0.1);
  if (e.key === 'ArrowLeft' || e.key === 'a') yaw = Math.max(-80 * D2R, yaw - 0.06); if (e.key === 'ArrowRight' || e.key === 'd') yaw = Math.min(80 * D2R, yaw + 0.06);
  if (e.key === 'Escape') closeCard();
});

// ---------------- full screen ----------------
const toast = $('#toast'); let toastTimer = 0;
function showToast(msg) { toast.textContent = msg; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 6000); }
$('#fsBtn').addEventListener('click', async (e) => {
  e.stopPropagation(); const el = document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen(); else throw new Error('unsupported');
  } catch (_) { showToast('Full screen is not available here. On iPhone: open the link in Safari, tap Share → "Add to Home Screen", then open it from the Home Screen: it runs full screen.'); }
});
const fsChange = () => { $('#fsBtn').textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '✕ Exit full screen' : '⛶ Full screen'; setTimeout(resize, 100); };
document.addEventListener('fullscreenchange', fsChange); document.addEventListener('webkitfullscreenchange', fsChange);
setTimeout(() => $('#topHint').classList.add('is-faded'), 6000);

// ---------------- researcher log: tap the counter 3 times ----------------
let taps = [];
$('#statusPill').addEventListener('click', (e) => {
  e.stopPropagation(); const now = Date.now(); taps = taps.filter(t => now - t < 900); taps.push(now);
  if (taps.length >= 3) { taps = []; $('#logText').value = 't_ms,type,id,level,from\n' + log.map(r => [r.t_ms, r.type, r.id, r.level, r.from ?? ''].join(',')).join('\n'); $('#logPanel').hidden = false; }
});
$('#logClose').addEventListener('click', () => { $('#logPanel').hidden = true; });
$('#logCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#logText').value); $('#logCopy').textContent = 'Copied'; } catch (_) { $('#logText').select(); $('#logCopy').textContent = 'Select all and copy'; } });

// ---------------- main loop ----------------
function resize() { const w = sceneEl.clientWidth, h = sceneEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); positionCard(); }
window.addEventListener('resize', resize);
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), time = clock.elapsedTime;
  if (tAnim < 1) { tAnim = Math.min(1, tAnim + dt / 1.6); updateFlowers(wFrom, wTo, smooth(tAnim)); }
  U.uTime.value = time; U.uFrom.value.fromArray(wFrom); U.uTo.value.fromArray(wTo); U.uT.value = tAnim;
  updateAnimals(dt, time); updateCamera(); renderer.render(scene, camera); updatePins();
}
window.__ar3d = { finish: () => { tAnim = 0.999; }, setLevel: (lv) => { record('level', `level_${lv}`, { from: curLevel }); setLevel(lv); }, camPos, set yaw(v) { yaw = v; }, set pitch(v) { pitch = v; }, step, get stats() { return { flowers: FL.length, animals: animals.length }; } };

(async function start() {
  resize();
  try {
    const [g1, g3, g5, p1, p3, p5, gi1, gi3, gi5, flowers, prof, wingInfo, bee, wing, bfly, lark] = await Promise.all([
      loadTex('assets/ground_L1.jpg'), loadTex('assets/ground_L3.jpg'), loadTex('assets/ground_L5.jpg'),
      loadTex('assets/pano_L1.jpg'), loadTex('assets/pano_L3.jpg'), loadTex('assets/pano_L5.jpg'),
      loadImg('assets/ground_L1.jpg'), loadImg('assets/ground_L3.jpg'), loadImg('assets/ground_L5.jpg'),
      fetch('assets/flowers.json').then(r => r.json()), fetch('assets/profiles.json').then(r => r.json()), fetch('assets/bee_wing.json').then(r => r.json()),
      loadTex('assets/bee.png'), loadTex('assets/bee_wing.png'), loadTex('assets/butterfly.png'), loadTex('assets/skylark.png')]);
    buildPhotoScene({ g1, g3, g5, p1, p3, p5 });
    buildGrass({ g1: imageData(gi1), g3: imageData(gi3), g5: imageData(gi5) });
    buildFlowers(flowers); updateFlowers(wFrom, wTo, 1);
    await buildAnimals(prof, { bee, wing, bfly, lark }, wingInfo);
    buildPins();
  } catch (err) { console.error('loading failed', err); }
  setLevel(PRODUCT_LEVEL, true); record('start', 'session');
  renderer.setAnimationLoop(frame); $('#loading').hidden = true;
})();
