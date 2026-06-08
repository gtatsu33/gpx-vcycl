import * as THREE from 'three'

const ROAD_HALF_W  = 8.0
const SHOULDER_W   = 2.0
const Y_EXAG       = 2.5    // vertical exaggeration for visual impact
const CAM_HEIGHT   = Y_EXAG * 3.0  // 3.0m real above road (world-space scaled)
const LOOK_AHEAD   = 5     // m horizontal — drives left/right turn response
const LERP_FACTOR  = 0.25
const FADE_DIST    = 280    // m — sign visibility cutoff
const AHEAD_M      = 800    // m — hard draw cap ahead of rider (safety net vs. spatial overlap)
const BEHIND_M     = 30     // m — also draw a little behind (camera sits above the road)
const FOG_NEAR     = 200    // m — distance fog starts
const FOG_FAR      = 800    // m — road fully blended into horizon here
const FOG_COLOR    = 0xcccccc  // 80% grey — objects fade to this at max distance, never going dark
const LOOK_Y_OFFSET = 0    // lookAt Y = eyeY + this; 0 = horizontal gaze, walls converge correctly
const SKY_CSS       = '#cccccc'
const WALL_BOTTOM_Y = -10 * Y_EXAG  // absolute world Y = real −10 m elevation
const EARTH_R      = 6_371_000
const DEG2RAD      = Math.PI / 180
const DARK         = 0.65
const SIGN_INTERVAL_M = 1000  // 1km ごとに看板

