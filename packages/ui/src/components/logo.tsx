import { type ComponentProps } from "solid-js"

/** Compact G mark. */
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="var(--icon-strong-base)" d="M0 0H16V4H4V16H16V20H0V0ZM12 8H16V12H8V8H12Z" />
    </svg>
  )
}

/** Loading splash — full GRIST wordmark (not the old O mark). */
export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class" | "style">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      style={props.style}
      viewBox="0 0 156 42"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Grist"
    >
      <g fill="currentColor">
        {/* G */}
        <path d="M0 6H24V12H6V30H24V36H0V6ZM18 18H24V24H12V18H18Z" />
        {/* R */}
        <path d="M36 6H54V12H42V18H54V24H48V18H42V36H36V6ZM48 24H54V36H48V24Z" />
        {/* I */}
        <path d="M66 6H72V36H66V6Z" />
        {/* S */}
        <path d="M84 6H108V12H90V18H108V36H84V30H102V24H84V6Z" />
        {/* T */}
        <path d="M120 6H156V12H144V36H132V12H120V6Z" />
      </g>
    </svg>
  )
}

/** Pixel wordmark: GRIST */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 156 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-label="Grist"
    >
      <g fill="var(--icon-strong-base)">
        <path d="M0 6H24V12H6V30H24V36H0V6ZM18 18H24V24H12V18H18Z" />
        <path d="M36 6H54V12H42V18H54V24H48V18H42V36H36V6ZM48 24H54V36H48V24Z" />
        <path d="M66 6H72V36H66V6Z" />
        <path d="M84 6H108V12H90V18H108V36H84V30H102V24H84V6Z" />
        <path d="M120 6H156V12H144V36H132V12H120V6Z" />
      </g>
      <g fill="var(--icon-weak-base)">
        <path d="M18 18H12V24H18V30H6V12H18V18Z" />
        <path d="M48 12H42V24H48V12Z" />
        <path d="M102 18H90V24H102V18Z" />
      </g>
    </svg>
  )
}
