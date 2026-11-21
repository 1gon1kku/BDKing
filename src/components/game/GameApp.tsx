import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { ChevronRight, Pause, RotateCcw, Volume2, VolumeX } from "lucide-react"
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import * as THREE from "three"
import { createAudio, type Sfx } from "@/game/audio"
import {
  BRAKE_COOLDOWN,
  createSim,
  FIXED_DT,
  step,
  type ControlInput,
  type Judgment,
  type Phase,
  type Sim,
} from "@/game/sim"
import { STAGES } from "@/game/stages"
import { COLOR } from "@/game/theme"

type Api = {
  simRef: React.MutableRefObject<Sim>
  yawDeltaRef: React.MutableRefObject<number>
  lookHeldRef: React.MutableRefObject<boolean>
  camSnapRef: React.MutableRefObject<boolean>
  reduceMotionRef: React.MutableRefObject<boolean>
}

const Ctx = createContext<Api | null>(null)

function useApi() {
  const api = useContext(Ctx)
  if (!api) throw new Error("game context missing")
  return api
}

type Ui = {
  phase: Phase
  stageIndex: number
  score: number
  lives: number
  best: number
  unlocked: number
  judgment: Judgment | null
  run: number
  muted: boolean
}

const SAVE_KEY = "sokyu-save"

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return { best: 0, unlocked: 0 }
    const data = JSON.parse(raw) as { best?: number; unlocked?: number }
    return {
      best: typeof data.best === "number" ? data.best : 0,
      unlocked: typeof data.unlocked === "number" ? data.unlocked : 0,
    }
  } catch {
    return { best: 0, unlocked: 0 }
  }
}

function writeSave(sim: Sim) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, best: sim.best, unlocked: sim.unlocked }))
  } catch {
    /* private mode */
  }
}

const _axis = new THREE.Vector3()
const _q = new THREE.Quaternion()

function buildFloor(stage: Sim["stage"]) {
  const shape = new THREE.Shape()
  const h = stage.half
  shape.moveTo(-h, -h)
  shape.lineTo(h, -h)
  shape.lineTo(h, h)
  shape.lineTo(-h, h)
  shape.closePath()
  for (const hole of stage.holes) {
    const path = new THREE.Path()
    path.absarc(hole.x, hole.z, hole.r, 0, Math.PI * 2, true)
    shape.holes.push(path)
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false, curveSegments: 24 })
  geo.rotateX(Math.PI / 2)
  geo.computeVertexNormals()
  return geo
}

function ArenaMeshes({ stage, run }: { stage: Sim["stage"]; run: number }) {
  const geo = useMemo(() => buildFloor(stage), [stage])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group key={run}>
      <mesh geometry={geo} receiveShadow>
        <meshStandardMaterial color={COLOR.floor} roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.6, 0]}>
        <circleGeometry args={[stage.half * 1.4, 8]} />
        <meshBasicMaterial color={COLOR.floorDeep} />
      </mesh>
      <Walls half={stage.half} />
      {stage.holes.map((h, i) => (
        <group key={`h${i}`} position={[h.x, 0, h.z]}>
          <mesh position={[0, -2.15, 0]}>
            <cylinderGeometry args={[h.r * 0.98, h.r * 0.9, 4.2, 28, 1, true]} />
            <meshStandardMaterial color={COLOR.pitWall} side={THREE.BackSide} roughness={1} />
          </mesh>
          <mesh position={[0, -4.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[h.r * 0.88, 24]} />
            <meshStandardMaterial color={COLOR.gold} emissive={COLOR.gold} emissiveIntensity={0.9} />
          </mesh>
          <mesh position={[0, 0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[h.r, 0.065, 8, 32]} />
            <meshStandardMaterial color={COLOR.gold} roughness={0.45} metalness={0.2} />
          </mesh>
          <pointLight position={[0, -1.4, 0]} color={COLOR.gold} intensity={2.4} distance={6.5} decay={2} />
        </group>
      ))}
      {stage.pillars.map((p, i) => (
        <mesh key={`p${i}`} position={[p.x, 0.9, p.z]} castShadow receiveShadow>
          <cylinderGeometry args={[p.r, p.r * 1.05, 1.8, 18]} />
          <meshStandardMaterial color={COLOR.plasterDeep} roughness={0.86} />
        </mesh>
      ))}
      {stage.blocks.map((b, i) => (
        <mesh key={`b${i}`} position={[b.x, 0.62, b.z]} castShadow receiveShadow>
          <boxGeometry args={[b.hx * 2, 1.24, b.hz * 2]} />
          <meshStandardMaterial color={COLOR.stone} roughness={0.9} />
        </mesh>
      ))}
      <Balls run={run} />
    </group>
  )
}