const ROAD_EASY    = new THREE.Color('#2ed573').multiplyScalar(DARK)  // < 3%
const ROAD_MOD     = new THREE.Color('#ffd32a').multiplyScalar(DARK)  // 3–6%
const ROAD_HARD    = new THREE.Color('#ee7800').multiplyScalar(DARK)  // 6–9%
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
  #wallMesh      = null
  #dashMesh      = null
  #edgeMesh      = null
  #ranged        = null   // [{ geo, distM, stride }] — per-frame setDrawRange window
  #pts3D         = null
  #route         = null
  #targetDistM   = 0
  #currentDistM  = 0
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
    // Distance dimming via real 3D camera-space fog — NOT along-route distM.
    // Switchbacks/折り返し are far in distM but spatially near; fog keeps them correct.
    this.#scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR)

    this.#camera = new THREE.PerspectiveCamera(50, 1, 0.5, 800)

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
    if (this.#wallMesh) {
      this.#scene.remove(this.#wallMesh)
      this.#wallMesh.geometry.dispose()
      this.#wallMesh = null
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
    this.#pts3D   = buildPts3D(route.points)
    const { mesh: rm, segDistM: rDistM } = buildRibbonMesh(this.#pts3D)
    this.#mesh = rm
    this.#scene.add(this.#mesh)
    const { mesh: wm, segDistM: wDistM, stride: wStride } = buildWallMesh(this.#pts3D)
    this.#wallMesh = wm
    this.#scene.add(this.#wallMesh)
    const { mesh: dm, nearM: dNear } = buildDashMesh(this.#pts3D)
    this.#dashMesh = dm
    this.#scene.add(this.#dashMesh)
    const { mesh: em, segDistM: eDistM, stride: eStride } = buildEdgeMesh(this.#pts3D)
    this.#edgeMesh = em
    this.#scene.add(this.#edgeMesh)

    // Each entry: distM[] is ascending; index buffer is grouped so group g occupies
    // [g*stride, (g+1)*stride). A distM window → one contiguous setDrawRange.
    this.#ranged = [
      { geo: this.#mesh.geometry,     distM: rDistM, stride: 6 },
      { geo: this.#wallMesh.geometry, distM: wDistM, stride: wStride },
      { geo: this.#dashMesh.geometry, distM: dNear,  stride: 6 },
      { geo: this.#edgeMesh.geometry, distM: eDistM, stride: eStride },
    ]

    this.#currentDistM = this.#targetDistM
    this.#updateCameraAt(this.#currentDistM)
    this.#updateDrawRange(this.#currentDistM)
    this.#buildSigns()
    this.#buildWptSigns()
  }

  update(distanceM) {
    this.#targetDistM = distanceM
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

  // Hard-cap rendering to the route window [cam - BEHIND_M, cam + AHEAD_M] so that
  // sections far along the route but spatially near (switchbacks/折り返し) are not drawn.
  // Each geometry's index buffer is distM-ascending, so the window is one draw range.
  // The cut at AHEAD_M sits well beyond FOG_FAR, so it is hidden by fog.
  #updateDrawRange(cam) {
    if (!this.#ranged) return
    const loM = Math.max(0, cam - BEHIND_M)
    const hiM = cam + AHEAD_M
    for (const r of this.#ranged) {
      const s = Math.max(0, lowerBound(r.distM, loM) - 1)  // -1 includes the segment under the camera
      const e = lowerBound(r.distM, hiM)
      r.geo.setDrawRange(s * r.stride, Math.max(0, e - s) * r.stride)
    }
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

      const postGeo  = new THREE.BoxGeometry(0.30, 8.0, 0.30)
      const postMesh = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x888888 }))
      postMesh.position.set(sx, sy + 1.0, sz)  // top at sy+5, bottom at sy-3 (into wall)
      this.#scene.add(postMesh)

      const panel = makeSignSprite(
        `${km}km`,
        `あと${((totalM - distM) / 1000).toFixed(1)}km`,
        'rgba(20,30,40,0.92)', 'rgba(140,180,220,0.7)',
        '#e8f0f8', 'rgba(160,195,220,0.85)',
      )
      panel.position.set(sx, sy + 5.0 + panel.scale.y / 2, sz)
      this.#scene.add(panel)

      this.#signs.push({ distM, postMesh, panel })
    }

    // Goal sign at the finish line
    const { sx: gx, sy: gy, sz: gz } = signPos(this.#pts3D, totalM, +1)
    const goalPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 8.0, 0.30),
      new THREE.MeshBasicMaterial({ color: 0xffd700 }),
    )
    goalPost.position.set(gx, gy + 1.0, gz)
    this.#scene.add(goalPost)

    const goalPanel = makeSignSprite(
      'ゴール', null,
      'rgba(20,40,10,0.92)', 'rgba(220,180,0,0.85)',
      '#ffd700', null,
    )
    goalPanel.position.set(gx, gy + 5.0 + goalPanel.scale.y / 2, gz)
    this.#scene.add(goalPanel)
    this.#signs.push({ distM: totalM, postMesh: goalPost, panel: goalPanel })
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

      const postGeo  = new THREE.BoxGeometry(0.30, 8.0, 0.30)
      const postMesh = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({ color: 0x888888 }))
      postMesh.position.set(sx, sy + 1.0, sz)
      this.#scene.add(postMesh)

      const panel = makeSignSprite(
        wp.name, null,
        'rgba(15,35,20,0.92)', 'rgba(100,200,140,0.6)',
        '#b8f0cc', null,
      )
      panel.position.set(sx, sy + 5.0 + panel.scale.y / 2, sz)
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
          this.#updateDrawRange(this.#currentDistM)
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
  const offset = ROAD_HALF_W + 0.5
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
  const CW = 512
  const CH = bottomText ? 240 : 160
  const canvas = document.createElement('canvas')
  canvas.width = CW; canvas.height = CH
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = bgColor
  roundRect(ctx, 0, 0, CW, CH, 20)
  ctx.fill()

  ctx.strokeStyle = borderColor
  ctx.lineWidth = 8
  roundRect(ctx, 4, 4, CW - 8, CH - 8, 16)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (bottomText) {
    ctx.fillStyle = topColor
    ctx.font = 'bold 100px system-ui, sans-serif'
    ctx.fillText(topText, CW / 2, 100)
    ctx.fillStyle = bottomColor
    ctx.font = '68px system-ui, sans-serif'
    ctx.fillText(bottomText, CW / 2, 192)
  } else {
    ctx.fillStyle = topColor
    ctx.font = 'bold 88px system-ui, sans-serif'
    ctx.fillText(topText, CW / 2, CH / 2)
  }

  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  const sprite = new THREE.Sprite(mat)
  const worldW = 6.0
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

// Precompute smoothed per-point perpendiculars using averaged adjacent-segment tangents.
// Adjacent segments share the same perp at their common point → no gaps at curves.
function smoothedPerps(pts3D) {
  const n = pts3D.length
  return pts3D.map((_, i) => {
    const prev = pts3D[Math.max(0, i - 1)]
    const next = pts3D[Math.min(n - 1, i + 1)]
    const tx = next.x - prev.x, tz = next.z - prev.z
    const len = Math.sqrt(tx * tx + tz * tz) || 1
    return { rx: tz / len, rz: -tx / len }
  })
}

function buildWallMesh(pts3D) {
  const n    = pts3D.length
  const segs = n - 1
  const pos      = new Float32Array(segs * 2 * 4 * 3)
  const col      = new Float32Array(segs * 2 * 4 * 3)
  const idx      = new Uint32Array(segs * 2 * 6)
  const segDistM = new Float32Array(segs)  // ascending; both walls of a segment share one entry
  let vi = 0, ki = 0
  const perps = smoothedPerps(pts3D)

  for (let i = 0; i < segs; i++) {
    const pt   = pts3D[i]
    const next = pts3D[i + 1]
    const { rx: rx0, rz: rz0 } = perps[i]
    const { rx: rx1, rz: rz1 } = perps[i + 1]
    segDistM[i] = pt.distM

    // Top = full road color; bottom = black (vertical gradient).
    const rc = roadColor(pt.grad)
    // Emit both walls of this segment together → index buffer stays distM-ascending.
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1
      const ox0  = rx0 * sign * ROAD_HALF_W, oz0 = rz0 * sign * ROAD_HALF_W
      const ox1  = rx1 * sign * ROAD_HALF_W, oz1 = rz1 * sign * ROAD_HALF_W
      const setV = (v, x, y, z, f) => {
        const pb = (vi + v) * 3
        pos[pb] = x; pos[pb + 1] = y; pos[pb + 2] = z
        col[pb] = rc.r * f; col[pb + 1] = rc.g * f; col[pb + 2] = rc.b * f
      }
      setV(0, pt.x   + ox0, pt.y,          pt.z   + oz0, 1)  // top-near
      setV(1, next.x + ox1, next.y,        next.z + oz1, 1)  // top-far
      setV(2, next.x + ox1, WALL_BOTTOM_Y, next.z + oz1, 0)  // bottom-far  (black)
      setV(3, pt.x   + ox0, WALL_BOTTOM_Y, pt.z   + oz0, 0)  // bottom-near (black)

      idx[ki++] = vi; idx[ki++] = vi + 1; idx[ki++] = vi + 2
      idx[ki++] = vi; idx[ki++] = vi + 2; idx[ki++] = vi + 3
      vi += 4
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    segDistM,
    stride: 12,  // 2 walls × 6 indices per segment
  }
}

function buildRibbonMesh(pts3D) {
  const n    = pts3D.length
  const segs = n - 1
  const pos      = new Float32Array(segs * 4 * 3)
  const colors   = new Float32Array(segs * 4 * 3)
  const indices  = new Uint32Array(segs * 6)
  const segDistM = new Float32Array(segs)
  const perps    = smoothedPerps(pts3D)
  let vi = 0, ki = 0

  for (let i = 0; i < segs; i++) {
    const pt   = pts3D[i]
    const next = pts3D[i + 1]
    const { rx: rx0, rz: rz0 } = perps[i]
    const { rx: rx1, rz: rz1 } = perps[i + 1]
    segDistM[i] = pt.distM

    const c = roadColor(pt.grad)
    const w = ROAD_HALF_W
    const setV = (v, x, y, z) => {
      const b = (vi + v) * 3
      pos[b] = x; pos[b + 1] = y; pos[b + 2] = z
      colors[b] = c.r; colors[b + 1] = c.g; colors[b + 2] = c.b
    }
    setV(0, pt.x   - rx0 * w, pt.y,   pt.z   - rz0 * w)  // near-left
    setV(1, pt.x   + rx0 * w, pt.y,   pt.z   + rz0 * w)  // near-right
    setV(2, next.x + rx1 * w, next.y, next.z + rz1 * w)  // far-right
    setV(3, next.x - rx1 * w, next.y, next.z - rz1 * w)  // far-left

    indices[ki++] = vi; indices[ki++] = vi + 1; indices[ki++] = vi + 2
    indices[ki++] = vi; indices[ki++] = vi + 2; indices[ki++] = vi + 3
    vi += 4
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    segDistM,
  }
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
      for (let v = 0; v < 4; v++) colList.push(1, 1, 1)
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
  const segs = pts3D.length - 1
  const pos      = new Float32Array(segs * 2 * 4 * 3)
  const col      = new Float32Array(segs * 2 * 4 * 3)
  const idx      = new Uint32Array(segs * 2 * 6)
  const segDistM = new Float32Array(segs)  // ascending; both edges of a segment share one entry
  const hw = 0.15
  let vi = 0, ki = 0
  const perps = smoothedPerps(pts3D)

  for (let i = 0; i < segs; i++) {
    const pt   = pts3D[i]
    const next = pts3D[i + 1]
    const { rx: rx0, rz: rz0 } = perps[i]
    const { rx: rx1, rz: rz1 } = perps[i + 1]
    segDistM[i] = pt.distM

    // Emit both edge lines of this segment together → index buffer stays distM-ascending.
    for (let side = 0; side < 2; side++) {
      const ox = (side === 0 ? -1 : 1) * ROAD_HALF_W
      const b3 = vi * 3
      pos.set([
        pt.x   + rx0*(ox-hw), pt.y   + 0.05, pt.z   + rz0*(ox-hw),
        pt.x   + rx0*(ox+hw), pt.y   + 0.05, pt.z   + rz0*(ox+hw),
        next.x + rx1*(ox+hw), next.y + 0.05, next.z + rz1*(ox+hw),
        next.x + rx1*(ox-hw), next.y + 0.05, next.z + rz1*(ox-hw),
      ], b3)
      for (let v = 0; v < 4; v++) { const c = (vi + v) * 3; col[c] = 1; col[c + 1] = 1; col[c + 2] = 1 }
      idx[ki++] = vi; idx[ki++] = vi + 1; idx[ki++] = vi + 2
      idx[ki++] = vi; idx[ki++] = vi + 2; idx[ki++] = vi + 3
      vi += 4
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return {
    mesh: new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })),
    segDistM,
    stride: 12,  // 2 edges × 6 indices per segment
  }
}

// (distance dimming now handled by THREE.Fog — see scene.fog)

// First index i in ascending `arr` with arr[i] >= value (arr.length if none).
function lowerBound(arr, value) {
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < value) lo = mid + 1; else hi = mid
  }
  return lo
}
