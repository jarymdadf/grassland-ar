// Biodiversity Grassland – AR version, built FROM the approved 2D prototype (v2.2) pictures.
// The three approved pictures (levels 1, 3, 5) are turned into a 3D scene:
//  • sky, horizon, trees, farmhouse and hedge: the photo itself, on a distant curved backdrop (sky continued above the photo)
//  • the field: the photo laid onto the ground exactly where it is in the picture (projection)
//  • grass: 3D blades whose colours are taken from the photo at their spot
//  • flowers: 3D daisies, buttercups and clover at the positions detected in the photo
//  • species, markers, cards, texts: same positions and content as the 2D prototype
// The scene covers 180° in front of the participant. Outside it, the real room is seen through the camera.
// Display modes (chosen automatically after "Start", in this order):
//  1. xr8     – 8th Wall engine world tracking (camera + 6DoF: turning and walking), iPhone Safari and Android Chrome
//  2. webxr   – Android's own AR (WebXR immersive-ar, 6DoF), if 8th Wall is not available
//  3. orient  – camera image + device orientation (3DoF: turning only), last AR fallback
//  4. preview – no camera; drag to look around; view limited so the edge of the scene is never visible
// Force a mode for testing with ?mode=preview|xr8|webxr|orient. Eye height (m) with ?h=1.35. ?scale=absolute for 8th Wall absolute scale.
import * as THREE from './lib/three.module.min.js';
window.THREE = THREE; // the 8th Wall engine uses window.THREE

const params = new URLSearchParams(location.search);
const FORCED = params.get('mode');
const EYE_H = THREE.MathUtils.clamp(parseFloat(params.get('h')) || 1.35, 0.8, 2.0); // device height above the floor in AR (m)
const XR_SCALE = params.get('scale') === 'absolute' ? 'absolute' : 'responsive';   // responsive (default): scene scaled to an assumed device height EYE_H; absolute: engine estimates real metres
const DEBUG = params.has('debug');
const TEST = params.has('test');
const DPR_MAX = parseFloat(params.get('dpr')) || 2;            // rendering resolution (device pixel ratio), 2x by default; ?dpr=3 for full resolution
const XR8_SRC = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js';

// ---------------- photo camera model (shared by the 2D pictures and the 3D scene) ----------------
const IMG_W = 2172, IMG_H = 724;          // approved pictures (pixels)
const Y0 = 297;                           // horizon row in the pictures
const F = IMG_W / Math.PI;                // 180° cylindrical panorama → pixels per radian
const H0 = 0.9;                           // camera height of the photo (m), estimated from the size of the daisies (≈5 cm)
const R_BG = 25;                          // distance of the backdrop (m); ground and backdrop meet exactly there
const R_IN = 0.55, VEG_MAX = 8;           // 3D flowers from 0.55 m to 8 m (all flowers detected in the photo lie within 8 m)
const GRASS_MAX = 16;                     // 3D grass from 0.55 m to 16 m; beyond that the (sharpened) photo ground
const HR_ROWS = 420;                      // top rows of the pictures (sky, horizon, far field) also loaded 3x sharper (AI super-resolution)
const PRODUCT_LEVEL = 3, LV = [1, 3, 5];
const SEED = 20261110;                    // fixed seed: every participant sees exactly the same scene
const START_X = 1450;                     // same start view as the 2D prototype

const D2R = Math.PI / 180;
const YAW0 = (START_X - IMG_W / 2) / F;   // direction of the start view in the photo
const EDGE_AR = 80 * D2R;                 // in AR the scene fades out between 80° and 90° to each side
const EDGE_PREVIEW = 89.4 * D2R;          // in the preview the scene is opaque up to its edge (the view stops there)
const SKY_FADE = [62 * D2R, 78 * D2R];    // above the horizon the sky continues and fades out between these elevations
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

