export const FIXED_DT = 1 / 120
export const TIE_EPS = 0.008
export const BRAKE_TIME = 0.14
export const BRAKE_COOLDOWN = 0.78

const DRAG = 0.36
const BALL_E = 1
const WALL_E = 0.84
const GRAVITY = 32
const BRAKE_DRAG = 28

export type BallKind = "player" | "enemy"
export type Phase = "title" | "play" | "pause" | "resolve" | "win" | "lose"

export type Ball = {
  id: number
  kind: BallKind
  name: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  r: number
  mass: number
  accel: number
  maxSpeed: number
  brain: number
  falling: boolean
  fallTime: number | null
  fallSpeed: number
  fallRadial: number
  swallowed: boolean
  flash: number
  scored: boolean
}

export type Hole = { x: number; z: number; r: number }
export type Pillar = { x: number; z: number; r: number }
export type Block = { x: number; z: number; hx: number; hz: number }

export type StageDef = {
  id: string
  name: string
  blurb: string
  half: number
  holes: Hole[]
  pillars: Pillar[]
  blocks: Block[]
  driftX: number
  driftZ: number
  player: { x: number; z: number }
  enemies: {
    name: string
    x: number
    z: number
    r: number
    accel: number
    maxSpeed: number
    brain: number
  }[]
}

export type ControlInput = {
  forward: number
  strafe: number
  brake: boolean
  lookLeft: boolean
  lookRight: boolean
}

export type FallRow = {
  name: string
  kind: BallKind
  time: number
  speed: number
  radial: number
}

export type Judgment = {
  outcome: "win" | "lose"
  headline: string
  detail: string
  rows: FallRow[]
}

export type Impact = {
  speed: number
  kind: "ball" | "wall" | "fall" | "brake" | "win" | "lose"
}

export type Sim = {
  t: number
  yaw: number
  slewLock: number
  stage: StageDef
  stageIndex: number
  stageCount: number
  balls: Ball[]
  brakeCd: number
  brakeLeft: number
  brakeLatch: boolean
  shake: number
  impacts: Impact[]
  phase: Phase
  resolveAt: number
  judgment: Judgment | null
  score: number
  best: number
  lives: number
  unlocked: number
  lastGain: number
  log: string[]
}

export type SimSeed = {
  score?: number
  best?: number
  lives?: number
  unlocked?: number
  stageIndex?: number
  stageCount?: number
  phase?: Phase
}

let nextId = 1

function massOf(r: number) {
  return r * r * r * 10
}

function makeBall(
  kind: BallKind,
  name: string,
  x: number,
  z: number,
  r: number,
  accel: number,
  maxSpeed: number,
  brain: number,
): Ball {
  return {
    id: nextId++,
    kind,
    name,
    x,
    y: r,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r,
    mass: massOf(r),
    accel,
    maxSpeed,
    brain,
    falling: false,
    fallTime: null,
    fallSpeed: 0,
    fallRadial: 0,
    swallowed: false,
    flash: 0,
    scored: false,
  }
}

export function createSim(stage: StageDef, seed: SimSeed = {}): Sim {
  const balls: Ball[] = [
    makeBall("player", "青玉", stage.player.x, stage.player.z, 0.52, 52, 26, 0),
  ]
  for (const e of stage.enemies) {
    balls.push(makeBall("enemy", e.name, e.x, e.z, e.r, e.accel, e.maxSpeed, e.brain))
  }
  return {
    t: 0,
    yaw: 0,
    slewLock: 0,
    stage,
    stageIndex: seed.stageIndex ?? 0,
    stageCount: seed.stageCount ?? 5,
    balls,
    brakeCd: 0,
    brakeLeft: 0,
    brakeLatch: false,
    shake: 0,
    impacts: [],
    phase: seed.phase ?? "title",
    resolveAt: 0,
    judgment: null,
    score: seed.score ?? 0,
    best: seed.best ?? 0,
    lives: seed.lives ?? 3,
    unlocked: seed.unlocked ?? 0,
    lastGain: 0,
    log: [],
  }
}

export function compareFall(a: Ball, b: Ball): number {
  const dt = (a.fallTime ?? 0) - (b.fallTime ?? 0)
  if (Math.abs(dt) > TIE_EPS) return dt
  const dr = a.fallRadial - b.fallRadial
  if (Math.abs(dr) > 0.15) return -dr
  const ds = a.fallSpeed - b.fallSpeed
  if (Math.abs(ds) > 0.15) return -ds
  if (a.kind !== b.kind) return a.kind === "enemy" ? -1 : 1
  return a.id - b.id
}