function Walls({ half }: { half: number }) {
  const t = 0.72
  const h = 1.6
  const len = half * 2 + t
  const y = h / 2
  const boxes: [number, number, number, number, number, number][] = [
    [0, y, -(half + t / 2), len, h, t],
    [0, y, half + t / 2, len, h, t],
    [-(half + t / 2), y, 0, t, h, len],
    [half + t / 2, y, 0, t, h, len],
  ]
  return (
    <>
      {boxes.map((b, i) => (
        <mesh key={i} position={[b[0], b[1], b[2]]} castShadow receiveShadow>
          <boxGeometry args={[b[3], b[4], b[5]]} />
          <meshStandardMaterial color={COLOR.plaster} roughness={0.92} />
        </mesh>
      ))}
    </>
  )
}

function Balls({ run }: { run: number }) {
  const { simRef } = useApi()
  void run
  return (
    <>
      {simRef.current.balls.map((b) => (
        <BallMesh key={b.id} id={b.id} kind={b.kind} radius={b.r} />
      ))}
    </>
  )
}

function BallMesh({ id, kind, radius }: { id: number; kind: "player" | "enemy"; radius: number }) {
  const body = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const face = useRef<THREE.Group>(null)
  const shade = useRef<THREE.Mesh>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  const { simRef } = useApi()
  const color = kind === "player" ? COLOR.player : COLOR.enemy
  const band = kind === "player" ? COLOR.playerBand : COLOR.enemyBand

  useFrame((_, delta) => {
    const sim = simRef.current
    const b = sim.balls.find((item) => item.id === id)
    if (!b || !body.current) return
    const dt = Math.min(delta, 0.05)
    const bob = sim.phase === "title" ? Math.sin(performance.now() / 420 + id) * 0.05 : 0
    body.current.position.set(b.x, b.y + bob, b.z)
    const punch = 1 + b.flash * 0.1
    body.current.scale.set(punch, punch, punch)
    const sp = Math.hypot(b.vx, b.vz)
    if (spin.current && sp > 0.25) {
      _axis.set(-b.vz, 0, b.vx).multiplyScalar(1 / sp)
      _q.setFromAxisAngle(_axis, (sp / b.r) * dt)
      spin.current.quaternion.premultiply(_q)
    }
    if (face.current && kind === "enemy") {
      const player = sim.balls[0]
      const tx = player ? player.x : b.x + b.vx
      const tz = player ? player.z : b.z + b.vz
      if (Math.hypot(tx - b.x, tz - b.z) > 0.05) face.current.lookAt(tx, b.y, tz)
    }
    if (mat.current) mat.current.emissiveIntensity = 0.12 + Math.min(0.7, sp / 28)
    if (shade.current) shade.current.visible = !b.falling && sim.phase !== "title"
  })

  return (
    <group ref={body}>
      <group ref={spin}>
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[radius, 32, 24]} />
          <meshStandardMaterial
            ref={mat}
            color={color}
            emissive={color}
            emissiveIntensity={0.16}
            roughness={0.3}
            metalness={0.14}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 0.9, radius * 0.065, 8, 28]} />
          <meshStandardMaterial color={band} roughness={0.4} />
        </mesh>
      </group>
      {kind === "enemy" && (
        <group ref={face}>
          <mesh position={[radius * 0.32, radius * 0.16, radius * 0.74]}>
            <sphereGeometry args={[radius * 0.16, 12, 10]} />
            <meshStandardMaterial color={COLOR.eye} roughness={0.35} />
          </mesh>
          <mesh position={[-radius * 0.32, radius * 0.16, radius * 0.74]}>
            <sphereGeometry args={[radius * 0.16, 12, 10]} />
            <meshStandardMaterial color={COLOR.eye} roughness={0.35} />
          </mesh>
          <mesh position={[radius * 0.32, radius * 0.14, radius * 0.88]}>
            <sphereGeometry args={[radius * 0.07, 10, 8]} />
            <meshStandardMaterial color={COLOR.pupil} />
          </mesh>
          <mesh position={[-radius * 0.32, radius * 0.14, radius * 0.88]}>
            <sphereGeometry args={[radius * 0.07, 10, 8]} />
            <meshStandardMaterial color={COLOR.pupil} />
          </mesh>
        </group>
      )}
      <mesh ref={shade} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045 - radius, 0]}>
        <circleGeometry args={[radius * 0.86, 18]} />
        <meshBasicMaterial color={COLOR.pupil} transparent opacity={0.28} />
      </mesh>
    </group>
  )
}