// ---------------- the grassland: one group, shown by whichever display mode runs ----------------
const root = new THREE.Group(); root.name = 'grassland';
root.add(new THREE.HemisphereLight(0xf2f6ff, 0x8a9a62, 1.6));
{ const sun = new THREE.DirectionalLight(0xfff4e2, 1.5); sun.position.set(2, 5, 3); root.add(sun); }

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
const photoTex = [];
function prepTextures(renderer) {   // WebGL1 cannot build mipmaps for these picture sizes: sample them directly instead of shrinking them
  if (renderer.capabilities.isWebGL2) return;
  photoTex.forEach(t => { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; });
}
function detailTexture() {           // tileable fine grass texture (grey, around mid-grey): adds sharp detail to the ground near the viewer
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); const r = mulberry32(11);
  g.fillStyle = '#808080'; g.fillRect(0, 0, N, N); g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = r() * N, y = r() * N, len = 4 + r() * 14, ang = -Math.PI / 2 + (r() - 0.5) * 1.6, v = r() < 0.5 ? 40 + r() * 50 : 170 + r() * 60;
    g.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.35 + r() * 0.4})`; g.lineWidth = 0.8 + r() * 1.4;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function skyColour(data) {             // average colour of the top rows of the photo (the sky continues above the picture with it)
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < 14; y++) for (let x = 0; x < IMG_W; x += 4) { const i = (y * IMG_W + x) * 4; r += data.data[i]; g += data.data[i + 1]; b += data.data[i + 2]; n++; }
  return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

// shared uniforms: level cross-fade, time, edge of the scene, sky colour
const U = { uFrom: { value: new THREE.Vector3(0, 1, 0) }, uTo: { value: new THREE.Vector3(0, 1, 0) }, uT: { value: 1 }, uTime: { value: 0 },
  uEdge: { value: EDGE_PREVIEW }, uSky: { value: new THREE.Color(0.6, 0.75, 0.9) } };

// ---------------- photo ground and backdrop ----------------
const photoFrag = () => /* glsl */`
  uniform sampler2D tG1, tG3, tG5, tP1, tP3, tP5, tH1, tH3, tH5; uniform vec3 uFrom, uTo; uniform float uT, uEdge; uniform vec3 uSky;
  vec3 lvl(sampler2D a, sampler2D b, sampler2D c, vec2 uv, vec3 w) {   // level cross-fade; textures with weight 0 are not read
    vec3 r = vec3(0.0);
    if (w.x > 0.001) r += texture2D(a, uv).rgb * w.x;
    if (w.y > 0.001) r += texture2D(b, uv).rgb * w.y;
    if (w.z > 0.001) r += texture2D(c, uv).rgb * w.z;
    return r;
  }
  vec3 pick(vec2 uv, float d) {
    vec3 w = mix(uFrom, uTo, smoothstep(0.0, 1.0, uT));
    float yi = (1.0 - uv.y) * ${IMG_H}.0;
    float f = smoothstep(${VEG_MAX.toFixed(1)}, ${(VEG_MAX + 2).toFixed(1)}, d);   // near: flowers are 3D, so use the flower-free photo
    vec3 g = f < 0.999 ? lvl(tG1, tG3, tG5, uv, w) : vec3(0.0);
    vec3 p = vec3(0.0);
    if (f > 0.001) p = yi < ${(HR_ROWS - 2).toFixed(1)} ? lvl(tH1, tH3, tH5, vec2(uv.x, 1.0 - yi / ${HR_ROWS}.0), w) : lvl(tP1, tP3, tP5, uv, w);
    return mix(g, p, f);
  }
  float sideFade(float az) { return 1.0 - smoothstep(uEdge, 1.5708, abs(az)); }`;
function photoUniforms(tex) { return { ...U, tG1: { value: tex.g1 }, tG3: { value: tex.g3 }, tG5: { value: tex.g5 }, tP1: { value: tex.p1 }, tP3: { value: tex.p3 }, tP5: { value: tex.p5 },
  tH1: { value: tex.h1 }, tH3: { value: tex.h3 }, tH5: { value: tex.h5 }, tDet: { value: tex.det } }; }
function buildPhotoScene(tex) {
  // ground: every pixel looks up where it appears in the photo
  const groundGeo = new THREE.RingGeometry(R_IN - 0.15, R_BG, 240, 90, -0.05, Math.PI + 0.1); groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.ShaderMaterial({
    uniforms: photoUniforms(tex), transparent: true, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: photoFrag() + /* glsl */`
      varying vec3 vL; uniform sampler2D tDet;
      void main(){
        float az = atan(vL.x, -vL.z); float d = length(vL.xz);
        float x = ${(IMG_W / 2).toFixed(1)} + az * ${F.toFixed(4)};
        float y = ${Y0.toFixed(1)} + ${(F * H0).toFixed(4)} / d;
        if (y > ${IMG_H - 1}.0) { float k = mod(y - ${IMG_H - 1}.0, 300.0); y = ${IMG_H - 1}.0 - (k < 150.0 ? k : 300.0 - k); }
        vec2 uv = vec2(x / ${IMG_W}.0, 1.0 - y / ${IMG_H}.0);
        float a = smoothstep(${(R_IN - 0.15).toFixed(2)}, ${(R_IN + 0.15).toFixed(2)}, d) * sideFade(az);
        // fine grass detail on the ground near the viewer (the photo alone is too coarse at close range); colours stay the photo's
        float det = texture2D(tDet, vL.xz / 0.55).r * 0.6 + texture2D(tDet, vL.xz / 0.17 + 0.37).r * 0.4;
        float k = 0.55 * (1.0 - smoothstep(4.0, 14.0, d));
        gl_FragColor = vec4(pick(uv, d) * (1.0 + k * (det - 0.5)), a);
        #include <colorspace_fragment>
      }`
  });
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.renderOrder = -1; ground.frustumCulled = false; root.add(ground);

  // backdrop: the photo above the field (sky, horizon, trees, farmhouse, hedge) on a curved wall 25 m away;
  // above the top of the photo the sky continues in the photo's own sky colour and fades out high up
  const cols = 180, rows = 64, eBot = Math.atan2(-H0, R_BG), eTop = SKY_FADE[1] + 1 * D2R, pos = [], uv = [], el = [], idx = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const az = (-90 + 180 * i / cols) * D2R, e = eBot + (eTop - eBot) * j / rows, y = H0 + R_BG * Math.tan(e), p = world(az, R_BG, y);
    pos.push(p.x, p.y, p.z); uv.push((IMG_W / 2 + az * F) / IMG_W, 1 - (Y0 - F * Math.tan(e)) / IMG_H); el.push(e);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const a = j * (cols + 1) + i, b = a + cols + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bg.setAttribute('aE', new THREE.Float32BufferAttribute(el, 1)); bg.setIndex(idx);
  const topE = Math.atan(Y0 / F);
  const bgMat = new THREE.ShaderMaterial({
    uniforms: photoUniforms(tex), side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`attribute float aE; varying vec2 vUv; varying float vE; void main(){ vUv = uv; vE = aE; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: photoFrag() + /* glsl */`varying vec2 vUv; varying float vE;
      void main(){
        float az = (vUv.x * ${IMG_W}.0 - ${(IMG_W / 2).toFixed(1)}) / ${F.toFixed(4)};
        vec2 uv = vec2(vUv.x, min(vUv.y, 1.0 - 1.5 / ${IMG_H}.0));
        float k = smoothstep(${(topE - 0.012).toFixed(4)}, ${(topE + 0.2).toFixed(4)}, vE);
        vec3 c = mix(pick(uv, 99.0), uSky, k);
        float a = sideFade(az) * (1.0 - smoothstep(${SKY_FADE[0].toFixed(4)}, ${SKY_FADE[1].toFixed(4)}, vE));
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`
  });
  const back = new THREE.Mesh(bg, bgMat); back.renderOrder = -2; back.frustumCulled = false; root.add(back);
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
  // fewer and lower blades towards the viewer, the far end and the two side edges (the edges fade into the room in AR)
  const edge = (az, d) => Math.min(smooth(Math.min(1, (d - R_IN) / 0.35)), smooth(Math.max(0, Math.min(1, (90 * D2R - Math.abs(az)) / (10 * D2R)))), smooth(Math.min(1, (GRASS_MAX - d) / 4)));
  const logD = () => R_IN * Math.pow(GRASS_MAX / R_IN, Math.pow(rand(), 1.15));
  const wide = (d) => 1 + Math.max(0, d - 3) * 0.12;   // distant blades a little wider, so they do not flicker below one pixel
  // base sward everywhere (short where mown, medium where unmown)
  for (let i = 0; i < 62000; i++) {
    const az = rr(-90, 90) * D2R, d = logD(), e = edge(az, d); if (rand() > 0.15 + 0.85 * e) continue;
    const { x, y } = toImg(az, d);
    const hs = LV.map(lv => (TALL[lv](x, y) ? rr(0.12, 0.26) : (lv === 1 ? rr(0.025, 0.05) : rr(0.03, 0.06))) * (0.5 + 0.5 * e));
    add(az, d, hs, 0.6, rr(0.006, 0.011) * wide(d), rr(0.05, 0.35), rr(-0.15, 0.15));
  }
  // tall grasses where the pictures show unmown vegetation (they disappear when mown)
  for (let i = 0, n = 0; i < 90000 && n < 10000; i++) {
    const az = rr(-90, 90) * D2R, d = logD(); const { x, y } = toImg(az, d); if (!TALL[5](x, y)) continue;
    const e = edge(az, d) * smooth(Math.min(1, (d - R_IN) / 1.0)); if (rand() > e) continue; n++;   // fewer tall stems right in front of the viewer
    const t = rr(0.25, 0.5) * (0.6 + 0.4 * e);
    add(az, d, LV.map(lv => (TALL[lv](x, y) ? t : 0)), 0.45, rr(0.004, 0.008) * wide(d), rr(0.1, 0.4), rr(-0.15, 0.15));
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
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; root.add(m);
  return A.w.length;
}