export function earlier(a: Ball, b: Ball): Ball {
  return compareFall(a, b) <= 0 ? a : b
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}

function wrapPi(d: number) {
  let x = d
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

function pushLog(sim: Sim, line: string) {
  sim.log.unshift(line)
  if (sim.log.length > 4) sim.log.length = 4
}

function bump(sim: Sim, speed: number) {
  if (speed > 4) sim.shake = Math.min(0.5, sim.shake + speed * 0.012)
}

function grantScore(sim: Sim, enemy: Ball) {
  if (enemy.scored) return
  const player = sim.balls[0]
  if (!player) return
  if (player.fallTime != null && earlier(enemy, player) !== enemy) return
  enemy.scored = true
  const gain = Math.round(50 + enemy.fallSpeed * 14)
  sim.score += gain
  sim.lastGain = gain
  if (sim.score > sim.best) sim.best = sim.score
}

function tiePhrase(a: Ball, b: Ball) {
  if (Math.abs(a.fallRadial - b.fallRadial) > 0.15) return "穴の中心へ向かう速さが上だった"
  if (Math.abs(a.fallSpeed - b.fallSpeed) > 0.15) return "勢いが上だった"
  return ""
}

function buildJudgment(sim: Sim, outcome: "win" | "lose"): Judgment {
  const player = sim.balls[0]!
  const enemies = sim.balls.slice(1)
  const fallen = sim.balls.filter((b) => b.fallTime != null).sort(compareFall)
  const rows: FallRow[] = fallen.map((b) => ({
    name: b.name,
    kind: b.kind,
    time: b.fallTime ?? 0,
    speed: b.fallSpeed,
    radial: b.fallRadial,
  }))
  const playerTime = player.fallTime
  const before = enemies.filter(
    (e) => e.fallTime != null && playerTime != null && earlier(e, player) === e,
  )
  const after = enemies.filter(
    (e) => e.fallTime != null && playerTime != null && earlier(e, player) === player,
  )
  const alive = enemies.filter((e) => e.fallTime == null)

  let headline: string
  let detail: string

  if (outcome === "win" && playerTime == null) {
    headline = "穴に落とした"
    detail = "赤玉はすべて穴の中。青玉は場に残った。"
  } else if (outcome === "win") {
    const foe = before[0]
    if (foe && foe.fallTime != null && playerTime != null) {
      const dt = Math.abs(playerTime - foe.fallTime)
      if (dt <= TIE_EPS) {
        const why = tiePhrase(player, foe) || "勢いが上だった"
        headline = `${foe.name}が先`
        detail = `同時落下（差 ${(dt * 1000).toFixed(1)}ms）。${foe.name}は${why}ため先落ち。`
      } else {
        headline = `${foe.name}が先`
        detail = `${foe.name}が ${(dt * 1000).toFixed(0)}ms 早く穴に入った。`
      }
    } else {
      headline = "穴に落とした"
      detail = "赤玉が先に落ちた。"
    }
  } else if (alive.length > 0 && before.length > 0) {
    headline = "まだ場にいる"
    detail = `${before.map((e) => e.name).join("、")}は先に落ちた。残ったのは${alive.map((e) => e.name).join("、")}。`
  } else if (playerTime != null && after[0]?.fallTime != null) {
    const foe = after[0]!
    const dt = Math.abs(playerTime - foe.fallTime!)
    if (dt <= TIE_EPS) {
      const why = tiePhrase(player, foe)
      headline = "青玉が先"
      detail = why
        ? `同時落下（差 ${(dt * 1000).toFixed(1)}ms）。青玉は${why}。`
        : `同時落下（差 ${(dt * 1000).toFixed(1)}ms）。数値が揃ったので青玉を先落ちとした。`
    } else {
      headline = "青玉が先に落ちた"
      detail = `青玉の方が ${(dt * 1000).toFixed(0)}ms 早かった。`
    }
  } else {
    headline = "青玉が先に落ちた"
    detail = alive.length > 0 ? "赤玉がまだ穴の外にいる。" : "穴に入った順で負け。"
  }

  return { outcome, headline, detail, rows }
}

function decide(sim: Sim): "win" | "lose" | null {
  const player = sim.balls[0]
  if (!player) return null
  const enemies = sim.balls.slice(1)
  const allDown = enemies.length > 0 && enemies.every((e) => e.fallTime != null)
  if (player.fallTime == null) return allDown ? "win" : null

  const pending = enemies.some((e) => e.fallTime == null || earlier(e, player) === player)
  if (!pending) return "win"
  if (sim.t < sim.resolveAt) return null
  return "lose"
}

function lockResult(sim: Sim, outcome: "win" | "lose") {
  if (sim.phase === "win" || sim.phase === "lose") return
  if (outcome === "win") {
    sim.unlocked = Math.max(
      sim.unlocked,
      Math.min(sim.stageCount - 1, sim.stageIndex + 1),
    )
  } else {
    sim.lives = Math.max(0, sim.lives - 1)
  }
  sim.phase = outcome
  sim.judgment = buildJudgment(sim, outcome)
  sim.impacts.push({ speed: 0, kind: outcome })
}

function capSpeed(ball: Ball) {
  const s = Math.hypot(ball.vx, ball.vz)
  if (s > ball.maxSpeed) {
    const k = ball.maxSpeed / s
    ball.vx *= k
    ball.vz *= k
  }
}

function drag(ball: Ball, dt: number, extra: number) {
  const k = Math.exp(-(DRAG + extra) * dt)
  ball.vx *= k
  ball.vz *= k
}

function aiAccel(ball: Ball, sim: Sim) {
  const player = sim.balls[0]!
  let ax = -sim.stage.driftX * 0.9
  let az = -sim.stage.driftZ * 0.9

  const panic = (cx: number, cz: number, rad: number, reach: number, power: number) => {
    const dx = ball.x - cx
    const dz = ball.z - cz
    const d = Math.hypot(dx, dz) || 0.0001
    const danger = rad + reach
    if (d >= danger) return
    const nx = dx / d
    const nz = dz / d
    const proximity = 1 - d / danger
    const toward = -(ball.vx * nx + ball.vz * nz)
    let push = power * proximity * proximity
    if (toward > 0) push += toward * 2.4 * proximity
    ax += nx * push
    az += nz * push
  }

  for (const h of sim.stage.holes) panic(h.x, h.z, h.r, ball.r + 2.6, 36)
  for (const p of sim.stage.pillars) panic(p.x, p.z, p.r, ball.r + 1.1, 26)
  for (const b of sim.stage.blocks) panic(b.x, b.z, Math.max(b.hx, b.hz), ball.r + 0.8, 20)

  if (sim.phase === "play" && !player.falling && !player.swallowed) {
    let best: Hole | null = null
    let bestScore = -1e9
    for (const h of sim.stage.holes) {
      const pd = Math.hypot(h.x - player.x, h.z - player.z)
      const ed = Math.hypot(h.x - ball.x, h.z - ball.z)
      let score = 16 - pd * 0.45
      if (ed + 0.4 < pd) score -= 5
      if (ed < h.r + ball.r + 1.2) score -= 8
      if (score > bestScore) {
        bestScore = score
        best = h
      }
    }
    if (best) {
      const pdx = best.x - player.x
      const pdz = best.z - player.z
      const pd = Math.hypot(pdx, pdz) || 1
      const pushX = pdx / pd
      const pushZ = pdz / pd
      const gap = player.r + ball.r + 0.45
      const sdx = player.x - pushX * gap - ball.x
      const sdz = player.z - pushZ * gap - ball.z
      const sd = Math.hypot(sdx, sdz) || 1
      const wob =
        Math.sin(sim.t * (1.4 + ball.id * 0.17) + ball.brain * 4) *
        (0.42 - ball.brain * 0.22)
      const wx = -pushZ * wob
      const wz = pushX * wob
      if (sd > 1.05) {
        ax += ((sdx / sd) * 0.92 + wx) * ball.accel
        az += ((sdz / sd) * 0.92 + wz) * ball.accel
      } else {
        ax += (pushX + wx * 0.35) * ball.accel
        az += (pushZ + wz * 0.35) * ball.accel
      }
      if (pd < best.r + 3.4 && sd < 2.2) {
        ax += pushX * ball.accel * 0.55
        az += pushZ * ball.accel * 0.55
      }
    }
  }

  const m = Math.hypot(ax, az)
  const cap = ball.accel * 1.45
  if (m > cap && cap > 0) {
    ax = (ax / m) * cap
    az = (az / m) * cap
  } else if (cap <= 0) {
    ax = 0
    az = 0
  }
  return { x: ax, z: az }
}

function resolveWalls(ball: Ball, sim: Sim) {
  if (ball.swallowed || ball.y < -0.3) return
  const lim = sim.stage.half - ball.r
  const hit = (speed: number) => {
    if (speed > 3) {
      sim.impacts.push({ speed, kind: "wall" })
      bump(sim, speed)
      ball.flash = Math.max(ball.flash, Math.min(1, speed / 16))
    }
  }
  if (ball.x > lim) {
    ball.x = lim
    if (ball.vx > 0) {
      hit(ball.vx)
      ball.vx *= -WALL_E
    }
  } else if (ball.x < -lim) {
    ball.x = -lim
    if (ball.vx < 0) {
      hit(-ball.vx)
      ball.vx *= -WALL_E
    }
  }
  if (ball.z > lim) {
    ball.z = lim
    if (ball.vz > 0) {
      hit(ball.vz)
      ball.vz *= -WALL_E
    }
  } else if (ball.z < -lim) {
    ball.z = -lim
    if (ball.vz < 0) {
      hit(-ball.vz)
      ball.vz *= -WALL_E
    }
  }
}

function resolvePillar(ball: Ball, p: Pillar, sim: Sim) {
  if (ball.swallowed || ball.y < -0.3) return
  let dx = ball.x - p.x
  let dz = ball.z - p.z
  let d = Math.hypot(dx, dz)
  const min = ball.r + p.r
  if (d >= min) return
  if (d < 1e-6) {
    dx = 1
    dz = 0
    d = 1
  }
  const nx = dx / d
  const nz = dz / d
  ball.x = p.x + nx * min
  ball.z = p.z + nz * min
  const vn = ball.vx * nx + ball.vz * nz
  if (vn < 0) {
    ball.vx -= (1 + WALL_E) * vn * nx
    ball.vz -= (1 + WALL_E) * vn * nz
    const sp = -vn
    if (sp > 3) {
      sim.impacts.push({ speed: sp, kind: "wall" })
      bump(sim, sp)
      ball.flash = Math.max(ball.flash, Math.min(1, sp / 16))
    }
  }
}

function resolveBlock(ball: Ball, b: Block, sim: Sim) {
  if (ball.swallowed || ball.y < -0.3) return
  const dx = ball.x - b.x
  const dz = ball.z - b.z
  const px = b.hx + ball.r - Math.abs(dx)
  const pz = b.hz + ball.r - Math.abs(dz)
  if (px <= 0 || pz <= 0) return
  if (px < pz) {
    const sx = dx >= 0 ? 1 : -1
    ball.x += sx * px
    if (ball.vx * sx < 0) {
      const sp = Math.abs(ball.vx)
      ball.vx = sx * sp * WALL_E
      if (sp > 3) {
        sim.impacts.push({ speed: sp, kind: "wall" })
        bump(sim, sp)
        ball.flash = Math.max(ball.flash, Math.min(1, sp / 16))
      }
    }
  } else {
    const sz = dz >= 0 ? 1 : -1
    ball.z += sz * pz
    if (ball.vz * sz < 0) {
      const sp = Math.abs(ball.vz)
      ball.vz = sz * sp * WALL_E
      if (sp > 3) {
        sim.impacts.push({ speed: sp, kind: "wall" })
        bump(sim, sp)
        ball.flash = Math.max(ball.flash, Math.min(1, sp / 16))
      }
    }
  }
}

function collideBalls(sim: Sim) {
  const balls = sim.balls
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i]!
        const b = balls[j]!
        if (a.swallowed || b.swallowed || a.y < -0.3 || b.y < -0.3) continue
        let dx = b.x - a.x
        let dz = b.z - a.z
        let d = Math.hypot(dx, dz)
        const min = a.r + b.r
        if (d >= min) continue
        if (d < 1e-6) {
          b.x += 0.02
          dx = 0.02
          dz = 0
          d = 0.02
        }
        const nx = dx / d
        const nz = dz / d
        const pen = min - d
        const share = 1 / (a.mass + b.mass)
        a.x -= nx * pen * b.mass * share
        a.z -= nz * pen * b.mass * share
        b.x += nx * pen * a.mass * share
        b.z += nz * pen * a.mass * share
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz
        if (rv >= 0) continue
        const impulse = -(1 + BALL_E) * rv / (1 / a.mass + 1 / b.mass)
        a.vx -= (impulse * nx) / a.mass
        a.vz -= (impulse * nz) / a.mass
        b.vx += (impulse * nx) / b.mass
        b.vz += (impulse * nz) / b.mass
        if (iter === 0) {
          const sp = -rv
          if (sp > 2.4) {
            sim.impacts.push({ speed: sp, kind: "ball" })
            bump(sim, sp)
            a.flash = Math.max(a.flash, Math.min(1, sp / 14))
            b.flash = Math.max(b.flash, Math.min(1, sp / 14))
          }
        }
      }
    }
  }
}