function Rig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const { simRef, camSnapRef, reduceMotionRef } = useApi()
  useFrame(({ clock }, delta) => {
    const sim = simRef.current
    const p = sim.balls[0]
    if (!p) return
    const dt = Math.min(delta, 0.05)
    const reduceMotion = reduceMotionRef.current
    let yaw = sim.yaw
    if (sim.phase === "title") yaw = reduceMotion ? 0.5 : clock.elapsedTime * 0.2
    const portrait = camera.aspect < 0.95
    const dist = portrait ? 14.4 : 11.5
    const height = portrait ? 11.4 : 6.7
    const ahead = portrait ? 1.3 : 2.7
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const lim = sim.stage.half - 0.4
    const x = Math.max(-lim, Math.min(lim, p.x - fx * dist))
    const z = Math.max(-lim, Math.min(lim, p.z - fz * dist))
    const y = p.y + height
    if (camSnapRef.current || sim.phase === "title") {
      camera.position.set(x, y, z)
      if (sim.phase !== "title") camSnapRef.current = false
    } else {
      const k = 1 - Math.exp(-5.2 * dt)
      camera.position.x += (x - camera.position.x) * k
      camera.position.y += (y - camera.position.y) * k
      camera.position.z += (z - camera.position.z) * k
    }
    const sh = reduceMotion ? 0 : sim.shake
    const sx = Math.sin(sim.t * 46) * sh
    const sy = Math.cos(sim.t * 38) * sh * 0.55
    camera.lookAt(p.x + fx * ahead + sx, p.y * 0.25 + 0.3 + sy, p.z + fz * ahead)
    const sp = Math.hypot(p.vx, p.vz)
    const fov = (portrait ? 57 : 50) + Math.min(9, sp * 0.26)
    if (Math.abs(camera.fov - fov) > 0.08) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })
  return null
}

function Scene({ stage, run }: { stage: Sim["stage"]; run: number }) {
  return (
    <>
      <color attach="background" args={[COLOR.bg]} />
      <fog attach="fog" args={[COLOR.fog, 16, 46]} />
      <hemisphereLight args={[COLOR.sky, COLOR.ground, 0.72]} />
      <ambientLight intensity={0.16} />
      <directionalLight
        position={[9, 18, 7]}
        intensity={1.55}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={2}
        shadow-camera-far={48}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <ArenaMeshes stage={stage} run={run} />
      <Rig />
    </>
  )
}

function sampleInput(
  keys: Set<string>,
  injected: Set<string> | null,
  stick: { x: number; y: number; active: boolean },
  brakeHeld: boolean,
): ControlInput {
  const held = injected ?? keys
  let forward = 0
  let strafe = 0
  if (held.has("KeyW") || held.has("ArrowUp")) forward += 1
  if (held.has("KeyS") || held.has("ArrowDown")) forward -= 1
  if (held.has("KeyA") || held.has("ArrowLeft")) strafe -= 1
  if (held.has("KeyD") || held.has("ArrowRight")) strafe += 1
  if (stick.active) {
    forward += stick.y
    strafe += stick.x
  }
  return {
    forward: Math.max(-1, Math.min(1, forward)),
    strafe: Math.max(-1, Math.min(1, strafe)),
    brake: brakeHeld || held.has("Space") || held.has("ShiftLeft") || held.has("ShiftRight"),
    lookLeft: held.has("KeyQ"),
    lookRight: held.has("KeyE"),
  }
}