// ---------------- 3D flowers at the positions detected in the photo ----------------
const FL = [];
const HEADS = {}; let stems = null, edgeFade = false;
function buildFlowers(list) {
  const H = { daisy: [0.4, 0.52], butter: [0.36, 0.5], clover: [0.26, 0.36] };
  for (const f of list) {
    const hf = rr(...H[f.t]); if (f.y <= Y0 + 2) continue;
    const { az, d } = fromImg(f.x, f.y, hf); if (!(d > R_IN && d < VEG_MAX) || Math.abs(az) > 89 * D2R) continue;
    const size = THREE.MathUtils.clamp(f.w * d / F, 0.035, 0.07);
    const p = world(az, d), toViewer = Math.atan2(-p.x, -p.z);   // flower heads turned towards the viewer, as in the photo
    FL.push({ type: f.t, p, h: hf, size, ef: smooth(Math.max(0, Math.min(1, (90 * D2R - Math.abs(az)) / (10 * D2R)))), vis: [0, f.v3, 1], yaw: f.t === 'clover' ? rand() * 6.28 : toViewer + rr(-0.4, 0.4), tilt: f.t === 'daisy' ? rr(0.5, 0.95) : rr(0.15, 0.4), top: new THREE.Vector3() });
  }
  const daisyTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64);
    for (let i = 0; i < 24; i++) { g.save(); g.rotate(i / 24 * Math.PI * 2); g.fillStyle = i % 2 ? '#f4f2ec' : '#ffffff'; g.beginPath(); g.ellipse(0, -36, 5.5, 25, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    g.fillStyle = '#e9b41b'; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const cloverTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#b0708e'; g.fillRect(0, 0, 64, 64);
    const r = mulberry32(7); for (let i = 0; i < 300; i++) { g.fillStyle = ['#d396b3', '#93506f', '#e6b8cc', '#bd7898'][i % 4]; g.fillRect(r() * 64, r() * 64, 3, 3); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const count = (t) => FL.filter(f => f.type === t).length;
  const stemGeo = new THREE.CylinderGeometry(0.0016, 0.0024, 1, 4, 1, true); stemGeo.translate(0, 0.5, 0);
  stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x6a8f3a }), FL.length);
  const daisyGeo = new THREE.CircleGeometry(0.5, 18); daisyGeo.rotateX(-Math.PI / 2);
  HEADS.daisy = new THREE.InstancedMesh(daisyGeo, new THREE.MeshBasicMaterial({ map: daisyTex, alphaTest: 0.4, side: THREE.DoubleSide }), count('daisy'));
  HEADS.butter = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 6, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), new THREE.MeshLambertMaterial({ color: 0xf0bf1a, emissive: 0x6a5000, side: THREE.DoubleSide }), count('butter'));
  HEADS.clover = new THREE.InstancedMesh((() => { const g = new THREE.SphereGeometry(0.4, 10, 8); g.scale(1, 1.25, 1); return g; })(), new THREE.MeshLambertMaterial({ map: cloverTex, emissive: 0x2a1420 }), count('clover'));
  [stems, ...Object.values(HEADS)].forEach(m => { m.frustumCulled = false; root.add(m); });
  const counters = { daisy: 0, butter: 0, clover: 0 }; FL.forEach(f => { f.hi = counters[f.type]++; });
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
function updateFlowers(wFrom, wTo, t) {
  if (!stems) return;
  for (let i = 0; i < FL.length; i++) {
    const f = FL[i];
    const a = f.vis[0] * wFrom[0] + f.vis[1] * wFrom[1] + f.vis[2] * wFrom[2], b = f.vis[0] * wTo[0] + f.vis[1] * wTo[1] + f.vis[2] * wTo[2];
    const s = Math.max(1e-4, (a + (b - a) * t) * (edgeFade ? f.ef : 1));   // in AR, flowers near the side edges shrink away with the fading scene
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
// AR layout (v7): every species and grassland element sits on its real object in the landscape, but within 1.5–4 m of the
// participant and spread to the left and right, so it is visible on a phone or tablet camera view (about 65° wide).
// az = direction in the picture (degrees, 0 = picture centre, + = right), d = distance (m). Same points per level as prototype v2.2.
// Checked against the edges of the unmown vegetation used for the pictures (the margin markers lie on the real margin edge).
const AR_LAYOUT = {
  1: { mown: { az: 0, d: 2.5 }, margin: { az: 44, d: 2.8 }, hedge: { x: 1960, y: 225 } },
  3: { margin: { az: 44, d: 2.8 }, butterfly: { az: 50, d: 3.4 }, flower: { az: 58, d: 2.3 }, bee: { az: 66, d: 1.8 }, hedge: { x: 1960, y: 225 } },
  5: { bird: { az: -30, d: 3.0 }, margin: { az: -5, d: 2.8 }, bee: { az: 10, d: 1.7 }, strip: { az: 15, d: 3.4 }, flower: { az: 38, d: 2.0 },
       butterfly: { az: 55, d: 2.6 }, hedge: { x: 1960, y: 225 } }
};
const MARKER_H = 0.7;                      // markers float this high above the ground (m), with a thin line down to the object

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

function buildAnimals(prof, tx, wingInfo) {
  for (const [lvs, spec] of Object.entries(SPECIES_2D)) for (const [kind, s] of Object.entries(spec)) {
    const lv = Number(lvs); let a;
    const L = AR_LAYOUT[lv][kind], azL = L.az * D2R, dL = L.d;                      // position: AR layout
    if (kind === 'bird') {
      const yFeet = s.y + s.h / 2, { d } = fromImg(s.x, yFeet, 0), az = azL;
      const len = s.h * (1312 / 1199) * 0.795 * d / F;                              // size: as approved in the 2D prototype (about 20 cm)
      const b = makeBird(tx.lark, prof, len); b.g.position.copy(world(az, dL));
      const baseYaw = -az;                                                           // side-on to the viewer, head to the left as in the picture
      a = { kind, lv, g: b.g, inner: b.inner, home: b.g.position.clone(), baseYaw, yaw: baseYaw, targetYaw: baseYaw, timer: 2, action: 'idle', t: 0, top: len * 0.9 };
    } else {
      const hI = FLY_H[kind], { d } = fromImg(s.x, s.y, hI), az = azL;
      if (kind === 'bee') { const len = s.h * 1.5 * 0.5625 * d / F; const b = makeBee(tx.bee, tx.wing, wingInfo, prof, len); a = { kind, lv, g: b.g, wings: b.wings, top: len * 0.6 }; a.g.rotation.y = -az + (s.flip ? Math.PI : 0); }
      else { const span = s.h * 1.5 * 0.87 * d / F; const b = makeButterfly(tx.bfly, span); a = { kind, lv, g: b.g, pl: b.pl, pr: b.pr, top: span * 0.4 }; a.g.rotation.y = -az; }
      a.home = world(az, dL, hI); a.g.position.copy(a.home);
    }
    a.presence = lv === PRODUCT_LEVEL ? 1 : 0; a.phase = rand() * 10; root.add(a.g); animals.push(a);
  }
}
function updateAnimals(dt, time) {
  for (const a of animals) {
    const want = a.lv === curLevel ? 1 : 0; a.presence += (want - a.presence) * Math.min(1, dt * 3);
    a.g.visible = a.presence > 0.02; a.g.scale.setScalar(Math.max(0.001, a.presence)); if (!a.g.visible) continue;
    const t = time + a.phase;
    if (a.kind === 'bee') {            // hovers around its spot among the flowers
      a.g.position.set(a.home.x + Math.sin(t * 0.7) * 0.11 + Math.sin(t * 1.9) * 0.03, a.home.y + Math.sin(t * 2.1) * 0.035, a.home.z + Math.sin(t * 0.9) * 0.08);   // wanders among the flowers
      const flap = 0.25 + 1.05 * Math.abs(Math.sin(t * 38)); a.wings.forEach(w => { w.rotation.x = w.userData.sgn * flap; });
    } else if (a.kind === 'butterfly') { // rests on its flower with open wings (as in the picture), now and then a short flutter
      const cycle = t % 9, flying = cycle > 7;
      const open = flying ? 0.15 + 1.1 * Math.abs(Math.sin(t * 13)) : 0.25 + 0.12 * Math.sin(t * 1.4) + (cycle > 5.5 && cycle < 6 ? 0.9 : 0);
      a.pl.rotation.z = -open; a.pr.rotation.z = open;
      const k = flying ? Math.sin((cycle - 7) / 2 * Math.PI) : 0; a.g.position.set(a.home.x + k * 0.14, a.home.y + k * 0.16, a.home.z - k * 0.05);
    } else {                           // skylark: pecks, turns a little
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
const sceneEl = $('#scene');
const hotspotCard = $('#hotspotCard'), seenCount = $('#seenCount'), badge = $('#badge'), productPill = $('#productPill'), levelLine = $('#levelLine');

// ---------------- markers (v9): HTML buttons placed every frame where their object is on screen ----------------
// The marker that is seen IS the button that is tapped: the browser itself does the tap test, in every display mode.
// Each marker = dot + label, with a thin line down to its object; pulsing ring until visited, ✓ after, dark while its card is open.
// Species markers follow their animal. Labels never overlap: a marker that would cover a nearer one is lifted above it.
const markers = [];
const markerLayer = document.getElementById('markerLayer'), markerLines = document.getElementById('markerLines');
const SVGNS = 'http://www.w3.org/2000/svg';
let markerPx = 0;
function markerState(m) { m.el.classList.toggle('is-seen', m.seen); m.el.classList.toggle('is-active', m.active); m.el.setAttribute('aria-pressed', String(m.active)); m.w = 0; }
function makeMarker(lv, id, anchor, base, line, animal) {
  const label = OVERRIDES[lv]?.[id]?.label || LABEL[id];
  const el = document.createElement('button'); el.type = 'button'; el.className = 'mk is-off'; el.dataset.id = id; el.dataset.level = String(lv);
  el.innerHTML = '<span class="mk-dot" aria-hidden="true"></span><span class="mk-label"></span><span class="mk-check" aria-hidden="true">✓</span>';
  el.querySelector('.mk-label').textContent = label;
  markerLayer.appendChild(el);
  let ln = null;
  if (line) { ln = document.createElementNS(SVGNS, 'line'); ln.setAttribute('class', 'mk-line'); ln.style.visibility = 'hidden'; markerLines.appendChild(ln); }
  const m = { lv: Number(lv), id, label, el, line: ln, seen: false, active: false, anchor: anchor.clone(), base: base.clone(), animal, lift: 0, w: 0, on: false, fresh: true };
  m.follow = animal ? animal.g.position.clone() : null;   // species markers follow a smoothed position of their animal (calm, easy to tap)
  el.addEventListener('pointerdown', () => { m.hold = true; });                   // a marker stays still while a finger is on it
  const release = () => { setTimeout(() => { m.hold = false; }, 120); };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release); el.addEventListener('pointerleave', release);
  el.addEventListener('click', (e) => { e.stopPropagation(); openCard(m, e.clientX); });
  markers.push(m);
}
function buildPins() {
  for (const lv of LV) for (const [id, L] of Object.entries(AR_LAYOUT[lv])) {
    if (L.x !== undefined) {                       // on the backdrop (hedgerow): the marker sits on the hedge in the picture
      const az = (L.x - IMG_W / 2) / F, p = world(az, R_BG - 0.5, H0 + R_BG * (Y0 - L.y) / F); makeMarker(lv, id, p, p, false, null); continue;
    }
    const a = animals.find(x => x.lv === lv && x.kind === id);
    if (a) makeMarker(lv, id, new THREE.Vector3(0, a.top * 0.5, 0), new THREE.Vector3(0, a.top + 0.18, 0), true, a);   // relative to the animal
    else makeMarker(lv, id, world(L.az * D2R, L.d, 0), world(L.az * D2R, L.d, MARKER_H), true, null);
  }
}
const _w = new THREE.Vector3(), _b = new THREE.Vector3(), _inv = new THREE.Matrix4();
let view = { x: 0, y: 0, w: 1, h: 1 };            // where the 3D picture is drawn, in page pixels relative to the scene
function toScreen(local, cam) {                   // picture-space point → screen pixels (same matrices as used for drawing)
  _w.copy(local).applyMatrix4(root.matrixWorld).applyMatrix4(_inv); const depth = -_w.z, side = Math.sign(_w.x || 1);   // side: left/right of the viewer (also when behind)
  _w.applyMatrix4(cam.projectionMatrix);
  return { x: view.x + (_w.x + 1) / 2 * view.w, y: view.y + (1 - _w.y) / 2 * view.h, depth, side };
}
const edgeL = document.getElementById('edgeLeft'), edgeR = document.getElementById('edgeRight');
function updateMarkers(cam, dt) {
  if (!cam || !markers.length) return;
  root.updateMatrixWorld(true); cam.updateMatrixWorld(); _inv.copy(cam.matrixWorld).invert();
  const sb = sceneEl.getBoundingClientRect(), gl = document.getElementById('gl'), cr = gl ? gl.getBoundingClientRect() : sb;
  view = cr.width > 0 && cr.height > 0 ? { x: cr.left - sb.left, y: cr.top - sb.top, w: cr.width, h: cr.height } : { x: 0, y: 0, w: sb.width, h: sb.height };
  const W = sb.width, H = sb.height;
  const px = Math.round(Math.min(40, Math.max(30, H * 0.072)));   // marker height: 30 px on phones, up to 40 px on tablets
  if (px !== markerPx) { markerPx = px; markerLayer.style.setProperty('--mk-h', `${px}px`); markers.forEach(m => { m.w = 0; }); }
  const vis = []; let offL = false, offR = false;
  for (const m of markers) {
    let show = m.lv === curLevel, b = null, anc = null;
    if (show) {
      if (m.animal) m.follow.lerp(m.animal.g.position, m.on ? 1 - Math.exp(-dt * 1.2) : 1);
      b = toScreen(m.animal ? _b.copy(m.follow).add(m.base) : m.base, cam);
      if (m.line) anc = toScreen(m.animal ? _b.copy(m.animal.g.position).add(m.anchor) : m.anchor, cam);
      const onScreen = b.depth > 0.05 && b.x > -px && b.x < W + px && b.y > -px && b.y < H + px;
      if (!onScreen && !m.seen) { if (b.depth <= 0.05 ? b.side < 0 : b.x < 0) offL = true; else offR = true; }
      if (b.depth > 0.05) vis.push({ m, b, anc }); else show = false;
    }
    if (show !== m.on) { m.on = show; m.el.classList.toggle('is-off', !show); if (!show) { m.fresh = true; if (m.line) m.line.style.visibility = 'hidden'; } }
  }
  // separation: nearest markers keep their place; a marker that would overlap one already placed is lifted above it
  vis.sort((p, q) => p.b.depth - q.b.depth);
  const placed = [], gap = 6;
  for (const { m, b, anc } of vis) {
    if (!m.w) m.w = m.el.offsetWidth || px * 4;
    const l0 = b.x - px / 2, r0 = l0 + m.w; let shift = 0;
    for (let k = 0; k < 12; k++) {
      const t = b.y - px / 2 - shift, bt = t + px;
      const hit = placed.find(p => l0 < p.r + gap && r0 > p.l - gap && t < p.b + gap && bt > p.t - gap);
      if (!hit) break; shift += bt - (hit.t - gap);
    }
    placed.push({ l: l0, r: r0, t: b.y - px / 2 - shift, b: b.y + px / 2 - shift });
    if (m.fresh) { m.lift = shift; m.fresh = false; } else m.lift += (shift - m.lift) * Math.min(1, dt * 6);   // labels glide instead of jumping
    if (m.hold && m.sx !== undefined) { placed[placed.length - 1] = { l: m.sx - px / 2, r: m.sx - px / 2 + m.w, t: m.sy - px / 2, b: m.sy + px / 2 }; }
    const x = m.hold && m.sx !== undefined ? m.sx : b.x, y = m.hold && m.sy !== undefined ? m.sy : b.y - m.lift; m.sx = x; m.sy = y;
    m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    if (m.line) {
      const ok = anc && anc.depth > 0.05;
      m.line.style.visibility = ok ? 'visible' : 'hidden';
      if (ok) { m.line.setAttribute('x1', anc.x.toFixed(1)); m.line.setAttribute('y1', anc.y.toFixed(1)); m.line.setAttribute('x2', x.toFixed(1)); m.line.setAttribute('y2', y.toFixed(1)); }
    }
  }
  if (edgeL) { edgeL.classList.toggle('is-hidden', !offL); edgeR.classList.toggle('is-hidden', !offR); }
}
window.addEventListener('resize', () => markers.forEach(m => { m.w = 0; }));

// ---------------- interaction log ----------------
const t0 = performance.now(); const log = [];
let curLevel = PRODUCT_LEVEL;
const record = (type, id, extra = {}) => log.push({ t_ms: Math.round(performance.now() - t0), type, id, level: curLevel, ...extra });

// ---------------- levels ----------------
const seen = new Set();
const idsAt = (lv) => [...new Set(markers.filter(m => m.lv === lv).map(m => m.id))];
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
  showLevelLine();
  updateCounter(); closeCard();
}
document.querySelectorAll('.level-button:not([disabled])').forEach(btn => btn.addEventListener('click', (e) => {
  e.stopPropagation(); const lv = Number(btn.dataset.level); if (lv === curLevel) return;
  record('level', `level_${lv}`, { from: curLevel }); setLevel(lv);
}));

// ---------------- cards: on the side away from the tapped marker ----------------
let activeMarker = null;
function openCard(m, clientX) {
  const key = m.id, info = { ...hotspots[key], ...(OVERRIDES[curLevel]?.[key] || {}) };
  if (activeMarker && activeMarker !== m) { activeMarker.active = false; markerState(activeMarker); }
  activeMarker = m; m.active = true; m.seen = true; markerState(m);
  hotspotCard.hidden = false; seen.add(`${curLevel}:${key}`); updateCounter(); record('point', key);
  $('#hotspotType').textContent = info.type; $('#hotspotIcon').innerHTML = SPRITE[key] ? `<img src="${SPRITE[key]}" alt="" />` : info.icon;
  $('#hotspotTitle').textContent = info.title; $('#hotspotText').textContent = info.text; $('#hotspotLink').textContent = info.link;
  hotspotCard.scrollTop = 0;
  const sb = sceneEl.getBoundingClientRect(), cw = hotspotCard.offsetWidth, mg = 12, onRight = clientX - sb.left > sb.width / 2;
  const top = onRight ? badge.getBoundingClientRect().bottom - sb.top + 10 : mg;      // left side: below the badge
  const dockTop = $('.score-dock').getBoundingClientRect().top - sb.top;
  hotspotCard.style.left = `${onRight ? mg : sb.width - cw - mg}px`; hotspotCard.style.top = `${top}px`;
  hotspotCard.style.maxHeight = `${Math.max(120, dockTop - top - 44)}px`;
}
function closeCard() { hotspotCard.hidden = true; if (activeMarker) { activeMarker.active = false; markerState(activeMarker); activeMarker = null; } }
$('#closeHotspot').addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
// a tap on a marker opens its card (the marker's own click handler); a tap elsewhere on the landscape closes the card
const isUi = (t) => !!t.closest?.('button, a, .hotspot-card, .score-dock, .log-panel, .start, .install-guide, .exploration-status, .certification-badge, .debug-box');
let downAt = null;
sceneEl.addEventListener('pointerdown', (e) => { downAt = isUi(e.target) ? null : { x: e.clientX, y: e.clientY }; });
sceneEl.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) closeCard();   // a tap on the landscape (not on a marker) closes the card
  downAt = null;
});
// the level sentence appears for a few seconds after each level change, then fades
let lineTimer = 0;
function showLevelLine() { levelLine.classList.remove('is-hidden'); clearTimeout(lineTimer); lineTimer = setTimeout(() => levelLine.classList.add('is-hidden'), 5000); }

