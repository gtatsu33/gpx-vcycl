import * as THREE from 'three'

const ROAD_HALF_W  = 4.0
const SHOULDER_W   = 2.0
const CAM_HEIGHT   = 1.5    // m above road
const LOOK_AHEAD   = 40     // m horizontal — drives left/right turn response
const LERP_FACTOR  = 0.25
const Y_EXAG       = 2.5    // vertical exaggeration for visual impact
const FADE_DIST    = 280    // m — fade to black over this distance
const FADE_MIN     = 0.0    // fade to black; fog blends to sky beyond
const SKY_HORIZON  = 0x0d2035
const SKY_CSS      = 'linear-gradient(to bottom,#060b12 0%,#0d2035 60%,#0e1820 100%)'
const EARTH_R      = 6_371_000
const DEG2RAD      = Math.PI / 180
const DARK         = 0.65

const ROAD_EASY    = new THREE.Color('#2ed573').multiplyScalar(DARK)  // < 3%
const ROAD_MOD     = new THREE.Color('#ffd32a').multiplyScalar(DARK)  // 3–6%
const ROAD_HARD    = new THREE.Color('#ff6348').multiplyScalar(DARK)  // 6–9%
const ROAD_STEEP   = new THREE.Color('#ff0000').multiplyScalar(DARK)  // 9–12%
const ROAD_EXTREME = new THREE.Color('#4C2E30').multiplyScalar(DARK)  // ≥ 12%
const SHOULDER_COL = new THREE.Color(0x282828)

function roadColor(gradPct) {
  if (gradPct < 3)  return ROAD_EASY    // downhill + flat + gentle uphill
  if (gradPct < 6)  return ROAD_MOD
  if (gradPct < 9)  return ROAD_HARD
  if (gradPct < 12) return ROAD_STEEP
  return ROAD_EXTREME
}

export class EleView {
  #container
  #renderer
  #scene
  #camera
  #mesh          = null
  #dashMesh      = null
  #dashNear      = null   // road-distance at near edge of each dash quad
  #dashFar       = null   // road-distance at far edge of each dash quad
  #pts3D         = null
  #route         = null
  #targetDistM   = 0
  #currentDistM  = 0
  #labelEl

  constructor(containerEl) {
    this.#container = containerEl
    containerEl.style.position   = 'relative'
    containerEl.style.overflow   = 'hidden'
    containerEl.style.background = SKY_CSS

    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    containerEl.appendChild(canvas)

    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.#renderer.setPixelRatio(window.devicePixelRatio)
    this.#renderer.setClearColor(0x000000, 0)  // transparent — CSS sky shows through

    this.#scene = new THREE.Scene()
    this.#scene.fog = new THREE.Fog(SKY_HORIZON, 160, 310)

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
    if (this.#dashMesh) {
      this.#scene.remove(this.#dashMesh)
      this.#dashMesh.geometry.dispose()
      this.#dashMesh = null
    }
    this.#pts3D = buildPts3D(route.points)
    this.#mesh  = buildRibbonMesh(this.#pts3D)
    this.#scene.add(this.#mesh)
    const { mesh: dm, nearM, farM } = buildDashMesh(this.#pts3D)
    this.#dashMesh = dm
    this.#dashNear = nearM
    this.#dashFar  = farM
    this.#scene.add(this.#dashMesh)
    this.#currentDistM = this.#targetDistM
    this.#updateCameraAt(this.#currentDistM)
    this.#updateVertexColors()
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
    const eyeY = cam.y + CAM_HEIGHT
    this.#camera.position.set(cam.x, eyeY, cam.z)
    // Vertical gaze fixed at rider eye level — road rises/falls relative to this line.
    // Horizontal (x/z) tracks the route for turn responsiveness.
    this.#camera.lookAt(look.x, eyeY - 0.2, look.z)
  }

  // Bake distance-based brightness fade into vertex colors for the visible window.
  #updateVertexColors() {
    if (!this.#mesh || !this.#pts3D) return
    const colAttr  = this.#mesh.geometry.attributes.color
    const pts      = this.#pts3D
    const camDistM = this.#currentDistM
    const V        = 4

    let lo = 0, hi = pts.length - 1
    const minDist = camDistM - 50
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pts[mid].distM < minDist) lo = mid + 1; else hi = mid
    }
    for (let i = lo; i < pts.length; i++) {
      const pt    = pts[i]
      const ahead = pt.distM - camDistM
      if (ahead > FADE_DIST + 50) break
      const fade = depthFade(ahead)
      const rCol = roadColor(pt.grad)
      for (let v = 0; v < V; v++) {
        const b   = (i * V + v) * 3
        const col = (v === 0 || v === 3) ? SHOULDER_COL : rCol
        colAttr.array[b]     = col.r * fade
        colAttr.array[b + 1] = col.g * fade
        colAttr.array[b + 2] = col.b * fade
      }
    }
    colAttr.needsUpdate = true

