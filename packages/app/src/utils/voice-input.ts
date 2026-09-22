export const WHISPER_SAMPLE_RATE = 16_000
export const VOICE_MAX_SECONDS = 90

export const VOICE_ACTIVITY_BARS = 5

export function voiceActivityLevels(bins: Uint8Array, bars = VOICE_ACTIVITY_BARS) {
  if (bars <= 0) return []
  if (bins.length === 0) return Array.from({ length: bars }, () => 0)
  const width = Math.max(1, Math.floor(bins.length / bars))
  return Array.from({ length: bars }, (_, index) => {
    const start = index * width
    const end = index === bars - 1 ? bins.length : Math.min(bins.length, start + width)
    let sum = 0
    for (let i = start; i < end; i++) sum += bins[i] ?? 0
    const linear = sum / Math.max(1, end - start) / 255
    return Math.min(1, Math.sqrt(linear))
  })
}

export function mixVoiceActivity(bands: readonly number[], rms: number) {
  const level = Math.min(1, Math.max(0, rms))
  return bands.map((band) => Math.min(1, band * 0.55 + level * 0.9))
}

export function voiceActivityRms(samples: Uint8Array) {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = ((samples[i] ?? 128) - 128) / 128
    sum += sample * sample
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4)
}

export function sameActivity(prev: readonly number[], next: readonly number[], epsilon = 0.05) {
  if (prev.length !== next.length) return false
  return next.every((value, index) => Math.abs(value - prev[index]!) <= epsilon)
}

export function textFromLines(lines: readonly string[]) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
}

export function isSpeechModelDownload(loaded: number, total?: number) {
  if (total === undefined) return true
  return loaded < total
}

export function moonshineLocateFile(path: string, moduleUrl: string, wasmUrl: string) {
  const name = path.split(/[\\/]/).pop() ?? path
  if (name.endsWith(".wasm")) return wasmUrl
  if (name.endsWith(".mjs") || name.endsWith(".js")) return moduleUrl
  return new URL(name, moduleUrl).href
}

export function joinPromptText(existing: string, incoming: string) {
  const spoken = incoming.trim()
  if (!spoken) return existing
  if (!existing) return spoken
  if (/\s$/.test(existing) || /^\s/.test(spoken)) return existing + spoken
  return `${existing} ${spoken}`
}

export function resamplePcm(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input
  if (fromRate <= 0 || toRate <= 0 || input.length === 0) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const src = i * ratio
    const left = Math.min(Math.floor(src), input.length - 1)
    const right = Math.min(left + 1, input.length - 1)
    const frac = src - left
    output[i] = input[left] * (1 - frac) + input[right] * frac
  }
  return output
}

export function flattenPcm(channels: Float32Array[]) {
  if (channels.length === 0) return new Float32Array()
  if (channels.length === 1) return channels[0]
  const length = channels[0].length
  const mixed = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i] ?? 0
    mixed[i] = sum / channels.length
  }
  return mixed
}

export async function decodeToPcm16k(blob: Blob) {
  const context = new AudioContext()
  const decoded = await context.decodeAudioData(await blob.arrayBuffer())
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
  const mono = flattenPcm(channels)
  const samples = resamplePcm(mono, decoded.sampleRate, WHISPER_SAMPLE_RATE)
  await context.close()
  return samples
}

export async function startVoiceCapture(input: {
  getUserMedia?: typeof navigator.mediaDevices.getUserMedia
  mediaRecorder?: typeof MediaRecorder
  maxMs?: number
} = {}) {
  const getUserMedia = input.getUserMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const Recorder = input.mediaRecorder ?? MediaRecorder
  const stream = await getUserMedia({ audio: true })
  const mime = pickRecorderMime(Recorder)
  const recorder = mime ? new Recorder(stream, { mimeType: mime }) : new Recorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  recorder.start(250)
  const limit = setTimeout(
    () => {
      if (recorder.state === "recording") recorder.stop()
    },
    input.maxMs ?? VOICE_MAX_SECONDS * 1000,
  )

  const stopTracks = () => {
    clearTimeout(limit)
    for (const track of stream.getTracks()) track.stop()
  }

  return {
    async stop() {
      const blob = await new Promise<Blob>((resolve) => {
        recorder.addEventListener(
          "stop",
          () => resolve(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" })),
          { once: true },
        )
        if (recorder.state === "recording") recorder.stop()
      })
      stopTracks()
      if (blob.size === 0) return new Float32Array()
      return decodeToPcm16k(blob)
    },
    cancel() {
      if (recorder.state === "recording") recorder.stop()
      stopTracks()
    },
  }
}

function pickRecorderMime(Recorder: typeof MediaRecorder) {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
  return types.find((type) => typeof Recorder.isTypeSupported === "function" && Recorder.isTypeSupported(type))
}
