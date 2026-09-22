export function moonshinePthreadCopy(names: readonly string[]) {
  const mjs = names.find((name) => /^moonshine-.+\.mjs$/.test(name))
  const wasm = names.find((name) => /^moonshine-[^./]+\.wasm$/.test(name) && name !== "moonshine.wasm")
  const copies: { from: string; to: string }[] = []
  if (mjs) copies.push({ from: mjs, to: "moonshine.mjs" })
  if (wasm) copies.push({ from: wasm, to: "moonshine.wasm" })
  return copies
}

export function moonshinePthreadFallback(filename: string, siblings: readonly string[]) {
  return moonshinePthreadCopy(siblings).find((copy) => copy.to === filename)?.from
}
