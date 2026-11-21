import assert from "node:assert/strict"
import test from "node:test"
import { createSim, earlier, step, type ControlInput, type StageDef } from "./sim.ts"

const idle: ControlInput = {
  forward: 0,
  strafe: 0,
  brake: false,
  lookLeft: false,
  lookRight: false,
}

function arena(partial: Partial<StageDef> = {}): StageDef {
  return {
    id: "t",
    name: "t",
    blurb: "",
    half: 20,
    holes: [{ x: 0, z: 0, r: 2 }],
    pillars: [],
    blocks: [],
    driftX: 0,
    driftZ: 0,
    player: { x: 10, z: 10 },
    enemies: [{ name: "赤玉", x: -10, z: 8, r: 0.5, accel: 0, maxSpeed: 30, brain: 0 }],
    ...partial,
  }
}

test("enemy already in the hole is a win and scores", () => {
  const sim = createSim(arena(), { phase: "play", stageCount: 1 })
  const enemy = sim.balls[1]!
  enemy.x = 0
  enemy.z = 0
  step(sim, idle, 1 / 120)
  assert.equal(enemy.falling, true)
  assert.equal(sim.balls[0]!.falling, false)
  assert.equal(sim.phase, "win")
  assert.ok(sim.score > 0)
  assert.match(sim.judgment?.headline ?? "", /穴|赤玉/)
})

test("player in the hole first is a loss after the resolve window", () => {
  const sim = createSim(arena(), { phase: "play", lives: 3, stageCount: 1 })
  const player = sim.balls[0]!
  player.x = 0
  player.z = 0
  step(sim, idle, 1 / 120)
  assert.equal(player.falling, true)
  assert.equal(sim.phase, "resolve")
  for (let i = 0; i < 90; i++) step(sim, idle, 1 / 120)
  assert.equal(sim.phase, "lose")
  assert.equal(sim.lives, 2)
  assert.match(sim.judgment?.headline ?? "", /青玉/)
})

test("same-step falls pick the earlier interpolated time", () => {
  const sim = createSim(arena(), { phase: "play", stageCount: 1 })
  const player = sim.balls[0]!
  const enemy = sim.balls[1]!
  player.x = 2.05
  player.z = 0
  player.vx = -28
  enemy.x = 0
  enemy.z = 2.05
  enemy.vz = -42
  step(sim, idle, 1 / 120)
  assert.equal(player.falling, true)
  assert.equal(enemy.falling, true)
  assert.ok((enemy.fallTime ?? 1) < (player.fallTime ?? 0))
  assert.equal(earlier(enemy, player), enemy)
  assert.equal(sim.phase, "win")
  assert.match(sim.judgment?.detail ?? "", /先/)
})

test("player crossing first loses even if the enemy follows", () => {
  const sim = createSim(arena(), { phase: "play", stageCount: 1 })
  const player = sim.balls[0]!
  const enemy = sim.balls[1]!
  player.x = 2.02
  player.z = 0
  player.vx = -48
  enemy.x = 0
  enemy.z = 2.35
  enemy.vz = -8
  step(sim, idle, 1 / 120)
  assert.equal(player.falling, true)
  for (let i = 0; i < 100; i++) step(sim, idle, 1 / 120)
  assert.equal(sim.phase, "lose")
  assert.ok((player.fallTime ?? 0) < (enemy.fallTime ?? 99))
})

test("A while moving forward increases yaw", () => {
  const sim = createSim(arena({ holes: [], enemies: [] }), { phase: "play" })
  const hold = { ...idle, forward: 1 }
  for (let i = 0; i < 72; i++) step(sim, hold, 1 / 120)
  assert.ok(Math.hypot(sim.balls[0]!.vx, sim.balls[0]!.vz) > 0.1)
  const y0 = sim.yaw
  const carve = { ...idle, forward: 1, strafe: -1 }
  for (let i = 0; i < 48; i++) step(sim, carve, 1 / 120)
  const d = Math.atan2(Math.sin(sim.yaw - y0), Math.cos(sim.yaw - y0))
  assert.ok(d > 0.05, `A should turn left, got ${d}`)
})

test("D while moving forward decreases yaw", () => {
  const sim = createSim(arena({ holes: [], enemies: [] }), { phase: "play" })
  const hold = { ...idle, forward: 1 }
  for (let i = 0; i < 72; i++) step(sim, hold, 1 / 120)
  const y0 = sim.yaw
  const carve = { ...idle, forward: 1, strafe: 1 }
  for (let i = 0; i < 48; i++) step(sim, carve, 1 / 120)
  const d = Math.atan2(Math.sin(sim.yaw - y0), Math.cos(sim.yaw - y0))
  assert.ok(d < -0.05, `D should turn right, got ${d}`)
})

test("brake is a single pulse", () => {
  const sim = createSim(arena({ holes: [], enemies: [] }), { phase: "play" })
  for (let i = 0; i < 80; i++) step(sim, { ...idle, forward: 1 }, 1 / 120)
  const before = Math.hypot(sim.balls[0]!.vx, sim.balls[0]!.vz)
  for (let i = 0; i < 18; i++) step(sim, { ...idle, brake: true }, 1 / 120)
  const after = Math.hypot(sim.balls[0]!.vx, sim.balls[0]!.vz)
  assert.ok(after < before * 0.35, `brake too weak ${before} -> ${after}`)
  sim.balls[0]!.vx = 0
  sim.balls[0]!.vz = -20
  for (let i = 0; i < 12; i++) step(sim, { ...idle, brake: true }, 1 / 120)
  const held = Math.hypot(sim.balls[0]!.vx, sim.balls[0]!.vz)
  assert.ok(held > 14, `held brake retriggered, speed ${held}`)
})

test("walls bounce", () => {
  const sim = createSim(
    arena({ holes: [], half: 8, player: { x: 7.35, z: 0 }, enemies: [] }),
    { phase: "play" },
  )
  sim.balls[0]!.vx = 22
  step(sim, idle, 1 / 120)
  assert.ok(sim.balls[0]!.vx < 0, `expected bounce, vx=${sim.balls[0]!.vx}`)
})
