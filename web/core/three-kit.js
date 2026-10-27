/* three.js scaffolding shared by every 3D element. `three` resolves via the import map in index.html (three@0.160.0).
 *
 *   const stage = await createStage(hostEl, { camera: { fov: 45, z: 12 }, controls: true });
 *   stage.scene.add(mesh);
 *   stage.onFrame((t, dt) => { mesh.rotation.y += dt * 0.2; });
 *   ...
 *   stage.dispose();   // on view cleanup
 *
 * The stage sizes itself to the host (ResizeObserver), pauses when the host is offscreen or hidden,
 * caps DPR at 2, and exposes pick(x, y, objects) for pointer hit-testing. If WebGL is not available
 * it resolves to null, and callers must render a 2D fallback. */
let THREE_P = null;
export const loadThree = () => (THREE_P ||= import('three'));
export const loadControls = () => import('three/addons/controls/OrbitControls.js');

export function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export async function createStage(host, opts = {}) {
  if (!webglOK()) return null;
  const THREE = await loadThree();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = opts.camera || {};
  const camera = new THREE.PerspectiveCamera(cam.fov ?? 45, 1, cam.near ?? 0.1, cam.far ?? 500);
  camera.position.set(cam.x ?? 0, cam.y ?? 0, cam.z ?? 12);
  camera.lookAt(0, 0, 0);
  let controls = null;
  if (opts.controls) {
    const { OrbitControls } = await loadControls();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
    controls.minDistance = opts.controls.minDistance ?? 4; controls.maxDistance = opts.controls.maxDistance ?? 40;
    controls.autoRotate = !!opts.controls.autoRotate; controls.autoRotateSpeed = opts.controls.autoRotateSpeed ?? 0.6;
    if (opts.controls.noZoom) controls.enableZoom = false;
  }
  const frames = new Set();
  let visible = true, raf = 0, last = performance.now(), disposed = false;
  const size = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(size); ro.observe(host); size();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }, { threshold: 0 });
  io.observe(host);
  const t0 = performance.now();
  function loop() {
    if (disposed || raf) return;
    raf = requestAnimationFrame((now) => {
      raf = 0;
      if (!visible || document.hidden || host.offsetParent === null) { last = now; setTimeout(loop, 250); return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (const f of frames) f((now - t0) / 1000, dt);
      controls?.update();
      renderer.render(scene, camera);
      loop();
    });
  }
  loop();
  const raycaster = new THREE.Raycaster();
  return {
    THREE, renderer, scene, camera, controls, canvas: renderer.domElement,
    onFrame(fn) { frames.add(fn); return () => frames.delete(fn); },
    /** clientX/clientY -> first intersection among objects (or null) */
    pick(clientX, clientY, objects, recursive = false) {
      const r = renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(v, camera);
      return raycaster.intersectObjects(objects, recursive)[0] || null;
    },
    raycaster,
    resize: size,
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls?.dispose();
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}

/** Soft round sprite texture for points (glowing dots). */
export function dotTexture(THREE, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.85)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
