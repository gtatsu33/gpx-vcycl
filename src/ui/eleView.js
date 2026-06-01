import * as THREE from 'three'

const ROAD_HALF_W  = 4.0
const SHOULDER_W   = 2.0
const Y_EXAG       = 2.5    // vertical exaggeration for visual impact
const CAM_HEIGHT   = Y_EXAG * 1.8  // 1.8m real above road (world-space scaled)
const LOOK_AHEAD   = 5     // m horizontal — drives left/right turn response
const LERP_FACTOR  = 0.25
const FADE_DIST    = 280    // m — fade to black over this distance
const FADE_MIN     = 0.0    // fade to black; fog blends to sky beyond
const FOG_NEAR     = 20     // m — fog starts here
const FOG_FAR      = 220    // m — fog fully opaque here
const LOOK_Y_OFFSET = 0.75 // lookAt Y = eyeY + this; aligns road vanishing point with CSS horizon (~61.5% from top)
// [夜間] const SKY_HORIZON  = 0x1a3a5c
// [夜間] const SKY_CSS      = 'linear-gradient(to bottom,#0a1628 0%,#1a3a5c 60%,#142030 100%)'
// [昼間]
const SKY_HORIZON  = 0x4a7ab5
const SKY_CSS      = 'linear-gradient(to bottom,#1a3a6c 0%,#4a7ab5 58%,#1a0e05 65%,#7a5020 100%)'
const EARTH_R      = 6_371_000
const DEG2RAD      = Math.PI / 180
const DARK         = 0.65
const SIGN_INTERVAL_M = 1000  // 1km ごとに看板

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
  #dashNear      = null
  #dashFar       = null
  #edgeMesh      = null
  #edgeNear      = null
  #edgeFar       = null
  #pts3D         = null
  #route         = null
  #targetDistM   = 0
  #currentDistM  = 0
  #labelEl
  #signs    = []   // { distM, postMesh, panel }
  #wptSigns = []   // { distM, postMesh, panel }

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
    this.#scene.fog = new THREE.Fog(SKY_HORIZON, FOG_NEAR, FOG_FAR)

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
    if (this.#edgeMesh) {
      this.#scene.remove(this.#edgeMesh)
      this.#edgeMesh.geometry.dispose()
      this.#edgeMesh = null
    }
    this.#pts3D = buildPts3D(route.points)
    this.#mesh  = buildRibbonMesh(this.#pts3D)
    this.#scene.add(this.#mesh)
    const { mesh: dm, nearM: dNear, farM: dFar } = buildDashMesh(this.#pts3D)
    this.#dashMesh = dm
    this.#dashNear = dNear
    this.#dashFar  = dFar
    this.#scene.add(this.#dashMesh)
    const { mesh: em, nearM: eNear, farM: eFar } = buildEdgeMesh(this.#pts3D)
    this.#edgeMesh = em
    this.#edgeNear = eNear
    this.#edgeFar  = eFar
    this.#scene.add(this.#edgeMesh)
    this.#currentDistM = this.#targetDistM
    this.#updateCameraAt(this.#currentDistM)
    this.#updateVertexColors()
    this.#updateLabel()
    this.#buildSigns()
    this.#buildWptSigns()
  }

  update(distanceM) {
    this.#targetDistM = distanceM
    this.#updateLabel()
    this.#updateSignVisibility(distanceM, this.#signs)
    this.#updateSignVisibility(distanceM, this.#wptSigns)
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
    this.#camera.lookAt(look.x, eyeY + LOOK_Y_OFFSET, look.z)
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

    fadeLineMesh(this.#dashMesh, this.#dashNear, this.#dashFar, camDistM)
    fadeLineMesh(this.#edgeMesh, this.#edgeNear, this.#edgeFar, camDistM)
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

  #buildSigns() {
    for (const s of this.#signs) {
      this.#scene.remove(s.postMesh)
      s.postMesh.geometry.dispose()
      this.#scene.remove(s.panel)
      s.panel.material.map.dispose()
      s.panel.material.dispose()
    }
    this.#signs = []
    if (!this.#pts3D || !this.#route) return

    const totalM = this.#route.totalDistanceM
    for (let km = 1; km * SIGN_INTERVAL_M < totalM; km++) {
      const distM = km * SIGN_INTERVAL_M
      const { sx, sy, sz } = signPos(this.#pts3D, distM, +1)

      const postGeo  = new THREE.BoxGeometry(0.15, 2.5, 0.15)
      const postMesh = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x888888 }))
      postMesh.position.set(sx, sy + 1.25, sz)
      this.#scene.add(postMesh)

      const panel = makeSignSprite(
        `${km}km`,
        `あと${((totalM - distM) / 1000).toFixed(1)}km`,
        'rgba(20,30,40,0.92)', 'rgba(140,180,220,0.7)',
        '#e8f0f8', 'rgba(160,195,220,0.85)',
      )
      panel.position.set(sx, sy + 2.5 + panel.scale.y / 2, sz)
      this.#scene.add(panel)

      this.#signs.push({ distM, postMesh, panel })
    }
  }

  #updateSignVisibility(distanceM, list) {
    for (const s of list) {
      const ahead = s.distM - distanceM
      const vis = ahead > -5 && ahead < FADE_DIST
      s.postMesh.visible = vis
      s.panel.visible    = vis
    }
  }

  #buildWptSigns() {
    for (const s of this.#wptSigns) {
      this.#scene.remove(s.postMesh)
      s.postMesh.geometry.dispose()
      this.#scene.remove(s.panel)
      s.panel.material.map.dispose()
      s.panel.material.dispose()
    }
    this.#wptSigns = []
    if (!this.#pts3D || !this.#route) return

    for (const wp of this.#route.waypoints) {
      const { sx, sy, sz } = signPos(this.#pts3D, wp.distanceM, -1)

      const postGeo  = new THREE.BoxGeometry(0.15, 2.5, 0.15)
      const postMesh = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x888888 }))
      postMesh.position.set(sx, sy + 1.25, sz)
      this.#scene.add(postMesh)

      const panel = makeSignSprite(
        wp.name, null,
        'rgba(15,35,20,0.92)', 'rgba(100,200,140,0.6)',
        '#b8f0cc', null,
      )
      panel.position.set(sx, sy + 2.5 + panel.scale.y / 2, sz)
      this.#scene.add(panel)

      this.#wptSigns.push({ distM: wp.distanceM, postMesh, panel })
    }
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

