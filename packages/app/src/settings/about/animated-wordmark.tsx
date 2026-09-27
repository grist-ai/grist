import { createEffect, For, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

const target = ["g", "r", "i", "s", "t"] as const
const choices = ["g", "r", "i", "s", "t"] as const

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: [...target] })
  const timers = new Set<ReturnType<typeof setTimeout>>()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()
        if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("letters", [...target])
          return
        }

        const starts = target.map(() => choices[Math.floor(Math.random() * choices.length)])
        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", starts)

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((letter, index) =>
                tick >= settles[index] ? letter : choices[Math.floor(Math.random() * choices.length)],
              ),
            )
            timers.delete(timer)
          }, tick * 75)
          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox="0 0 150 42" aria-hidden="true">
      <defs>
        <symbol id="settings-about-letter-g" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 18H6V12H18V18Z" />
          <path d="M0 6H24V12H0Z M0 12H6V30H0Z M0 30H24V36H0Z M18 12H24V18H18Z M18 24H24V30H18Z M0 18H24V24H0Z" />
        </symbol>
        <symbol id="settings-about-letter-r" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 18H6V12H18V18Z" />
          <path d="M0 6H6V36H0Z M0 6H24V12H0Z M18 12H24V24H18Z M6 18H18V24H6Z M12 24H18V36H12Z" />
        </symbol>
        <symbol id="settings-about-letter-i" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M15 30H9V12H15V30Z" />
          <path d="M9 6H15V36H9Z M6 6H18V12H6Z M6 30H18V36H6Z" />
        </symbol>
        <symbol id="settings-about-letter-s" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M18 24H6V18H18V24Z" />
          <path d="M0 6H24V12H0Z M0 12H6V18H0Z M0 18H24V24H0Z M18 24H24V30H18Z M0 30H24V36H0Z" />
        </symbol>
        <symbol id="settings-about-letter-t" viewBox="0 0 24 42">
          <path class="settings-about-letter-shadow" d="M15 36H9V12H15V36Z" />
          <path d="M0 6H24V12H0Z M9 12H15V36H9Z" />
        </symbol>
      </defs>
      <For each={state.letters}>
        {(letter, index) => (
          <use href={`#settings-about-letter-${letter}`} x={index() * 30} width="24" height="42" />
        )}
      </For>
    </svg>
  )
}