// ---------------- messages ----------------
const toast = $('#toast'); let toastTimer = 0;
function showToast(msg, ms = 6000) { toast.textContent = msg; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, ms); }
const arHint = $('#arHint'); let hintTimer = 0;
function showHint(msg, ms = 0) { arHint.textContent = msg; arHint.hidden = false; clearTimeout(hintTimer); if (ms) hintTimer = setTimeout(() => { arHint.hidden = true; }, ms); }
function hideHint() { arHint.hidden = true; }

// ---------------- device facts ----------------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isTouch = () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
const isStandalone = () => window.matchMedia('(display-mode: fullscreen)').matches || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);

// ---------------- shared per-frame update ----------------
let activeCam = null, mode = 'none', frames = 0, trackStatus = '–', trackReason = '';
const clock = new THREE.Clock();
function tick(cam) {
  const dt = Math.min(0.05, clock.getDelta()), time = clock.elapsedTime;
  if (tAnim < 1) { tAnim = Math.min(1, tAnim + dt / 1.6); updateFlowers(wFrom, wTo, smooth(tAnim)); }
  U.uTime.value = time; U.uFrom.value.fromArray(wFrom); U.uTo.value.fromArray(wTo); U.uT.value = tAnim;
  updateAnimals(dt, time); if (cam) updateMarkers(cam, dt);
  frames++;
}
function freshCanvas() {   // each display mode gets its own canvas (a canvas keeps the graphics context it was first used with)
  const old = $('#gl'), cv = document.createElement('canvas'); cv.id = 'gl'; old.replaceWith(cv); return cv;
}
const dpr = () => Math.min(window.devicePixelRatio || 1, DPR_MAX);

