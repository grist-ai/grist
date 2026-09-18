export function MillMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
    >
      <circle
        cx="16"
        cy="16"
        r="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="16"
        cy="16"
        r="4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M16 3.5 L16 11.2 M16 20.8 L16 28.5 M3.5 16 L11.2 16 M20.8 16 L28.5 16 M7.4 7.4 L12.6 12.6 M19.4 19.4 L24.6 24.6 M24.6 7.4 L19.4 12.6 M12.6 19.4 L7.4 24.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
