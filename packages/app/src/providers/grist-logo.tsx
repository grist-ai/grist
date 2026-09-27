export function GristLogo(props: { class?: string }) {
  return (
    <svg
      data-component="grist-logo"
      aria-hidden="true"
      class={props.class}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" fill="#000" />
      <g transform="translate(8 6)" fill="#EC5B2B">
        <path d="M0 0H16V4H4V16H16V20H0V0ZM12 8H16V12H8V8H12Z" />
      </g>
    </svg>
  )
}