// ================= display mode 1: 8th Wall engine (camera, 6DoF world tracking) =================
let xr8Promise = null;
function loadXR8() {
  if (xr8Promise) return xr8Promise;
  xr8Promise = new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8);
    const timer = setTimeout(() => reject(new Error('8th Wall engine did not load (timeout)')), 30000);
    window.addEventListener('xrloaded', () => { clearTimeout(timer); resolve(window.XR8); }, { once: true });
    const s = document.createElement('script'); s.src = XR8_SRC; s.async = true; s.crossOrigin = 'anonymous'; s.setAttribute('data-preload-chunks', 'slam');
    s.onerror = () => { clearTimeout(timer); reject(new Error('8th Wall engine could not be downloaded')); };
    document.head.appendChild(s);
  });
  xr8Promise.catch(() => {});
  return xr8Promise;
}
async function runXR8() {
  let XR8; try { XR8 = await loadXR8(); } catch (err) { console.warn(err); return { ok: false, why: err.message }; }
  try { if (XR8.loadChunk) await XR8.loadChunk('slam'); } catch (err) { console.warn('slam chunk', err); }
  const cv = freshCanvas();
  const size = () => { cv.width = Math.round(window.innerWidth * dpr()); cv.height = Math.round(window.innerHeight * dpr()); };
  size();
  return new Promise((resolve) => {
    let settled = false, running = false, limitedSince = performance.now();
    const finish = (ok, why) => { if (settled) return; settled = true; resolve({ ok, why }); };
    const fail = (why) => {
      if (running && settled) { showToast('Tracking stopped. Please reload the page.'); return; }
      try { XR8.stop(); } catch (_) {} try { XR8.clearCameraPipelineModules(); } catch (_) {}
      root.removeFromParent(); finish(false, why);
    };
    const onResize = () => size();
    try {
      XR8.XrController.configure({ scale: XR_SCALE });
      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),   // draws the camera image
        XR8.Threejs.pipelineModule(),             // three.js scene driven by the engine's camera
        XR8.XrController.pipelineModule(),        // world tracking (SLAM)
        {
          name: 'grassland',
          onStart: () => {
            const { scene, camera, renderer } = XR8.Threejs.xrScene();
            renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; prepTextures(renderer);
            root.rotation.y = YAW0;                 // the direction the participant faces at Start = start view of the 2D prototype
            scene.add(root);
            camera.position.set(0, EYE_H, 0); camera.quaternion.identity();
            XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion,
              cam: { pixelRectWidth: cv.width, pixelRectHeight: cv.height, nearClipPlane: 0.01, farClipPlane: 300 } });
            activeCam = camera; window.addEventListener('resize', onResize);
          },
          onCameraStatusChange: ({ status }) => {
            if (status === 'requesting') showHint('Please allow camera access.');
            if (status === 'hasVideo') { running = true; finish(true); showHint('Move the device slowly from side to side.', 5000); }
            if (status === 'failed') fail('camera not available');
          },
          onUpdate: ({ processCpuResult }) => {
            const st = processCpuResult?.reality?.trackingStatus;
            if (st && st !== trackStatus) { trackStatus = st; trackReason = processCpuResult?.reality?.trackingReason || ''; record('tracking', st, { from: trackReason }); }
            if (st === 'LIMITED') { if (performance.now() - limitedSince > 2500) showHint('Move the device slowly from side to side.'); }
            else if (st === 'NORMAL') { limitedSince = performance.now(); if (!arHint.hidden && !hintTimer) hideHint(); }
            tick(activeCam);
          },
          onException: (err) => { console.error('8th Wall', err); fail(String(err && err.message || err)); },
        },
      ]);
      XR8.run({ canvas: cv });
    } catch (err) { console.error(err); fail(String(err && err.message || err)); }
    setTimeout(() => { if (!running) fail('no camera image after 60 s'); }, 60000);
  });
}

