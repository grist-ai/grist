import { WHISPER_SAMPLE_RATE } from "./voice-input"

export const WHISPER_MODEL_ID = "onnx-community/whisper-large-v3"

export type WhisperProgress = {
  status?: string
  file?: string
  progress?: number
}

type AsrOutput = { text?: string } | Array<{ text?: string }>

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<AsrOutput>

let pipelinePromise: Promise<Transcriber> | undefined

export function isWhisperDownloadProgress(progress: WhisperProgress) {
  if (progress.status === "done" || progress.status === "ready") return false
  if (typeof progress.progress === "number") return progress.progress < 1
  return progress.status === "progress" || progress.status === "download" || progress.status === "initiate"
}

export function textFromAsr(result: AsrOutput) {
  if (Array.isArray(result)) return result.map((item) => item.text ?? "").join(" ").trim()
  return result.text?.trim() ?? ""
}

export async function transcribeWhisperLargeV3(
  audio: Float32Array,
  onProgress?: (progress: WhisperProgress) => void,
) {
  if (audio.length === 0) return ""
  const transcriber = await loadWhisper(onProgress)
  const result = await transcriber(audio, {
    sampling_rate: WHISPER_SAMPLE_RATE,
    task: "transcribe",
    return_timestamps: false,
  })
  return textFromAsr(result)
}

async function loadWhisper(onProgress?: (progress: WhisperProgress) => void) {
  if (!pipelinePromise) pipelinePromise = createWhisperPipeline(onProgress)
  try {
    return await pipelinePromise
  } catch (error) {
    pipelinePromise = undefined
    throw error
  }
}

async function createWhisperPipeline(onProgress?: (progress: WhisperProgress) => void) {
  const transformers = await import("@huggingface/transformers")
  transformers.env.allowLocalModels = false
  transformers.env.useBrowserCache = true
  transformers.env.useFS = false
  transformers.env.useFSCache = false
  const wasm = transformers.env.backends.onnx.wasm
  if (wasm) wasm.proxy = false
  const device = await whisperDevice()
  const transcriber = await transformers.pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
    dtype: "q4",
    device,
    progress_callback: onProgress,
  })
  return transcriber as unknown as Transcriber
}

async function whisperDevice() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) return "wasm" as const
  const adapter = await gpu.requestAdapter()
  if (!adapter) return "wasm" as const
  return "webgpu" as const
}