export function GameApp() {
  const simRef = useRef<Sim | null>(null)
  if (!simRef.current) {
    simRef.current = createSim(STAGES[0]!, {
      phase: "title",
      stageIndex: 0,
      stageCount: STAGES.length,
    })
  }
  const simMutable = simRef as React.MutableRefObject<Sim>
  const yawDeltaRef = useRef(0)
  const lookHeldRef = useRef(false)
  const camSnapRef = useRef(true)
  const keysRef = useRef(new Set<string>())
  const injectedRef = useRef<Set<string> | null>(null)
  const stickRef = useRef({ x: 0, y: 0, active: false })
  const brakeRef = useRef(false)
  const audioRef = useRef<Sfx | null>(null)
  const speedRef = useRef<HTMLSpanElement>(null)
  const brakeFillRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLParagraphElement>(null)
  const reduceMotion = useRef(false)
  const [ready, setReady] = useState(false)
  const [ui, setUi] = useState<Ui>({
    phase: "title",
    stageIndex: 0,
    score: 0,
    lives: 3,
    best: 0,
    unlocked: 0,
    judgment: null,
    run: 0,
    muted: false,
  })

  const publish = (sim: Sim, run = ui.run) => {
    setUi((prev) => ({
      phase: sim.phase,
      stageIndex: sim.stageIndex,
      score: sim.score,
      lives: sim.lives,
      best: sim.best,
      unlocked: sim.unlocked,
      judgment: sim.judgment,
      run,
      muted: prev.muted,
    }))
  }

  useEffect(() => {
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    audioRef.current = createAudio()
    const save = loadSave()
    const sim = simMutable.current
    sim.best = save.best
    sim.unlocked = save.unlocked
    setUi((prev) => ({ ...prev, best: save.best, unlocked: save.unlocked }))

    const keys = keysRef.current
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return
      keys.add(e.code)
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault()
      if (e.code === "Escape") {
        const live = simMutable.current
        if (live.phase === "play") live.phase = "pause"
        else if (live.phase === "pause") live.phase = "play"
      }
    }
    const up = (e: KeyboardEvent) => keys.delete(e.code)
    const blur = () => keys.clear()
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)

    window.__controlsTest = {
      getYaw: () => simMutable.current.yaw,
      getSpeed: () => {
        const p = simMutable.current.balls[0]
        return p ? Math.hypot(p.vx, p.vz) : 0
      },
      setKeys: (codes: string[]) => {
        injectedRef.current = new Set(codes)
      },
    }

    let raf = 0
    let last = performance.now()
    let acc = 0
    const seen = { phase: sim.phase, score: sim.score, lives: sim.lives, best: sim.best, unlocked: sim.unlocked }
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const live = simMutable.current
      if (live.phase === "play" || live.phase === "resolve") {
        live.yaw += yawDeltaRef.current
        if (lookHeldRef.current) live.slewLock = 1.15
      }
      yawDeltaRef.current = 0
      if (live.phase === "title" || live.phase === "pause") acc = 0
      else {
        acc += dt
        if (acc > FIXED_DT * 6) acc = FIXED_DT * 6
        const input = sampleInput(keys, injectedRef.current, stickRef.current, brakeRef.current)
        let n = 0
        while (acc >= FIXED_DT && n < 6) {
          step(live, input, FIXED_DT)
          acc -= FIXED_DT
          n++
        }
      }
      const p = live.balls[0]
      if (p && speedRef.current) {
        const sp = Math.hypot(p.vx, p.vz)
        speedRef.current.textContent = sp.toFixed(1)
        speedRef.current.classList.toggle("is-hot", sp > 16)
      }
      if (brakeFillRef.current) {
        const readyBrake = live.brakeCd <= 0 ? 1 : 1 - live.brakeCd / BRAKE_COOLDOWN
        brakeFillRef.current.style.transform = `scaleX(${readyBrake})`
      }
      if (logRef.current) logRef.current.textContent = live.log.join("\n")
      const audio = audioRef.current
      if (audio && live.impacts.length) {
        let played = 0
        for (const imp of live.impacts) {
          const important = imp.kind === "win" || imp.kind === "lose" || imp.kind === "fall"
          if (important || played < 3) {
            audio.play(imp.kind, imp.speed)
            played++
          }
        }
        live.impacts.length = 0
      } else {
        live.impacts.length = 0
      }
      if (
        live.phase !== seen.phase ||
        live.score !== seen.score ||
        live.lives !== seen.lives ||
        live.best !== seen.best ||
        live.unlocked !== seen.unlocked
      ) {
        const prevBest = seen.best
        seen.phase = live.phase
        seen.score = live.score
        seen.lives = live.lives
        seen.best = live.best
        seen.unlocked = live.unlocked
        if (live.best !== prevBest || live.phase === "win" || live.phase === "lose") writeSave(live)
        setUi((prev) => ({
          phase: live.phase,
          stageIndex: live.stageIndex,
          score: live.score,
          lives: live.lives,
          best: live.best,
          unlocked: live.unlocked,
          judgment: live.judgment,
          run: prev.run,
          muted: prev.muted,
        }))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    setReady(true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
      delete window.__controlsTest
    }
  }, [simMutable])

  const replace = (sim: Sim) => {
    simMutable.current = sim
    camSnapRef.current = true
    setUi((prev) => ({
      phase: sim.phase,
      stageIndex: sim.stageIndex,
      score: sim.score,
      lives: sim.lives,
      best: sim.best,
      unlocked: sim.unlocked,
      judgment: sim.judgment,
      run: prev.run + 1,
      muted: prev.muted,
    }))
  }

  const begin = () => {
    const cur = simMutable.current
    audioRef.current?.unlock()
    const sim = createSim(STAGES[cur.stageIndex] ?? STAGES[0]!, {
      phase: "play",
      score: 0,
      lives: 3,
      best: cur.best,
      unlocked: cur.unlocked,
      stageIndex: cur.stageIndex,
      stageCount: STAGES.length,
    })
    replace(sim)
  }

  const retry = () => {
    const cur = simMutable.current
    audioRef.current?.unlock()
    replace(
      createSim(STAGES[cur.stageIndex] ?? STAGES[0]!, {
        phase: "play",
        score: cur.score,
        lives: cur.lives,
        best: cur.best,
        unlocked: cur.unlocked,
        stageIndex: cur.stageIndex,
        stageCount: STAGES.length,
      }),
    )
  }

  const restart = () => {
    const cur = simMutable.current
    audioRef.current?.unlock()
    replace(
      createSim(STAGES[0]!, {
        phase: "play",
        score: 0,
        lives: 3,
        best: cur.best,
        unlocked: cur.unlocked,
        stageIndex: 0,
        stageCount: STAGES.length,
      }),
    )
  }

  const next = () => {
    const cur = simMutable.current
    const idx = Math.min(STAGES.length - 1, cur.stageIndex + 1)
    audioRef.current?.unlock()
    replace(
      createSim(STAGES[idx]!, {
        phase: "play",
        score: cur.score,
        lives: cur.lives,
        best: cur.best,
        unlocked: cur.unlocked,
        stageIndex: idx,
        stageCount: STAGES.length,
      }),
    )
  }

  const toTitle = () => {
    const cur = simMutable.current
    replace(
      createSim(STAGES[cur.stageIndex] ?? STAGES[0]!, {
        phase: "title",
        score: 0,
        lives: 3,
        best: cur.best,
        unlocked: cur.unlocked,
        stageIndex: cur.stageIndex,
        stageCount: STAGES.length,
      }),
    )
  }

  const pickStage = (index: number) => {
    const cur = simMutable.current
    if (index > cur.unlocked) return
    replace(
      createSim(STAGES[index]!, {
        phase: "title",
        best: cur.best,
        unlocked: cur.unlocked,
        stageIndex: index,
        stageCount: STAGES.length,
      }),
    )
  }

  const toggleMute = () => {
    setUi((prev) => {
      const muted = !prev.muted
      audioRef.current?.setMuted(muted)
      return { ...prev, muted }
    })
  }

  const api = useMemo<Api>(
    () => ({
      simRef: simMutable,
      yawDeltaRef,
      lookHeldRef,
      camSnapRef,
      reduceMotionRef: reduceMotion,
    }),
    [simMutable],
  )

  const stage = STAGES[ui.stageIndex] ?? STAGES[0]!
  const playing = ui.phase === "play" || ui.phase === "resolve" || ui.phase === "pause"
  const remaining = simMutable.current.balls.filter((b) => b.kind === "enemy" && b.fallTime == null).length

  return (
    <Ctx.Provider value={api}>
      <main className="game-shell relative h-dvh w-full overflow-hidden bg-bg text-fg">
        {ready && (
          <Canvas
            className="absolute inset-0 h-full w-full"
            dpr={[1, 1.75]}
            shadows
            camera={{ fov: 52, position: [0, 8, 12], near: 0.1, far: 80 }}
            gl={{ antialias: true, alpha: false }}
          >
            <Scene stage={stage} run={ui.run} />
          </Canvas>
        )}
        <div className="vignette absolute inset-0" />
        {playing && (
          <LookPad
            onDelta={(dx) => {
              yawDeltaRef.current -= dx * 0.0052
            }}
            onHeld={(held) => {
              lookHeldRef.current = held
            }}
          />
        )}
        {ui.phase === "title" && (
          <Title
            stageIndex={ui.stageIndex}
            unlocked={ui.unlocked}
            best={ui.best}
            muted={ui.muted}
            onStart={begin}
            onPick={pickStage}
            onMute={toggleMute}
          />
        )}
        {ui.phase !== "title" && (
          <Hud
            stageName={stage.name}
            blurb={stage.blurb}
            score={ui.score}
            best={ui.best}
            lives={ui.lives}
            remaining={remaining}
            speedRef={speedRef}
            brakeFillRef={brakeFillRef}
            logRef={logRef}
            paused={ui.phase === "pause"}
            muted={ui.muted}
            showHint={ui.phase === "play"}
            onPause={() => {
              const live = simMutable.current
              live.phase = live.phase === "pause" ? "play" : "pause"
              publish(live)
            }}
            onMute={toggleMute}
          />
        )}
        {(ui.phase === "win" || ui.phase === "lose") && ui.judgment && (
          <Result
            judgment={ui.judgment}
            stageIndex={ui.stageIndex}
            lives={ui.lives}
            score={ui.score}
            onRetry={retry}
            onNext={next}
            onRestart={restart}
            onTitle={toTitle}
          />
        )}
        {ui.phase === "play" && (
          <TouchControls
            stickRef={stickRef}
            onBrake={(down) => {
              brakeRef.current = down
            }}
          />
        )}
      </main>
    </Ctx.Provider>
  )
}