// ================= display mode 2: WebXR immersive-ar (Android Chrome; 6DoF) =================
async function webxrSupported() { try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (_) { return false; } }
async function runWebXR() {
  const cv = freshCanvas();
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(dpr()); renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); prepTextures(renderer);   // y = 0 is the real floor
  let session;
  try { session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['dom-overlay'], domOverlay: { root: sceneEl } }); }
  catch (err) { console.warn('webxr', err); renderer.dispose(); return { ok: false, why: String(err.message || err) }; }
  await renderer.xr.setSession(session);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.01, 300);
  root.rotation.y = YAW0; scene.add(root); cv.classList.add('xr-hidden');
  session.addEventListener('end', () => { showToast('AR ended. Reload the page to start again.', 10000); });
  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
    const xc = renderer.xr.getCamera(); activeCam = xc.cameras && xc.cameras.length ? xc.cameras[0] : xc; tick(activeCam);
  });
  showHint('Move the device slowly from side to side.', 5000);
  return { ok: true };
}

// ================= display mode 3: camera image + device orientation (3DoF: turning only) =================
async function runOrient() {
  if (!isTouch() || !navigator.mediaDevices?.getUserMedia) return { ok: false, why: 'no camera or no motion sensors' };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
  catch (err) { return { ok: false, why: 'camera not allowed' }; }
  const ori = { a: null, b: 0, g: 0 };
  const onOri = (e) => { if (e.alpha != null) { ori.a = e.alpha; ori.b = e.beta; ori.g = e.gamma; } };
  window.addEventListener('deviceorientation', onOri);
  const got = await new Promise(res => { const t0 = performance.now(); const chk = () => { if (ori.a != null) res(true); else if (performance.now() - t0 > 2500) res(false); else setTimeout(chk, 100); }; chk(); });
  if (!got) { window.removeEventListener('deviceorientation', onOri); stream.getTracks().forEach(t => t.stop()); return { ok: false, why: 'no motion sensors' }; }
  const video = document.createElement('video'); video.id = 'camVideo'; video.playsInline = true; video.muted = true; video.autoplay = true; video.setAttribute('playsinline', '');
  video.srcObject = stream; sceneEl.prepend(video); try { await video.play(); } catch (_) {}
  const cv = freshCanvas();
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.setPixelRatio(dpr()); prepTextures(renderer);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.01, 300), rig = new THREE.Group();
  rig.add(camera); scene.add(rig); camera.position.set(0, 0, 0); rig.position.set(0, EYE_H, 0);
  root.rotation.y = YAW0; scene.add(root);
  const size = () => { renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); };
  size(); window.addEventListener('resize', size);
  // device orientation → camera rotation (same formula as three.js DeviceOrientationControls)
  const zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0)) * D2R;
  let headingSet = false; const fwd = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    eul.set(ori.b * D2R, ori.a * D2R, -ori.g * D2R, 'YXZ'); camera.quaternion.setFromEuler(eul); camera.quaternion.multiply(q1); camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle()));
    if (!headingSet) { fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); rig.rotation.y = -Math.atan2(-fwd.x, -fwd.z); headingSet = true; }   // the direction faced at Start = forward
    rig.updateMatrixWorld(true); renderer.render(scene, camera); activeCam = camera; tick(camera);
  });
  showHint('Turn around slowly to look at the grassland.', 5000);
  return { ok: true };
}