function settle(sim: Sim, dt: number) {
  sim.t += dt
  for (const ball of sim.balls) {
    if (!ball.falling) continue
    ball.vy -= GRAVITY * dt
    ball.y += ball.vy * dt
    ball.x += ball.vx * dt
    ball.z += ball.vz * dt
    ball.vx *= Math.exp(-0.6 * dt)
    ball.vz *= Math.exp(-0.6 * dt)
    if (ball.y < -6.5) {
      ball.y = -6.5
      ball.vy = 0
      ball.vx = 0
      ball.vz = 0
    }
    ball.flash = Math.max(0, ball.flash - dt * 2)
  }
  sim.shake *= Math.exp(-3 * dt)
}

export function step(sim: Sim, input: ControlInput, dt: number) {
  if (sim.phase === "title" || sim.phase === "pause") return
  if (sim.phase === "win" || sim.phase === "lose") {
    settle(sim, dt)
    return
  }

  const t0 = sim.t
  sim.t += dt
  const player = sim.balls[0]
  if (!player) return

  if (sim.brakeLeft > 0) sim.brakeLeft = Math.max(0, sim.brakeLeft - dt)
  if (sim.brakeCd > 0) sim.brakeCd = Math.max(0, sim.brakeCd - dt)
  if (!input.brake) sim.brakeLatch = false
  if (
    input.brake &&
    !sim.brakeLatch &&
    sim.brakeCd <= 0 &&
    sim.brakeLeft <= 0 &&
    sim.phase === "play" &&
    !player.falling
  ) {
    sim.brakeLeft = BRAKE_TIME
    sim.brakeCd = BRAKE_COOLDOWN
    sim.brakeLatch = true
    sim.impacts.push({ speed: Math.hypot(player.vx, player.vz), kind: "brake" })
  }

  if ((sim.phase === "play" || sim.phase === "resolve") && !player.falling) {
    if (input.lookLeft) {
      sim.yaw += 1.8 * dt
      sim.slewLock = 0.45
    }
    if (input.lookRight) {
      sim.yaw -= 1.8 * dt
      sim.slewLock = 0.45
    }
  }

  if (sim.phase === "play" && !player.falling) {
    const fx = -Math.sin(sim.yaw)
    const fz = -Math.cos(sim.yaw)
    const rx = Math.cos(sim.yaw)
    const rz = -Math.sin(sim.yaw)
    player.vx += (fx * input.forward + rx * input.strafe) * player.accel * dt
    player.vz += (fz * input.forward + rz * input.strafe) * player.accel * dt
  }

  for (const ball of sim.balls) {
    if (ball.swallowed) continue
    ball.flash = Math.max(0, ball.flash - dt * 3.2)
    if (ball.falling) {
      drag(ball, dt, 0.15)
      continue
    }
    ball.vx += sim.stage.driftX * dt
    ball.vz += sim.stage.driftZ * dt
    if (ball.kind === "enemy" && (sim.phase === "play" || sim.phase === "resolve")) {
      const a = aiAccel(ball, sim)
      ball.vx += a.x * dt
      ball.vz += a.z * dt
    }
    for (const h of sim.stage.holes) {
      const dx = ball.x - h.x
      const dz = ball.z - h.z
      const d = Math.hypot(dx, dz) || 0.0001
      const nx = dx / d
      const nz = dz / d
      const commit = h.r - ball.r * 0.2
      const lip = h.r + 0.42
      if (d < lip && d > commit) {
        const u = (lip - d) / (lip - commit)
        const pull = 22 * u * u
        ball.vx -= nx * pull * dt
        ball.vz -= nz * pull * dt
        if (d > h.r) {
          const outward = ball.vx * nx + ball.vz * nz
          const speed = Math.hypot(ball.vx, ball.vz)
          if (outward < -2 && -outward < speed * 0.42) {
            ball.vx -= (1 + 0.7) * outward * nx
            ball.vz -= (1 + 0.7) * outward * nz
            ball.flash = Math.max(ball.flash, 0.45)
          }
        }
      }
    }
    const extra = ball.kind === "player" && sim.brakeLeft > 0 ? BRAKE_DRAG : 0
    drag(ball, dt, extra)
    capSpeed(ball)
  }

  const origins = sim.balls.map((b) => ({ x: b.x, z: b.z }))
  for (const ball of sim.balls) {
    if (ball.swallowed) continue
    if (ball.falling) {
      ball.vy -= GRAVITY * dt
      ball.y += ball.vy * dt
      ball.x += ball.vx * dt
      ball.z += ball.vz * dt
      if (ball.y < -6.5) {
        ball.y = -6.5
        ball.vy = 0
        ball.vx = 0
        ball.vz = 0
        ball.swallowed = true
      }
      continue
    }
    ball.x += ball.vx * dt
    ball.z += ball.vz * dt
  }

  for (const ball of sim.balls) {
    if (ball.falling || ball.swallowed) continue
    for (const p of sim.stage.pillars) resolvePillar(ball, p, sim)
    for (const b of sim.stage.blocks) resolveBlock(ball, b, sim)
    resolveWalls(ball, sim)
  }
  collideBalls(sim)
  for (const ball of sim.balls) {
    if (ball.falling || ball.swallowed) continue
    resolveWalls(ball, sim)
  }

  const justFell: Ball[] = []
  for (let i = 0; i < sim.balls.length; i++) {
    const ball = sim.balls[i]!
    if (ball.falling || ball.swallowed) continue
    const origin = origins[i]!
    for (const h of sim.stage.holes) {
      const d0 = Math.hypot(origin.x - h.x, origin.z - h.z)
      const d1 = Math.hypot(ball.x - h.x, ball.z - h.z)
      const commit = h.r - ball.r * 0.2
      if (d1 >= commit) continue
      let alpha = 1
      if (d0 > commit && d0 !== d1) alpha = clamp((d0 - commit) / (d0 - d1), 0, 1)
      else if (d0 <= commit) alpha = 0
      const nd = d1 || 0.0001
      const nx = (ball.x - h.x) / nd
      const nz = (ball.z - h.z) / nd
      ball.falling = true
      ball.fallTime = t0 + alpha * dt
      ball.fallSpeed = Math.hypot(ball.vx, ball.vz)
      ball.fallRadial = Math.max(0, -(ball.vx * nx + ball.vz * nz))
      ball.vy = -3.5
      ball.flash = 1
      sim.impacts.push({ speed: ball.fallSpeed, kind: "fall" })
      bump(sim, ball.fallSpeed)
      justFell.push(ball)
      break
    }
  }

  for (const ball of sim.balls) {
    if (ball.falling || ball.swallowed) continue
    let dip = 0
    for (const h of sim.stage.holes) {
      const d = Math.hypot(ball.x - h.x, ball.z - h.z)
      const commit = h.r - ball.r * 0.2
      const lip = h.r + 0.42
      if (d < lip && d >= commit) {
        const u = (lip - d) / (lip - commit)
        dip = Math.max(dip, u * 0.16)
      }
    }
    ball.y = ball.r - dip
  }

  let playerJust = false
  for (const ball of justFell) {
    const stamp = (ball.fallTime ?? sim.t).toFixed(3)
    pushLog(sim, `${ball.name} 落下 ${stamp}s  勢い ${ball.fallSpeed.toFixed(1)}`)
    if (ball.kind === "enemy") grantScore(sim, ball)
    else playerJust = true
  }
  if (playerJust && player.fallTime != null && sim.phase === "play") {
    sim.phase = "resolve"
    sim.resolveAt = player.fallTime + 0.62
  }

  if (sim.phase === "play" || sim.phase === "resolve") {
    const outcome = decide(sim)
    if (outcome) lockResult(sim, outcome)
  }

  if (sim.slewLock > 0) sim.slewLock = Math.max(0, sim.slewLock - dt)
  const sp = Math.hypot(player.vx, player.vz)
  const steering = Math.abs(input.forward) + Math.abs(input.strafe) > 0.2
  if (
    sim.slewLock <= 0 &&
    sp > 2.4 &&
    !player.falling &&
    (sim.phase === "play" || sim.phase === "resolve")
  ) {
    const desired = Math.atan2(-player.vx, -player.vz)
    const maxStep = (steering ? 0.7 : 2.6) * dt
    const d = clamp(wrapPi(desired - sim.yaw), -maxStep, maxStep)
    sim.yaw += d
  }
  sim.shake *= Math.exp(-3.2 * dt)
}
