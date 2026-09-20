import { logo } from "../logo"
import { PRODUCT_NAME_LOWER } from "../product"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const orange = "\x1b[38;2;236;91;43m"
const inkShadow = "\x1b[38;2;80;36;22m"
const inkBg = "\x1b[48;2;80;36;22m"

function wordmark(pad = "") {
  const draw = (line: string, fg: string, shade: string, fill: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${fill} ${reset}`
        if (char === "^") return `${fg}${fill}▀${reset}`
        if (char === "~") return `${shade}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    const left = draw(line, orange, inkShadow, inkBg)
    const right = draw(logo.right[index] ?? "", orange, inkShadow, inkBg)
    return `${pad}${left} ${right}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  const resume = input.sessionID ? `${PRODUCT_NAME_LOWER} -s ${input.sessionID}` : `${PRODUCT_NAME_LOWER} -s <session>`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}${resume}${reset}`,
    "",
  ].join("\n")
}
