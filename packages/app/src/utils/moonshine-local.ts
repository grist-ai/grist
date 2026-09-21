/// <reference types="vite/client" />
import moonshineModuleUrl from "@moonshine-ai/moonshine-wasm/moonshine.mjs?url"
import moonshineWasmUrl from "@moonshine-ai/moonshine-wasm/moonshine.wasm?url"
import { MicTranscriber, ModelArch, Transcriber, type LoadModuleOptions, type TranscriptLine } from "@moonshine-ai/moonshine-wasm"
import { mixVoiceActivity, voiceActivityLevels, voiceActivityRms } from "@/utils/voice-input"

const SPEECH_MODEL_BASE = "grist-speech://models/"

let transcriberPromise: Promise<Transcriber> | undefined

export async function openMoonshineMic(onLine: (line: TranscriptLine) => void) {
  const transcriber = await loadTranscriber()
  return new MicTranscriber().useTranscriber(transcriber).language("en").onLine(onLine)
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
  const factory = imported.default ?? (imported as LoadModuleOptions["factory"])
  return Transcriber.load({
    files: await bundledModelFiles(),
    modelArch: ModelArch.MediumStreaming,
    moduleOptions: {
      factory,
      locateFile: (path) =>
        path.endsWith(".wasm")
          ? moonshineWasmUrl
          : new URL(path, new URL(moonshineModuleUrl, window.location.href)).href,
    },
  })
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
