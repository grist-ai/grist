import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { startVoiceCapture } from "@/utils/voice-input"
import { dismissToast, showToast } from "@/utils/toast"
import { isWhisperDownloadProgress, transcribeWhisperLargeV3 } from "@/utils/whisper-local"

export type VoiceInputState = "idle" | "recording" | "busy"

export function useVoiceInput(input: { onTranscript: (text: string) => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createSignal<VoiceInputState>("idle")
  let capture: Awaited<ReturnType<typeof startVoiceCapture>> | undefined
  let downloadToast: number | undefined

  onCleanup(() => {
    capture?.cancel()
  })

  const toggle = async () => {
    if (state() === "busy") return
    if (state() === "recording") {
      setState("busy")
      try {
        const samples = await capture?.stop()
        capture = undefined
        await finish(samples ?? new Float32Array())
      } catch (error) {
        capture = undefined
        console.error("voice input failed", error)
        showToast({
          title: language.t("prompt.toast.voice.failed.title"),
          description: language.t("prompt.toast.voice.failed.description"),
          variant: "error",
        })
        setState("idle")
      }
      return
    }
    try {
      const allowed = (await platform.ensureMicrophoneAccess?.()) ?? true
      if (!allowed) {
        showToast({
          title: language.t("prompt.toast.voice.permission.title"),
          description: language.t("prompt.toast.voice.permission.description"),
          variant: "error",
        })
        return
      }
      capture = await startVoiceCapture()
      setState("recording")
    } catch {
      showToast({
        title: language.t("prompt.toast.voice.permission.title"),
        description: language.t("prompt.toast.voice.permission.description"),
        variant: "error",
      })
    }
  }

  const finish = async (samples: Float32Array) => {
    try {
      const text = await transcribeWhisperLargeV3(samples, (progress) => {
        if (!isWhisperDownloadProgress(progress) || downloadToast !== undefined) return
        downloadToast = showToast({
          title: language.t("prompt.toast.voice.download.title"),
          description: language.t("prompt.toast.voice.download.description"),
        })
      })
      if (!text) {
        showToast({
          title: language.t("prompt.toast.voice.empty.title"),
          description: language.t("prompt.toast.voice.empty.description"),
        })
        return
      }
      input.onTranscript(text)
    } catch (error) {
      console.error("voice input failed", error)
      showToast({
        title: language.t("prompt.toast.voice.failed.title"),
        description: language.t("prompt.toast.voice.failed.description"),
        variant: "error",
      })
    } finally {
      if (downloadToast !== undefined) dismissToast(downloadToast)
      downloadToast = undefined
      setState("idle")
    }
  }

  return { state, toggle }
}

export function VoiceInputButton(props: {
  disabled?: boolean
  voice: ReturnType<typeof useVoiceInput>
}) {
  const language = useLanguage()
  const label = () => {
    if (props.voice.state() === "recording") return language.t("prompt.action.voice.stop")
    if (props.voice.state() === "busy") return language.t("prompt.action.voice.transcribing")
    return language.t("prompt.action.voice")
  }

  return (
    <TooltipV2 placement="top" value={label()}>
      <IconButtonV2
        data-action="prompt-voice"
        type="button"
        icon={<Icon name="microphone" />}
        variant={props.voice.state() === "recording" ? "contrast" : "ghost-muted"}
        size="large"
        disabled={props.disabled || props.voice.state() === "busy"}
        aria-label={label()}
        aria-pressed={props.voice.state() === "recording"}
        classList={{ "text-v2-icon-icon-critical": props.voice.state() === "recording" }}
        onClick={() => void props.voice.toggle()}
      />
    </TooltipV2>
  )
}
