import type { ParentProps } from "solid-js"

export function SessionRouteFrame(props: ParentProps<{ padded?: boolean }>) {
  return (
    <div
      class="relative flex size-full flex-col"
      classList={{
        "px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]":
          props.padded,
      }}
    >
      {props.children}
    </div>
  )
}

export function SessionPanelFrame(props: ParentProps<{ raised?: boolean }>) {
  // D6.1: panels are flush with the shell canvas — no rounding, no elevation
  // shadow. `raised` is accepted for compatibility and no longer restyles.
  void props.raised
  return <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-v2-background-bg-base">{props.children}</div>
}
