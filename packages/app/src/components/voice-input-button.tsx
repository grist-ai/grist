import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Index, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { attachVoiceActivity, openMoonshineMic } from "@/utils/moonshine-local"
import { sameActivity, textFromLines, VOICE_ACTIVITY_BARS } from "@/utils/voice-input"
import { showToast } from "@/utils/toast"

export type VoiceInputState = "idle" | "recording" | "busy"

const restingLevels = () => Array.from({ length: VOICE_ACTIVITY_BARS }, () => 0)

export function useVoiceInput(input: { onTranscript: (text: string) => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [voice, setVoice] = createStore({
    state: "idle" as VoiceInputState,
    stopping: false,
    levels: restingLevels(),
  })
  let mic: Awaited<ReturnType<typeof openMoonshineMic>> | undefined
  let lines: string[] = []
  let partial = ""
  let detachActivity: (() => void) | undefined

  const detach = () => {
    detachActivity?.()
    detachActivity = undefined
    setVoice("levels", restingLevels())
  }

  onCleanup(() => {
    detach()
    void mic?.stop()
    mic?.close()
  })

  const toggle = async () => {
    if (voice.state === "busy") return
    if (voice.state === "recording") {
      detach()
      setVoice({ state: "busy", stopping: true })
      try {
        await mic?.stop()
        const text = textFromLines(partial && lines.at(-1) !== partial ? [...lines, partial] : lines)
        lines = []
        partial = ""
        if (!text) {
          showToast({
            title: language.t("prompt.toast.voice.empty.title"),
            description: language.t("prompt.toast.voice.empty.description"),
          })
          return
        }
        input.onTranscript(text)
      } catch (error) {
        lines = []
        partial = ""
        console.error("voice input failed", error)
        showToast({
          title: language.t("prompt.toast.voice.failed.title"),
          description: language.t("prompt.toast.voice.failed.description"),
          variant: "error",
        })
      } finally {
        setVoice({ state: "idle", stopping: false })
      }
      return
    }

    const allowed = (await platform.ensureMicrophoneAccess?.()) ?? true
    if (!allowed) {
      showToast({
        title: language.t("prompt.toast.voice.permission.title"),
        description: language.t("prompt.toast.voice.permission.description"),
        variant: "error",
      })
      return
    }

    setVoice("state", "busy")
    lines = []
    partial = ""
    try {
      if (!mic) {
        mic = await openMoonshineMic((line) => {
          const spoken = line.text.trim()
          if (spoken) lines.push(spoken)
          partial = ""
        })
        mic.onText((text) => {
          partial = text.trim()
        })
      }
      await mic.start()
      detachActivity = attachVoiceActivity(mic, (levels) => {
        setVoice("levels", (prev: readonly number[]) => (sameActivity(prev, levels) ? prev : [...levels]))
      })
      setVoice("state", "recording")
    } catch (error) {
      console.error("voice input failed", error)
      detach()
      void mic?.stop()
      showToast({
        title: language.t("prompt.toast.voice.failed.title"),
        description: language.t("prompt.toast.voice.failed.description"),
        variant: "error",
      })
      setVoice("state", "idle")
    }
  }

  return {
    state: () => voice.state,
    stopping: () => voice.stopping,
    levels: () => voice.levels,
    toggle,
  }
}

export function VoiceActivityBars(props: { levels: readonly number[]; class?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="voice-activity"
      class="flex h-4 items-center gap-0.5"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <Index each={props.levels}>
        {(level) => (
          <span
            class="w-[3px] rounded-full bg-current transition-[height] duration-75"
            style={{ height: `${4 + Math.round(level() * 12)}px` }}
          />
        )}
      </Index>
    </div>
  )
}

export function VoiceInputButton(props: {
  disabled?: boolean
  voice: ReturnType<typeof useVoiceInput>
}) {
  const language = useLanguage()
  const label = () => {
    if (props.voice.stopping() || props.voice.state() === "recording") return language.t("prompt.action.voice.stop")
    if (props.voice.state() === "busy") return language.t("prompt.action.voice.transcribing")
    return language.t("prompt.action.voice")
  }

  const recording = () => props.voice.state() === "recording" || props.voice.stopping()

  return (
    <div class="inline-flex items-center gap-1.5">
      <Show when={props.voice.state() === "recording"}>
        <VoiceActivityBars levels={props.voice.levels()} class="text-icon-critical-base" />
      </Show>
      <TooltipV2 placement="top" value={label()}>
        <IconButtonV2
          data-action="prompt-voice"
          type="button"
          icon={
            <Icon
              name={recording() ? "stop" : "microphone"}
              style={recording() ? { color: "var(--icon-critical-base)" } : undefined}
            />
          }
          variant="ghost-muted"
          size="large"
          disabled={props.disabled || props.voice.state() === "busy"}
          aria-label={label()}
          aria-pressed={recording()}
          style={
            recording()
              ? { color: "var(--icon-critical-base)", background: "var(--surface-critical-weak)" }
              : undefined
          }
          onClick={() => void props.voice.toggle()}
        />
      </TooltipV2>
    </div>
  )
}
