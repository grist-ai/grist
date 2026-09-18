export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled union member: ${String(value)}`);
}