// ================= display mode 4: preview without camera (drag to look around) =================
let pYaw = YAW0, pPitch = -4.3 * D2R;
function runPreview() {
  const cv = freshCanvas();
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.setPixelRatio(Math.min(dpr(), 2)); prepTextures(renderer);
  renderer.setClearColor(TEST ? 0xff00ff : 0x132f20, 1);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.01, 300);
  root.rotation.y = 0; scene.add(root); U.uEdge.value = EDGE_PREVIEW;
  camera.position.set(0, H0, 0);   // exactly where the photo was taken
  // the view is limited so that the screen never shows anything beyond the scene (sides, under the feet, above the sky)
  const _r = new THREE.Vector3(), CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
  const EL_MIN = -Math.atan2(H0, R_IN + 0.25), EL_MAX = SKY_FADE[0] - 4 * D2R, AZ_MAX = EDGE_PREVIEW - 0.003;
  const aim = () => { const cy = camera.position.y; camera.lookAt(Math.sin(pYaw) * Math.cos(pPitch), cy + Math.sin(pPitch), -Math.cos(pYaw) * Math.cos(pPitch)); camera.updateMatrixWorld(); };
  const extent = () => { let azMin = 9, azMax = -9, elMin = 9, elMax = -9;
    for (const [x, y] of CORNERS) { _r.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize(); const az = Math.atan2(_r.x, -_r.z), el = Math.asin(_r.y);
      azMin = Math.min(azMin, az); azMax = Math.max(azMax, az); elMin = Math.min(elMin, el); elMax = Math.max(elMax, el); }
    return { azMin, azMax, elMin, elMax }; };
  const clampView = () => {
    for (let i = 0; i < 8; i++) { aim(); const x = extent(); let moved = false;
      if (x.azMax > AZ_MAX) { pYaw -= x.azMax - AZ_MAX; moved = true; } else if (x.azMin < -AZ_MAX) { pYaw += -AZ_MAX - x.azMin; moved = true; }
      if (x.elMin < EL_MIN) { pPitch += EL_MIN - x.elMin; moved = true; } else if (x.elMax > EL_MAX) { pPitch -= x.elMax - EL_MAX; moved = true; }
      if (!moved) break; }
    aim();
  };
  const size = () => { const w = sceneEl.clientWidth, h = sceneEl.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); clampView(); };
  size(); window.addEventListener('resize', size);
  const pointers = new Map();
  cv.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  cv.addEventListener('pointermove', (e) => { const prev = pointers.get(e.pointerId); if (!prev || pointers.size !== 1) return;
    pYaw -= (e.clientX - prev.x) * 0.004; pPitch += (e.clientY - prev.y) * 0.003; clampView(); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  const up = (e) => pointers.delete(e.pointerId); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') pYaw -= 0.06; if (e.key === 'ArrowRight' || e.key === 'd') pYaw += 0.06;
    if (e.key === 'ArrowUp' || e.key === 'w') pPitch += 0.04; if (e.key === 'ArrowDown' || e.key === 's') pPitch -= 0.04;
    if (e.key === 'Escape') closeCard(); clampView();
  });
  activeCam = camera; renderer.setAnimationLoop(() => { renderer.render(scene, camera); tick(camera); });
  window.__ar3d.setCam = (h, fov) => { camera.position.y = h; camera.fov = fov; camera.updateProjectionMatrix(); aim(); };   // test only: simulate an AR viewpoint
  window.__ar3d.setView = (yaw, pitch) => { pYaw = yaw; pPitch = pitch; clampView(); return { yaw: pYaw, pitch: pPitch, ...extent() }; };
  return { ok: true };
}

// ---------------- full screen (preview) and Home Screen guide (iPhone) ----------------
const fsBtn = $('#fsBtn'), guide = $('#installGuide');
fsBtn.addEventListener('click', async (e) => {
  e.stopPropagation(); const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (canFullscreen()) { try { await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen()); try { await screen.orientation.lock('landscape'); } catch (_) {} return; } catch (_) {} }
  guide.hidden = false;
});
$('#guideClose').addEventListener('click', (e) => { e.stopPropagation(); guide.hidden = true; });
const fsChange = () => { fsBtn.textContent = (document.fullscreenElement || document.webkitFullscreenElement) ? '✕ Exit full screen' : '⛶ Full screen'; window.dispatchEvent(new Event('resize')); };
document.addEventListener('fullscreenchange', fsChange); document.addEventListener('webkitfullscreenchange', fsChange);

