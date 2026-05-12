import * as THREE from 'three'

const ROAD_HALF_W  = 4.0   // m — half-width of road surface
const SHOULDER_W   = 2.0   // m — each side beyond road edge
const CAM_HEIGHT   = 2.0   // m — camera above road surface
const LOOK_AHEAD   = 40    // m — look-at target ahead of camera
const LERP_FACTOR  = 0.25  // per-frame lerp coefficient for smooth camera
const BG_COLOR     = 0x0e1820
const EARTH_R      = 6_371_000
const DEG2RAD      = Math.PI / 180

const COLOR_EASY    = new THREE.Color('#2ed573')
const COLOR_MOD     = new THREE.Color('#ffd32a')
const COLOR_HARD    = new THREE.Color('#ff6348')
const COLOR_STEEP   = new THREE.Color('#ff0000')
const COLOR_EXTREME = new THREE.Color('#4C2E30')
const COLOR_SHOULDER = new THREE.Color(0x1a2a35)

function roadColor(gradPct) {
  const a = Math.abs(gradPct)
  if (a < 3)  return COLOR_EASY
  if (a < 6)  return COLOR_MOD
  if (a < 9)  return COLOR_HARD
  if (a < 12) return COLOR_STEEP
  return COLOR_EXTREME
}

export class EleView {
  #container
  #renderer
  #scene
  #camera
  #mesh         = null
  #pts3D        = null
  #route        = null
  #targetDistM  = 0
  #currentDistM = 0
  #labelEl

