import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { Index, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { attachVoiceActivity, openMoonshineMic, preloadSpeechModel } from "@/utils/moonshine-local"
import { sameActivity, textFromLines, VOICE_ACTIVITY_BARS } from "@/utils/voice-input"
import { showToast } from "@/shell/notifications/toast"

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
  let cancelled = false
  let capturing = false

  const detach = () => {
    detachActivity?.()
    detachActivity = undefined
    setVoice("levels", restingLevels())
  }

  onMount(() => {
    preloadSpeechModel()
  })

  onCleanup(() => {
    cancelled = true
    detach()
    void mic?.stop()
    mic?.close()
  })

  const toggle = async () => {
    if (voice.stopping) return
    if (voice.state === "recording") {
      cancelled = true
      detach()
      setVoice({ state: "busy", stopping: true })
      try {
        if (!capturing) return
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
        capturing = false
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

    cancelled = false
    setVoice("state", "recording")
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
      if (cancelled) return
      await mic.start()
      if (cancelled) {
        await mic.stop()
        return
      }
      capturing = true
      detachActivity = attachVoiceActivity(mic, (levels) => {
        setVoice("levels", (prev: readonly number[]) => (sameActivity(prev, levels) ? prev : [...levels]))
      })
    } catch (error) {
      if (cancelled) return
      console.error("voice input failed", error)
      detach()
      void mic?.stop()
      showToast({
        title: language.t("prompt.toast.voice.failed.title"),
        description: language.t("prompt.toast.voice.failed.description"),
        variant: "error",
      })
      setVoice({ state: "idle", stopping: false })
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
  const live = () => props.levels.some((level) => level > 0.08)
  return (
    <div
      aria-hidden="true"
      data-slot="voice-activity"
      data-live={live() ? "" : undefined}
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

// The v2 icon set has no microphone glyph, so the button carries its own SVG
// until one lands in @opencode/ui (Track B owns packages/ui).
function MicrophoneIcon(props: { style?: JSX.CSSProperties }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={props.style}
    >
      <path
        d="M8 1.75C6.75736 1.75 5.75 2.75736 5.75 4V7.5C5.75 8.74264 6.75736 9.75 8 9.75C9.24264 9.75 10.25 8.74264 10.25 7.5V4C10.25 2.75736 9.24264 1.75 8 1.75Z"
        stroke="currentColor"
      />
      <path
        d="M4.25 7.25V7.5C4.25 9.57107 5.92893 11.25 8 11.25C10.0711 11.25 11.75 9.57107 11.75 7.5V7.25M8 11.25V14M5.5 14H10.5"
        stroke="currentColor"
        stroke-linecap="square"
      />
    </svg>
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
      <Tooltip placement="top" value={label()}>
        <IconButton
          data-action="prompt-voice"
          type="button"
          icon={
            recording() ? (
              <Icon name="stop" style={{ color: "var(--icon-critical-base)" }} />
            ) : (
              <MicrophoneIcon />
            )
          }
          variant="ghost-muted"
          size="large"
          disabled={props.disabled || props.voice.stopping()}
          aria-label={label()}
          aria-pressed={recording()}
          style={
            recording()
              ? { color: "var(--icon-critical-base)", background: "var(--surface-critical-weak)" }
              : undefined
          }
          onClick={() => void props.voice.toggle()}
        />
      </Tooltip>
    </div>
  )
}
