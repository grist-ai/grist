/// <reference types="vite/client" />
import moonshineModuleUrl from "@moonshine-ai/moonshine-wasm/moonshine.mjs?url"
import moonshineWasmUrl from "@moonshine-ai/moonshine-wasm/moonshine.wasm?url"
import { MicTranscriber, ModelArch, Transcriber, type LoadModuleOptions, type TranscriptLine } from "@moonshine-ai/moonshine-wasm"
import { mixVoiceActivity, moonshineLocateFile, resamplePcm, voiceActivityLevels, voiceActivityRms } from "@/utils/voice-input"

const SPEECH_MODEL_BASE = "grist-speech://models/"

// The capture worklet is written as a plain string on purpose.
// MicTranscriber builds its own worklet from downmixToMono.toString(), but the
// production bundler renames that function, so the worklet throws
// ReferenceError on every quantum and no samples ever reach the transcriber.
// (Waves still move because the activity meter taps the source node directly.)
// Inline source has no function name to rename, so it survives minification.
const CAPTURE_WORKLET_SOURCE = `
class GristCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0]
    if (channels && channels.length > 0) {
      let mono
      if (channels.length === 1) {
        mono = channels[0].slice(0)
      } else {
        const length = channels[0].length
        mono = new Float32Array(length)
        for (let i = 0; i < length; i++) {
          let sum = 0
          for (let c = 0; c < channels.length; c++) sum += channels[c][i]
          mono[i] = sum / channels.length
        }
      }
      this.port.postMessage(mono, [mono.buffer])
    }
    return true
  }
}
registerProcessor("grist-capture", GristCaptureProcessor)
`

// Structural view of the MicTranscriber fields the capture pump needs.
// These are public on the class except workletNode, which is only private in
// the type declarations; the disconnect below keeps it from throwing per
// quantum after its worklet source broke under minification.
type MicInternals = {
  audioContext?: AudioContext | null
  sourceNode?: AudioNode | null
  stream?: {
    addAudio(samples: Float32Array, sampleRate: number, flags?: number): void
    transcribe(flags?: number): void
  } | null
  running?: boolean
  muted?: boolean
  workletNode?: AudioWorkletNode | null
}

let transcriberPromise: Promise<Transcriber> | undefined

export async function openMoonshineMic(onLine: (line: TranscriptLine) => void) {
  const transcriber = await loadTranscriber()
  return new MicTranscriber()
    .useTranscriber(transcriber)
    .language("en")
    .audioConstraints({ channelCount: 1, echoCancellation: true, noiseSuppression: true })
    .onLine(onLine)
    .onError((error) => {
      console.error("[voice] speech engine error", error)
    })
}

export function preloadSpeechModel() {
  void loadTranscriber()
}

// Starts the mic and installs our own capture pump. Returns a detach function
// that must run before mic.stop() so no samples race the final flush.
export async function startMicCapture(mic: MicTranscriber) {
  await mic.start()
  return installCapturePump(mic)
}

async function installCapturePump(mic: MicTranscriber) {
  const internals = mic as unknown as MicInternals
  const audioContext = internals.audioContext
  const sourceNode = internals.sourceNode
  if (!audioContext || !sourceNode) {
    console.warn("[voice] mic audio graph unavailable; capture pump not installed")
    return () => {}
  }
  // The library's capture node is already broken (see CAPTURE_WORKLET_SOURCE):
  // disconnect it so it stops throwing on every quantum.
  internals.workletNode?.disconnect()
  internals.workletNode = null
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "application/javascript" }))
  await audioContext.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const node = new AudioWorkletNode(audioContext, "grist-capture")
  const inputRate = audioContext.sampleRate
  let chunks = 0
  let sumSquares = 0
  let counted = 0
  node.port.onmessage = (event: MessageEvent) => {
    if (!internals.running || internals.muted || !internals.stream) return
    const mono = event.data as Float32Array
    chunks += 1
    for (let i = 0; i < mono.length; i += 4) {
      sumSquares += mono[i] * mono[i]
      counted += 1
    }
    internals.stream.addAudio(resamplePcm(mono, inputRate, 16000), 16000)
    internals.stream.transcribe()
  }
  sourceNode.connect(node)
  // Keep the graph alive without producing output; the worklet only posts
  // messages and renders silence.
  node.connect(audioContext.destination)
  console.debug(`[voice] capture pump installed: ${inputRate} Hz input, context ${audioContext.state}`)
  return () => {
    node.port.onmessage = null
    node.disconnect()
    const rms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0
    console.debug(`[voice] capture pump detached: ${chunks} chunks, rms ${rms.toFixed(4)}`)
    if (chunks === 0) console.warn("[voice] capture pump received no audio chunks")
  }
}

