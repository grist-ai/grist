import { type ComponentProps } from "solid-js"

/** Soft GRIST wordmark for empty states (restored from v1). */
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class" | "style">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 480 129"
      fill="none"
      class={props.class}
      style={props.style}
      aria-label="Grist"
    >
      <g fill="currentColor">
        {/* G */}
        <path d="M0 18H73.8462V36.4286H18.4615V91.7143H73.8462V110.143H0V18ZM55.3846 54.8571H73.8462V73.2857H36.9231V54.8571H55.3846Z" />
        {/* R */}
        <path d="M110.462 18H165.846V36.4286H128.923V54.8571H165.846V73.2857H147.385V54.8571H128.923V110.143H110.462V18ZM147.385 73.2857H165.846V110.143H147.385V73.2857Z" />
        {/* I */}
        <path d="M203.462 18H221.923V110.143H203.462V18Z" />
        {/* S */}
        <path d="M258.846 18H332.385V36.4286H277.308V54.8571H332.385V110.143H258.846V91.7143H314V73.2857H258.846V18Z" />
        {/* T */}
        <path d="M369 18H479.538V36.4286H442.846V110.143H405.923V36.4286H369V18Z" />
      </g>
    </svg>
  )
}