  constructor(containerEl) {
    this.#container = containerEl
    containerEl.style.position = 'relative'
    containerEl.style.overflow = 'hidden'

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    containerEl.appendChild(canvas)

    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.#renderer.setPixelRatio(window.devicePixelRatio)
    this.#renderer.setClearColor(BG_COLOR)

    this.#scene = new THREE.Scene()
    this.#scene.background = new THREE.Color(BG_COLOR)
    this.#scene.fog = new THREE.Fog(BG_COLOR, 5, 530)

    this.#camera = new THREE.PerspectiveCamera(65, 1, 0.5, 800)

    const label = document.createElement('div')
    label.style.cssText = [
      'position:absolute;inset:0;pointer-events:none',
      'display:flex;justify-content:space-between;align-items:flex-start',
      'padding:6px 8px;font:11px system-ui,sans-serif;color:rgba(160,195,220,0.75)',
    ].join(';')
    this.#labelEl = label
    containerEl.appendChild(label)

    new ResizeObserver(() => this.#syncSize()).observe(containerEl)
    this.#syncSize()
    this.#startLoop()
  }

  setRoute(route) {
    this.#route = route
    if (this.#mesh) {
      this.#scene.remove(this.#mesh)
      this.#mesh.geometry.dispose()
      this.#mesh = null
    }
    this.#pts3D       = buildPts3D(route.points)
    this.#mesh        = buildRibbonMesh(this.#pts3D)
    this.#scene.add(this.#mesh)
    this.#currentDistM = this.#targetDistM
    this.#updateCameraAt(this.#currentDistM)
    this.#updateLabel()
  }

  update(distanceM) {
    this.#targetDistM = distanceM
    this.#updateLabel()
  }

  resize() { this.#syncSize() }

  // ── private ──────────────────────────────────────────────────────────

  #syncSize() {
    const rect = this.#container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.#renderer.setSize(rect.width, rect.height, false)
    this.#camera.aspect = rect.width / rect.height
    this.#camera.updateProjectionMatrix()
  }

  #updateCameraAt(distM) {
    if (!this.#pts3D) return
    const cam  = interpPt(this.#pts3D, distM)
    const look = interpPt(this.#pts3D, distM + LOOK_AHEAD)
    this.#camera.position.set(cam.x, cam.y + CAM_HEIGHT, cam.z)
    this.#camera.lookAt(look.x, look.y + 1.0, look.z)
  }

  #updateLabel() {
    if (!this.#route) { this.#labelEl.innerHTML = ''; return }
    const totalDistM = this.#route.totalDistanceM
    const aheadM     = Math.min(500, totalDistM - this.#targetDistM)
    const e0 = this.#route.getElevationAt(this.#targetDistM)
    const e1 = this.#route.getElevationAt(this.#targetDistM + aheadM)
    const avg  = (e0 !== null && e1 !== null) ? ((e1 - e0) / aheadM) * 100 : 0
    const sign = avg >= 0 ? '+' : ''
    this.#labelEl.innerHTML =
      `<span>Ahead ${Math.round(aheadM)}m</span><span>avg ${sign}${avg.toFixed(1)}%</span>`
  }

  #startLoop() {
    const tick = () => {
      requestAnimationFrame(tick)
      if (this.#container.offsetParent === null) return   // hidden — skip render
      if (this.#pts3D) {
        const delta = this.#targetDistM - this.#currentDistM
        if (Math.abs(delta) > 0.05) {
          this.#currentDistM += delta * LERP_FACTOR
          this.#updateCameraAt(this.#currentDistM)
        }
      }
      this.#renderer.render(this.#scene, this.#camera)
    }
    tick()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildPts3D(points) {
  const lat0   = points[0].lat
  const lon0   = points[0].lon
  const cosLat = Math.cos(lat0 * DEG2RAD)
  return points.map(pt => ({
    x:     (pt.lon - lon0) * cosLat * EARTH_R * DEG2RAD,
    y:      pt.elevationM ?? 0,
    z:    -(pt.lat - lat0) * EARTH_R * DEG2RAD,
    distM:  pt.distanceFromStartM,
    grad:   pt.gradientPercent ?? 0,
  }))
}

// Binary-search interpolation along the route
function interpPt(pts3D, distM) {
  if (distM <= pts3D[0].distM)                return pts3D[0]
  if (distM >= pts3D[pts3D.length - 1].distM) return pts3D[pts3D.length - 1]
  let lo = 0, hi = pts3D.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts3D[mid].distM <= distM) lo = mid; else hi = mid
  }
  const a = pts3D[lo], b = pts3D[hi]
  const t = (distM - a.distM) / (b.distM - a.distM)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

function buildRibbonMesh(pts3D) {
  const n = pts3D.length
  // 4 vertices per cross-section: outer-L, road-L, road-R, outer-R
  const V         = 4
  const positions = new Float32Array(n * V * 3)
  const colors    = new Float32Array(n * V * 3)

  for (let i = 0; i < n; i++) {
    const pt   = pts3D[i]
    const prev = pts3D[Math.max(0, i - 1)]
    const next = pts3D[Math.min(n - 1, i + 1)]

    // Right vector: rotate tangent 90° CW in XZ plane
    const tx = next.x - prev.x
    const tz = next.z - prev.z
    const len = Math.sqrt(tx * tx + tz * tz) || 1
    const rx =  tz / len
    const rz = -tx / len

    const rCol = roadColor(pt.grad)
    const w = ROAD_HALF_W
    const s = ROAD_HALF_W + SHOULDER_W

    const setV = (v, ox, oz, col) => {
      const b = (i * V + v) * 3
      positions[b]     = pt.x + ox;  positions[b + 1] = pt.y;  positions[b + 2] = pt.z + oz
      colors[b]     = col.r;          colors[b + 1] = col.g;   colors[b + 2] = col.b
    }

    setV(0, -rx * s, -rz * s, COLOR_SHOULDER)
    setV(1, -rx * w, -rz * w, rCol)
    setV(2,  rx * w,  rz * w, rCol)
    setV(3,  rx * s,  rz * s, COLOR_SHOULDER)
  }

  // 3 quads per adjacent cross-section pair × 2 triangles × 3 indices
  const indices = new Uint32Array((n - 1) * 3 * 6)
  let k = 0
  for (let i = 0; i < n - 1; i++) {
    const a = i * V, b = (i + 1) * V
    for (let q = 0; q < 3; q++) {
      indices[k++] = a+q;   indices[k++] = b+q;   indices[k++] = a+q+1
      indices[k++] = a+q+1; indices[k++] = b+q;   indices[k++] = b+q+1
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))

  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  }))
}
