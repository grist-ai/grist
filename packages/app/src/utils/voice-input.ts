export const WHISPER_SAMPLE_RATE = 16_000
export const VOICE_MAX_SECONDS = 90

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