// 道路端の3D座標を返す。side: +1=右, -1=左
function signPos(pts3D, distM, side) {
  const pt   = interpPt(pts3D, distM)
  const prev = interpPt(pts3D, distM - 1)
  const next = interpPt(pts3D, distM + 1)
  const tx = next.x - prev.x, tz = next.z - prev.z
  const len = Math.sqrt(tx * tx + tz * tz) || 1
  const rx =  tz / len, rz = -tx / len
  const offset = ROAD_HALF_W + SHOULDER_W + 0.5
  return { sx: pt.x + rx * offset * side, sy: pt.y, sz: pt.z + rz * offset * side }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function makeSignSprite(topText, bottomText, bgColor, borderColor, topColor, bottomColor) {
  const CW = 256
  const CH = bottomText ? 120 : 80
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = bgColor
  roundRect(ctx, 0, 0, CW, CH, 10)
  ctx.fill()

  ctx.strokeStyle = borderColor
  ctx.lineWidth = 4
  roundRect(ctx, 2, 2, CW - 4, CH - 4, 8)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (bottomText) {
    ctx.fillStyle = topColor
    ctx.font = 'bold 50px system-ui, sans-serif'
    ctx.fillText(topText, CW / 2, 50)
    ctx.fillStyle = bottomColor
    ctx.font = '34px system-ui, sans-serif'
    ctx.fillText(bottomText, CW / 2, 96)
  } else {
    ctx.fillStyle = topColor
    ctx.font = 'bold 44px system-ui, sans-serif'
    ctx.fillText(topText, CW / 2, CH / 2)
  }

  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  const sprite = new THREE.Sprite(mat)
  const worldW = 3.0
  sprite.scale.set(worldW, worldW * CH / CW, 1)
  return sprite
}

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

function buildLineMesh(pts3D, halfW, yOff, filterFn) {
  const posList = [], colList = [], idxList = [], nearM = [], farM = []
  let vi = 0
  for (let i = 0; i < pts3D.length - 1; i++) {
    const pt   = pts3D[i]
    const next = pts3D[i + 1]
    const segLen = next.distM - pt.distM
    if (segLen <= 0) continue
    const tx = next.x - pt.x, tz = next.z - pt.z
    const hLen = Math.sqrt(tx * tx + tz * tz) || 1
    const rx = tz / hLen, rz = -tx / hLen

    const intervals = filterFn(pt.distM, next.distM)
    for (const [d0, d1] of intervals) {
      const t0 = (d0 - pt.distM) / segLen
      const t1 = (d1 - pt.distM) / segLen
      const x0 = pt.x + (next.x - pt.x) * t0, y0 = pt.y + (next.y - pt.y) * t0, z0 = pt.z + (next.z - pt.z) * t0
      const x1 = pt.x + (next.x - pt.x) * t1, y1 = pt.y + (next.y - pt.y) * t1, z1 = pt.z + (next.z - pt.z) * t1
      posList.push(
        x0 - rx*halfW, y0 + yOff, z0 - rz*halfW,
        x0 + rx*halfW, y0 + yOff, z0 + rz*halfW,
        x1 + rx*halfW, y1 + yOff, z1 + rz*halfW,
        x1 - rx*halfW, y1 + yOff, z1 - rz*halfW,
      )
      for (let v = 0; v < 4; v++) colList.push(0, 0, 0)
      idxList.push(vi, vi+1, vi+2, vi, vi+2, vi+3)
      nearM.push(d0); farM.push(d1)
      vi += 4
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posList), 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(colList), 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idxList), 1))
  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    nearM, farM,
  }
}