async function loadTranscriber() {
  if (!transcriberPromise) transcriberPromise = createTranscriber()
  try {
    return await transcriberPromise
  } catch (error) {
    transcriberPromise = undefined
    throw error
  }
}

async function createTranscriber() {
  // The Emscripten glue has to stay a separate file. Bundling it makes its
  // pthread workers lose the wasm URL.
  const imported = (await import(/* @vite-ignore */ moonshineModuleUrl)) as { default?: LoadModuleOptions["factory"] }
  const factory = imported.default
  if (!factory) throw new Error("Moonshine speech runtime is missing")
  const glue = await fetch(moonshineModuleUrl)
  if (!glue.ok) throw new Error("Moonshine speech runtime is missing")
  const blob = await glue.blob()
  const locateFile = (path: string) => moonshineLocateFile(path, moonshineModuleUrl, moonshineWasmUrl)
  const transcriber = await Transcriber.load({
    files: await bundledModelFiles(),
    modelArch: ModelArch.MediumStreaming,
    moduleOptions: {
      factory: (args) => factory({ ...(args ?? {}), locateFile, mainScriptUrlOrBlob: blob }),
      locateFile,
    },
  })
  console.debug("[voice] speech model loaded")
  return transcriber
}

async function bundledModelFiles() {
  const manifest = await fetch(`${SPEECH_MODEL_BASE}manifest.json`)
  if (!manifest.ok) throw new Error("Moonshine speech model is not installed with Grist")
  const body = (await manifest.json()) as { files?: unknown }
  const names = Array.isArray(body.files) ? body.files.filter((name): name is string => typeof name === "string") : []
  if (names.length === 0) throw new Error("Moonshine speech model is not installed with Grist")
  const files = new Map<string, Uint8Array>()
  for (const name of names) {
    const response = await fetch(`${SPEECH_MODEL_BASE}${name}`)
    if (!response.ok) throw new Error(`Moonshine speech model is missing ${name}`)
    files.set(name, new Uint8Array(await response.arrayBuffer()))
  }
  return files
}

export function attachVoiceActivity(mic: MicTranscriber, onLevels: (levels: number[]) => void) {
  const graph = mic as unknown as { audioContext?: AudioContext; sourceNode?: AudioNode }
  if (!graph.audioContext || !graph.sourceNode) return () => {}
  const analyser = graph.audioContext.createAnalyser()
  analyser.fftSize = 64
  analyser.smoothingTimeConstant = 0.75
  // The analyser only receives samples while it stays in the live graph.
  // Zero gain keeps that extra path silent.
  const silent = graph.audioContext.createGain()
  silent.gain.value = 0
  graph.sourceNode.connect(analyser)
  analyser.connect(silent)
  silent.connect(graph.audioContext.destination)
  const bins = new Uint8Array(analyser.frequencyBinCount)
  const samples = new Uint8Array(analyser.fftSize)
  let frame = requestAnimationFrame(function tick() {
    analyser.getByteFrequencyData(bins)
    analyser.getByteTimeDomainData(samples)
    onLevels(mixVoiceActivity(voiceActivityLevels(bins), voiceActivityRms(samples)))
    frame = requestAnimationFrame(tick)
  })
  return () => {
    cancelAnimationFrame(frame)
    graph.sourceNode?.disconnect(analyser)
    analyser.disconnect()
    silent.disconnect()
  }
}