// ---------------- researcher log: tap the counter 3 times ----------------
let taps = [];
const openLogTaps = (e) => {
  e.stopPropagation(); const now = Date.now(); taps = taps.filter(t => now - t < 900); taps.push(now);
  if (taps.length >= 3) { taps = []; $('#logText').value = `display mode: ${mode}\nscale: ${XR_SCALE}, device height assumed: ${EYE_H} m, render resolution: ${dpr()}x\n` + 't_ms,type,id,level,from\n' + log.map(r => [r.t_ms, r.type, r.id, r.level, r.from ?? ''].join(',')).join('\n'); $('#logPanel').hidden = false; }
};
$('#statusPill').addEventListener('click', openLogTaps); badge.addEventListener('click', openLogTaps);
$('#logClose').addEventListener('click', () => { $('#logPanel').hidden = true; });
$('#logCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#logText').value); $('#logCopy').textContent = 'Copied'; } catch (_) { $('#logText').select(); $('#logCopy').textContent = 'Select all and copy'; } });

// ---------------- start screen and choice of display mode ----------------
const startScreen = $('#startScreen'), startBtn = $('#startBtn'), startText = $('#startText');
const RUN = { xr8: runXR8, webxr: runWebXR, orient: runOrient, preview: async () => runPreview() };
let queue = FORCED && RUN[FORCED] ? [FORCED] : ['xr8', 'webxr', 'orient', 'preview'];
function enterMode(m) {
  mode = m; record('mode', m); window.__ar3d.mode = m;
  document.documentElement.classList.toggle('ar', m !== 'preview'); document.body.dataset.mode = m;
  U.uEdge.value = m === 'preview' ? EDGE_PREVIEW : EDGE_AR;
  edgeFade = m !== 'preview'; updateFlowers(wFrom, wTo, smooth(Math.min(1, tAnim)));
  fsBtn.hidden = m !== 'preview' || isStandalone();
  startScreen.hidden = true;
  setLevel(PRODUCT_LEVEL, true); record('start', 'session');
  setTimeout(() => { if (arHint.hidden) showHint('Tap a marker to learn more. Turn left and right to find them all.', 5000); }, m === 'preview' ? 800 : 6000);
}
async function next() {
  startBtn.disabled = true; startBtn.textContent = 'Starting…';
  while (queue.length) {
    const m = queue[0];
    if (m === 'webxr' && !(await webxrSupported())) { queue.shift(); continue; }
    if (m === 'webxr' && startBtn.dataset.gesture !== 'webxr') {   // Android AR needs its own tap
      startBtn.dataset.gesture = 'webxr'; startBtn.disabled = false; startBtn.textContent = 'Continue';
      startText.textContent = 'Tap Continue to start the camera view.'; startScreen.hidden = false; return;
    }
    queue.shift();
    if (m !== 'preview') U.uEdge.value = EDGE_AR;
    const res = await RUN[m]();
    if (res.ok) { enterMode(m); return; }
    console.warn(`display mode ${m} not available: ${res.why}`); record('mode_failed', m, { from: res.why });
  }
}
startBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (startBtn.dataset.gesture === 'webxr') { next(); return; }
  // these requests must happen directly in the tap: motion sensors (iPhone), full screen and landscape (Android)
  const asks = [];
  try { if (window.DeviceMotionEvent?.requestPermission) asks.push(DeviceMotionEvent.requestPermission().catch(() => {})); } catch (_) {}
  try { if (window.DeviceOrientationEvent?.requestPermission) asks.push(DeviceOrientationEvent.requestPermission().catch(() => {})); } catch (_) {}
  if (!FORCED && !isStandalone() && document.documentElement.requestFullscreen && isTouch()) {
    asks.push(document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {}));
  }
  Promise.all(asks).then(next);
});

// ---------------- researcher check display (?debug=1): tracking status, frame rate, device position ----------------
if (DEBUG) {
  document.body.classList.add('debug');
  const box = document.createElement('div'); box.className = 'debug-box'; sceneEl.appendChild(box);
  let last = performance.now(), lastFrames = 0;
  setInterval(() => {
    const now = performance.now(), fps = (frames - lastFrames) * 1000 / (now - last); last = now; lastFrames = frames;
    const c = activeCam, p = new THREE.Vector3(); if (c) c.getWorldPosition(p);
    box.textContent = `mode: ${mode}\ntracking: ${mode === 'xr8' ? trackStatus + (trackReason ? ' (' + trackReason + ')' : '') : 'n/a'}\nfps: ${fps.toFixed(0)}\n` +
      `device: x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}  z ${p.z.toFixed(2)} m\nscale: ${XR_SCALE} (h ${EYE_H} m)  res: ${dpr()}x\nscreen: ${innerWidth}×${innerHeight}`;
  }, 500);
}

window.__ar3d = { finish: () => { tAnim = 0.999; }, setLevel: (lv) => { record('level', `level_${lv}`, { from: curLevel }); setLevel(lv); },
  get stats() { return { flowers: FL.length, animals: animals.length }; }, mode, U };

(async function load() {
  if (!FORCED || FORCED === 'xr8') loadXR8();   // start downloading the AR engine while the grassland loads
  $('#iosNote').hidden = !(isIOS && !isStandalone());
  try {
    const [g1, g3, g5, p1, p3, p5, h1, h3, h5, gi1, gi3, gi5, flowers, prof, wingInfo, bee, wing, bfly, lark] = await Promise.all([
      loadTex('assets/ground_L1.jpg'), loadTex('assets/ground_L3.jpg'), loadTex('assets/ground_L5.jpg'),
      loadTex('assets/pano_L1.jpg'), loadTex('assets/pano_L3.jpg'), loadTex('assets/pano_L5.jpg'),
      loadTex('assets/hr_L1.jpg'), loadTex('assets/hr_L3.jpg'), loadTex('assets/hr_L5.jpg'),
      loadImg('assets/ground_L1.jpg'), loadImg('assets/ground_L3.jpg'), loadImg('assets/ground_L5.jpg'),
      fetch('assets/flowers.json').then(r => r.json()), fetch('assets/profiles.json').then(r => r.json()), fetch('assets/bee_wing.json').then(r => r.json()),
      loadTex('assets/bee.png'), loadTex('assets/bee_wing.png'), loadTex('assets/butterfly.png'), loadTex('assets/skylark.png')]);
    const d3 = imageData(gi3); U.uSky.value.copy(skyColour(d3));
    photoTex.push(g1, g3, g5, p1, p3, p5, h1, h3, h5);
    buildPhotoScene({ g1, g3, g5, p1, p3, p5, h1, h3, h5, det: detailTexture() });
    buildGrass({ g1: imageData(gi1), g3: d3, g5: imageData(gi5) });
    buildFlowers(flowers); updateFlowers(wFrom, wTo, 1);
    buildAnimals(prof, { bee, wing, bfly, lark }, wingInfo);
    buildPins();
  } catch (err) { console.error('loading failed', err); showToast('Some files could not be loaded. Please reload the page.'); }
  setLevel(PRODUCT_LEVEL, true);
  $('#loading').hidden = true;
  if (FORCED === 'preview') { startScreen.hidden = true; next(); } else { startBtn.disabled = false; }
})();
