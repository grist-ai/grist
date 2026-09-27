import { createUniqueId, type ComponentProps } from "solid-js"

const SCALE = 129 / 42
const PITCH = 90
const LETTER_WIDTH = 24 * SCALE
const OFFSET_X = (720 - (4 * PITCH + LETTER_WIDTH)) / 2

// Pixel letterforms on a 24x42 grid (6-unit strokes), drawn as unions of
// rects so no fill-rule tricks are needed. Same idiom as the previous mark.
const LETTERS: Record<string, string> = {
  g: "M0 6H24V12H0Z M0 12H6V30H0Z M0 30H24V36H0Z M18 12H24V18H18Z M18 24H24V30H18Z M0 18H24V24H0Z",
  r: "M0 6H6V36H0Z M0 6H24V12H0Z M18 12H24V24H18Z M6 18H18V24H6Z M12 24H18V36H12Z",
  i: "M9 6H15V36H9Z M6 6H18V12H6Z M6 30H18V36H6Z",
  s: "M0 6H24V12H0Z M0 12H6V18H0Z M0 18H24V24H0Z M18 24H24V30H18Z M0 30H24V36H0Z",
  t: "M0 6H24V12H0Z M9 12H15V36H9Z",
}

const WORD = "grist"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            {[...WORD].map((letter, index) => (
              <g transform={`translate(${OFFSET_X + index * PITCH} 0) scale(${SCALE})`}>
                <path pathLength={props.outline ? 1 : undefined} d={LETTERS[letter]} />
              </g>
            ))}
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
