export type Sfx = {
  unlock: () => void
  setMuted: (muted: boolean) => void
  play: (kind: "ball" | "wall" | "fall" | "brake" | "win" | "lose", speed: number) => void
}

export function createAudio(): Sfx {
  let ctx: AudioContext | null = null
  let muted = false

  const ensure = () => {
    if (muted) return null
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  }

  const tone = (
    ac: AudioContext,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
    slide = 0,
  ) => {
    const t = ac.currentTime + delay
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(ac.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  return {
    unlock() {
      ensure()
    },
    setMuted(next) {
      muted = next
      if (muted && ctx && ctx.state === "running") void ctx.suspend()
      if (!muted && ctx && ctx.state === "suspended") void ctx.resume()
    },
    play(kind, speed) {
      const ac = ensure()
      if (!ac) return
      if (kind === "ball") {
        const f = 90 + Math.min(280, speed * 14)
        tone(ac, f, 0.09, "triangle", Math.min(0.08, 0.02 + speed * 0.003))
        tone(ac, f * 0.5, 0.12, "sine", 0.04)
      } else if (kind === "wall") {
        const f = 70 + Math.min(160, speed * 6)
        tone(ac, f, 0.1, "square", 0.03)
        tone(ac, f * 1.5, 0.06, "triangle", 0.03)
      } else if (kind === "fall") {
        tone(ac, 420, 0.28, "sine", 0.06, 0, -320)
        tone(ac, 180, 0.34, "triangle", 0.04, 0.02, -100)
      } else if (kind === "brake") {
        tone(ac, 180, 0.08, "sawtooth", 0.03)
        tone(ac, 90, 0.12, "triangle", 0.04, 0.03)
      } else if (kind === "win") {
        tone(ac, 392, 0.12, "triangle", 0.05)
        tone(ac, 523, 0.14, "triangle", 0.05, 0.1)
        tone(ac, 659, 0.22, "triangle", 0.05, 0.2)
      } else {
        tone(ac, 196, 0.2, "sine", 0.06, 0, -80)
        tone(ac, 98, 0.32, "triangle", 0.05, 0.05)
      }
    },
  }
}