function Title({
  stageIndex,
  unlocked,
  best,
  muted,
  onStart,
  onPick,
  onMute,
}: {
  stageIndex: number
  unlocked: number
  best: number
  muted: boolean
  onStart: () => void
  onPick: (index: number) => void
  onMute: () => void
}) {
  const stage = STAGES[stageIndex] ?? STAGES[0]!
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface/95 p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs tracking-widest text-primary">三人称・慣性玉</p>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-fg"
            onClick={onMute}
            aria-label={muted ? "音を出す" : "音を消す"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        <h1 className="font-display text-4xl text-fg sm:text-5xl">蒼球</h1>
        <p className="mt-1 font-display text-lg text-primary">ぶつけて、穴へ。</p>
        <p className="mt-3 text-sm text-muted">
          青玉を加速させて赤玉にぶつける。相手を穴に落とせば勝ち。自分が先に落ちれば負け。
        </p>
        <p className="mt-2 text-sm text-fg">
          同時に落ちたときは、穴に入った時刻が早い方の勝ち。時刻が揃ったら、中心へ向かう速さで決める。
        </p>
        <div className="mt-4 flex items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-accent" />
            青玉
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-enemy" />
            赤玉
          </span>
        </div>
        <ul className="mt-4 space-y-1 text-sm text-muted">
          <li>加速 — WASD / 矢印。離しても滑る</li>
          <li>ブレーキ — Space。一度使うと少し休め</li>
          <li>視点 — ドラッグ、または Q / E</li>
        </ul>
        <p className="mt-4 text-sm text-fg">
          次の面　{stage.name}
          <span className="text-muted"> — {stage.blurb}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {STAGES.map((item, index) => {
            const locked = index > unlocked
            const on = index === stageIndex
            return (
              <button
                key={item.id}
                type="button"
                disabled={locked}
                onClick={() => onPick(index)}
                className={`min-h-11 rounded-md border px-3 text-sm ${on ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface-2 text-fg"}`}
              >
                {index + 1} {item.name}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onStart}
          className="mt-5 flex min-h-14 w-full flex-col items-center justify-center rounded-md bg-primary px-4 text-primary-fg"
        >
          <span className="font-display text-2xl leading-none">スタート</span>
          <span className="text-xs tracking-widest">Start</span>
        </button>
        <p className="mt-3 text-center text-xs text-muted">ベスト {best}</p>
      </div>
    </div>
  )
}

function Hud({
  stageName,
  blurb,
  score,
  best,
  lives,
  remaining,
  speedRef,
  brakeFillRef,
  logRef,
  paused,
  muted,
  showHint,
  onPause,
  onMute,
}: {
  stageName: string
  blurb: string
  score: number
  best: number
  lives: number
  remaining: number
  speedRef: React.RefObject<HTMLSpanElement | null>
  brakeFillRef: React.RefObject<HTMLDivElement | null>
  logRef: React.RefObject<HTMLParagraphElement | null>
  paused: boolean
  muted: boolean
  showHint: boolean
  onPause: () => void
  onMute: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg leading-tight">{stageName}</p>
          <p className="text-xs text-muted">{blurb}</p>
          <p className="mt-1 text-sm">
            残 {remaining}
            <span className="ml-3 text-muted">残機</span>{" "}
            <span className="inline-flex gap-1 align-middle">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`inline-block h-2.5 w-2.5 rounded-full ${i < lives ? "bg-accent" : "bg-surface-2"}`}
                />
              ))}
            </span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">勢い</p>
          <p className="font-display text-3xl leading-none tabular-nums">
            <span ref={speedRef}>0.0</span>
          </p>
          <p className="mt-1 text-sm tabular-nums">
            {score}
            <span className="ml-2 text-xs text-muted">best {best}</span>
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-2">
          <div ref={brakeFillRef} className="h-full w-full origin-left bg-primary" />
        </div>
        <span className="text-xs text-muted">ブレーキ</span>
        <div className="pointer-events-auto ml-auto flex gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface/90"
            onClick={onPause}
            aria-label={paused ? "続ける" : "一時停止"}
          >
            {paused ? <ChevronRight size={18} /> : <Pause size={18} />}
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-surface/90"
            onClick={onMute}
            aria-label={muted ? "音を出す" : "音を消す"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>
      {showHint && (
        <p className="mt-2 text-xs text-plaster">WASD で加速。Space でブレーキ。ドラッグか Q/E で視点。</p>
      )}
      <p ref={logRef} className="mt-1 min-h-10 whitespace-pre-line text-xs text-primary" />
      {paused && (
        <div className="pointer-events-auto mx-auto mt-8 w-full max-w-xs rounded-lg border border-border bg-surface/95 p-4 text-center">
          <p className="font-display text-2xl">一時停止</p>
          <button
            type="button"
            onClick={onPause}
            className="mt-3 min-h-11 w-full rounded-md bg-primary text-primary-fg"
          >
            続ける
          </button>
        </div>
      )}
    </div>
  )
}

