#!/usr/bin/env bun
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { WHISPER_MODEL_ID } from "../src/main/whisper-assets"

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..")
const whisperRoot = join(packageDir, "resources/whisper")
const transformersVersion = "3.7.2"

const modelFiles = [
  "added_tokens.json",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "normalizer.json",
  "onnx/decoder_model_merged_q4.onnx",
  "onnx/encoder_model_q4.onnx",
  "preprocessor_config.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]

const wasmFiles = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]

export async function fetchWhisper() {
  await mkdir(join(whisperRoot, "models", WHISPER_MODEL_ID, "onnx"), { recursive: true })
  await mkdir(join(whisperRoot, "wasm"), { recursive: true })
  for (const file of modelFiles) {
    const url = `https://huggingface.co/${WHISPER_MODEL_ID}/resolve/main/${file}`
    await download(url, join(whisperRoot, "models", WHISPER_MODEL_ID, file))
  }
  for (const file of wasmFiles) {
    const url = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${transformersVersion}/dist/${file}`
    await download(url, join(whisperRoot, "wasm", file))
  }
}

async function download(url: string, dest: string) {
  if (await complete(dest)) {
    console.log(`skip ${dest}`)
    return
  }
  await mkdir(dirname(dest), { recursive: true })
  console.log(`fetch ${url}`)
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  await Bun.write(dest, response)
}

async function complete(dest: string) {
  const file = Bun.file(dest)
  if (!(await file.exists())) return false
  return file.size > 0
}

if (import.meta.main) await fetchWhisper()