function buildDashMesh(pts3D) {
  const DASH_LEN = 3.0, PERIOD = 6.0
  // Returns sub-intervals of [startD, endD] that fall in the dash phase
  const dashIntervals = (startD, endD) => {
    const result = []
    const firstP = Math.floor(startD / PERIOD)
    const lastP  = Math.floor(endD   / PERIOD)
    for (let p = firstP; p <= lastP; p++) {
      const s = Math.max(startD, p * PERIOD)
      const e = Math.min(endD,   p * PERIOD + DASH_LEN)
      if (s < e) result.push([s, e])
    }
    return result
  }
  return buildLineMesh(pts3D, 0.15, 0.10, dashIntervals)
}

function buildEdgeMesh(pts3D) {
  const makeEdgeSide = (side) => {
    const ox = side * ROAD_HALF_W   // lateral center offset
    const posList = [], colList = [], idxList = [], nearM = [], farM = []
    let vi = 0
    for (let i = 0; i < pts3D.length - 1; i++) {
      const pt   = pts3D[i]
      const next = pts3D[i + 1]
      const tx = next.x - pt.x, tz = next.z - pt.z
      const hLen = Math.sqrt(tx * tx + tz * tz) || 1
      const rx = tz / hLen, rz = -tx / hLen
      const hw = 0.15
      posList.push(
        pt.x   + rx*(ox-hw), pt.y   + 0.05, pt.z   + rz*(ox-hw),
        pt.x   + rx*(ox+hw), pt.y   + 0.05, pt.z   + rz*(ox+hw),
        next.x + rx*(ox+hw), next.y + 0.05, next.z + rz*(ox+hw),
        next.x + rx*(ox-hw), next.y + 0.05, next.z + rz*(ox-hw),
      )
      for (let v = 0; v < 4; v++) colList.push(1, 1, 1)
      idxList.push(vi, vi+1, vi+2, vi, vi+2, vi+3)
      nearM.push(pt.distM); farM.push(next.distM)
      vi += 4
    }
    return { posList, colList, idxList, nearM, farM }
  }

  const L = makeEdgeSide(-1), R = makeEdgeSide(+1)
  const offset = L.posList.length / 3
  const merged = {
    pos:  new Float32Array([...L.posList, ...R.posList]),
    col:  new Float32Array([...L.colList, ...R.colList]),
    idx:  new Uint32Array([...L.idxList, ...R.idxList.map(i => i + offset)]),
    nearM: [...L.nearM, ...R.nearM],
    farM:  [...L.farM,  ...R.farM],
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(merged.pos, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(merged.col, 3))
  geo.setIndex(new THREE.BufferAttribute(merged.idx, 1))
  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    nearM: merged.nearM, farM: merged.farM,
  }
}

function fadeLineMesh(mesh, nearM, farM, camDistM) {
  if (!mesh || !nearM) return
  const col = mesh.geometry.attributes.color
  let lo = 0, hi = nearM.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (nearM[mid] < camDistM - 50) lo = mid + 1; else hi = mid
  }
  for (let i = lo; i < nearM.length; i++) {
    if (nearM[i] - camDistM > FADE_DIST + 50) break
    const fN = depthFade(nearM[i] - camDistM)
    const fF = depthFade(farM[i]  - camDistM)
    const b = i * 12
    col.array[b]     = col.array[b+1]  = col.array[b+2]  = fN
    col.array[b+3]   = col.array[b+4]  = col.array[b+5]  = fN
    col.array[b+6]   = col.array[b+7]  = col.array[b+8]  = fF
    col.array[b+9]   = col.array[b+10] = col.array[b+11] = fF
  }
  col.needsUpdate = true
}