function Result({
  judgment,
  stageIndex,
  lives,
  score,
  onRetry,
  onNext,
  onRestart,
  onTitle,
}: {
  judgment: Judgment
  stageIndex: number
  lives: number
  score: number
  onRetry: () => void
  onNext: () => void
  onRestart: () => void
  onTitle: () => void
}) {
  const win = judgment.outcome === "win"
  const last = stageIndex >= STAGES.length - 1
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface/95 p-5 shadow-xl">
        <p className="text-xs tracking-widest text-muted">{win ? "勝ち" : "負け"}</p>
        <h2 className="font-display text-3xl text-fg">{judgment.headline}</h2>
        <p className="mt-2 text-sm text-fg">{judgment.detail}</p>
        {win && last && <p className="mt-2 text-sm text-primary">五つの釜を空けた。</p>}
        <p className="mt-3 text-sm tabular-nums text-muted">得点 {score}</p>
        {judgment.rows.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 font-normal">順</th>
                <th className="py-1 font-normal">誰</th>
                <th className="py-1 font-normal">時刻</th>
                <th className="py-1 text-right font-normal">勢い</th>
              </tr>
            </thead>
            <tbody>
              {judgment.rows.map((row, index) => (
                <tr key={`${row.name}-${index}`} className={row.kind === "player" ? "text-accent" : "text-enemy"}>
                  <td className="py-1 tabular-nums">{index + 1}</td>
                  <td className="py-1">{row.name}</td>
                  <td className="py-1 tabular-nums">{row.time.toFixed(3)}s</td>
                  <td className="py-1 text-right tabular-nums">{row.speed.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {win && !last && (
            <button type="button" onClick={onNext} className="min-h-11 rounded-md bg-primary text-primary-fg">
              次の面
            </button>
          )}
          {!win && lives > 0 && (
            <button type="button" onClick={onRetry} className="min-h-11 rounded-md bg-primary text-primary-fg">
              やり直す
            </button>
          )}
          <button
            type="button"
            onClick={onRestart}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border"
          >
            <RotateCcw size={16} />
            はじめから
          </button>
          <button type="button" onClick={onTitle} className="min-h-11 rounded-md border border-border">
            タイトルへ
          </button>
        </div>
      </div>
    </div>
  )
}

function LookPad({ onDelta, onHeld }: { onDelta: (dx: number) => void; onHeld: (held: boolean) => void }) {
  const last = useRef(0)
  const id = useRef<number | null>(null)
  return (
    <div
      className="absolute inset-0 z-10"
      onPointerDown={(e) => {
        id.current = e.pointerId
        last.current = e.clientX
        onHeld(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (id.current !== e.pointerId) return
        onDelta(e.clientX - last.current)
        last.current = e.clientX
      }}
      onPointerUp={(e) => {
        if (id.current !== e.pointerId) return
        id.current = null
        onHeld(false)
      }}
      onPointerCancel={() => {
        id.current = null
        onHeld(false)
      }}
    />
  )
}

function TouchControls({
  stickRef,
  onBrake,
}: {
  stickRef: React.MutableRefObject<{ x: number; y: number; active: boolean }>
  onBrake: (down: boolean) => void
}) {
  return (
    <>
      <Stick stickRef={stickRef} />
      <button
        type="button"
        className="absolute bottom-6 right-4 z-30 flex h-24 w-24 items-center justify-center rounded-full border border-primary bg-surface/80 text-sm text-primary"
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          onBrake(true)
        }}
        onPointerUp={() => onBrake(false)}
        onPointerCancel={() => onBrake(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        ブレーキ
      </button>
    </>
  )
}

function Stick({
  stickRef,
}: {
  stickRef: React.MutableRefObject<{ x: number; y: number; active: boolean }>
}) {
  const zone = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const move = (clientX: number, clientY: number) => {
    const rect = zone.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const max = rect.width * 0.34
    const mag = Math.hypot(dx, dy) || 1
    if (mag > max) {
      dx = (dx / mag) * max
      dy = (dy / mag) * max
    }
    let x = dx / max
    let y = -dy / max
    if (Math.hypot(x, y) < 0.12) {
      x = 0
      y = 0
    }
    stickRef.current = { x, y, active: true }
    setKnob({ x: dx, y: dy })
  }
  const end = () => {
    stickRef.current = { x: 0, y: 0, active: false }
    setKnob({ x: 0, y: 0 })
  }
  return (
    <div
      ref={zone}
      className="absolute bottom-6 left-4 z-30 h-36 w-36 rounded-full border border-border bg-surface/70"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e.clientX, e.clientY)
      }}
      onPointerMove={(e) => {
        if (!stickRef.current.active) return
        move(e.clientX, e.clientY)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-plaster"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  )
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number
      getSpeed: () => number
      setKeys?: (codes: string[]) => void
    }
  }
}