    if (!this.#dashMesh || !this.#dashNear) return
    const dCol = this.#dashMesh.geometry.attributes.color
    const near = this.#dashNear
    let dlo = 0, dhi = near.length - 1
    while (dlo < dhi) {
      const dm = (dlo + dhi) >> 1
      if (near[dm] < camDistM - 50) dlo = dm + 1; else dhi = dm
    }
    for (let i = dlo; i < near.length; i++) {
      if (near[i] - camDistM > FADE_DIST + 50) break
      // v0,v1 = near edge; v2,v3 = far edge — fade per vertex for accuracy
      const fadeN = depthFade(near[i] - camDistM)
      const fadeF = depthFade(this.#dashFar[i] - camDistM)
      const b0 = i * 4 * 3
      dCol.array[b0]      = dCol.array[b0 + 1]  = dCol.array[b0 + 2]  = fadeN
      dCol.array[b0 + 3]  = dCol.array[b0 + 4]  = dCol.array[b0 + 5]  = fadeN
      dCol.array[b0 + 6]  = dCol.array[b0 + 7]  = dCol.array[b0 + 8]  = fadeF
      dCol.array[b0 + 9]  = dCol.array[b0 + 10] = dCol.array[b0 + 11] = fadeF
    }
    dCol.needsUpdate = true
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
      if (this.#container.offsetParent === null) return
      if (this.#pts3D) {
        const delta = this.#targetDistM - this.#currentDistM
        if (Math.abs(delta) > 0.05) {
          this.#currentDistM += delta * LERP_FACTOR
          this.#updateCameraAt(this.#currentDistM)
          this.#updateVertexColors()
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
    y:     (pt.elevationM ?? 0) * Y_EXAG,
    z:    -(pt.lat - lat0) * EARTH_R * DEG2RAD,
    distM:  pt.distanceFromStartM,
    grad:   pt.gradientPercent ?? 0,
  }))
}

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
  const n  = pts3D.length
  const V  = 4   // outer-L, road-L, road-R, outer-R
  const positions = new Float32Array(n * V * 3)
  const colors    = new Float32Array(n * V * 3)   // all black initially

  for (let i = 0; i < n; i++) {
    const pt   = pts3D[i]
    const prev = pts3D[Math.max(0, i - 1)]
    const next = pts3D[Math.min(n - 1, i + 1)]

    const tx = next.x - prev.x, tz = next.z - prev.z
    const len = Math.sqrt(tx * tx + tz * tz) || 1
    const rx =  tz / len
    const rz = -tx / len

    const w = ROAD_HALF_W
    const s = ROAD_HALF_W + SHOULDER_W

    const setPos = (v, ox, oz) => {
      const b = (i * V + v) * 3
      positions[b] = pt.x + ox; positions[b + 1] = pt.y; positions[b + 2] = pt.z + oz
    }
    setPos(0, -rx * s, -rz * s)
    setPos(1, -rx * w, -rz * w)
    setPos(2,  rx * w,  rz * w)
    setPos(3,  rx * s,  rz * s)
  }

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

// Nonlinear depth fade: faster falloff near camera for perceptual clarity
function depthFade(aheadM) {
  const t = Math.max(0, Math.min(1, aheadM / FADE_DIST))
  return Math.pow(1 - t, 1.5)
}

function buildDashMesh(pts3D) {
  const DASH_LEN = 3.0
  const PERIOD   = 6.0    // 3m dash + 3m gap
  const DASH_W   = 0.15   // half-width of center line
  const Y_OFF    = 0.1    // above road surface to prevent z-fighting

  const posList = []
  const colList = []
  const idxList = []
  const nearM   = []   // road-distance at near edge of each quad
  const farM    = []   // road-distance at far edge of each quad
  let vi = 0

  for (let i = 0; i < pts3D.length - 1; i++) {
    const pt   = pts3D[i]
    const next = pts3D[i + 1]
    if ((pt.distM % PERIOD) > DASH_LEN) continue  // in gap phase

    const tx = next.x - pt.x, tz = next.z - pt.z
    const len = Math.sqrt(tx * tx + tz * tz) || 1
    const rx =  tz / len,  rz = -tx / len

    posList.push(
      pt.x   - rx * DASH_W,   pt.y   + Y_OFF, pt.z   - rz * DASH_W,  // v0 near-L
      pt.x   + rx * DASH_W,   pt.y   + Y_OFF, pt.z   + rz * DASH_W,  // v1 near-R
      next.x + rx * DASH_W,   next.y + Y_OFF, next.z + rz * DASH_W,  // v2 far-R
      next.x - rx * DASH_W,   next.y + Y_OFF, next.z - rz * DASH_W,  // v3 far-L
    )
    for (let v = 0; v < 4; v++) colList.push(0, 0, 0)
    idxList.push(vi, vi+1, vi+2, vi, vi+2, vi+3)
    nearM.push(pt.distM)
    farM.push(next.distM)
    vi += 4
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posList), 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(colList), 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idxList), 1))

  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    nearM,
    farM,
  }
}
