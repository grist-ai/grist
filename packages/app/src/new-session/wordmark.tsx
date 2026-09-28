import { WordmarkV2 } from "./wordmark-v2"

/** Grist orange — matches PRODUCT_COLOR in packages/desktop/brand.ts. */
const GRIST_ORANGE = "#EC5B2B"

export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px]"
    >
      <div class="relative mx-auto w-4/5">
        <WordmarkV2 class="block h-auto w-full" style={{ color: GRIST_ORANGE }} />
      </div>
    </div>
  )
}
