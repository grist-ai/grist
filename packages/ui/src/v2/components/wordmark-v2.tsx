import { createUniqueId, type ComponentProps } from "solid-js"

/** Soft GRIST wordmark for empty states. */
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 480 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16" fill="currentColor">
            {/* G */}
            <path
              opacity="0.7"
              d="M0 18H73.8462V36.4286H18.4615V91.7143H73.8462V110.143H0V18ZM55.3846 54.8571H73.8462V73.2857H36.9231V54.8571H55.3846Z"
            />
            {/* R */}
            <path
              opacity="0.7"
              d="M110.462 18H165.846V36.4286H128.923V54.8571H165.846V73.2857H147.385V54.8571H128.923V110.143H110.462V18ZM147.385 73.2857H165.846V110.143H147.385V73.2857Z"
            />
            {/* I */}
            <path opacity="0.7" d="M203.462 18H221.923V110.143H203.462V18Z" />
            {/* S */}
            <path
              opacity="0.7"
              d="M258.846 18H332.385V36.4286H277.308V54.8571H332.385V110.143H258.846V91.7143H314V73.2857H258.846V18Z"
            />
            {/* T */}
            <path
              opacity="0.7"
              d="M369 18H479.538V36.4286H442.846V110.143H405.923V36.4286H369V18Z"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="129">
          <rect width="480" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="240" y1="68" x2="240" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
