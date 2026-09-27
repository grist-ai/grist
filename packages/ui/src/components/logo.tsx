import { type ComponentProps } from "solid-js"
import { Wordmark } from "../typography/wordmark/wordmark"

const GRIST_ORANGE = "#EC5B2B"

function GristMarkPaths() {
  return (
    <>
      <rect width="32" height="32" fill="#000" />
      <g transform="translate(8 6)" fill={GRIST_ORANGE}>
        <path d="M0 0H16V4H4V16H16V20H0V0ZM12 8H16V12H8V8H12Z" />
      </g>
    </>
  )
}

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <GristMarkPaths />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <GristMarkPaths />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return <Wordmark class={props.class} />
}
