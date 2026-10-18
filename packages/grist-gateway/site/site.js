// Grist site — copy buttons, scroll reveal, footer year, live GitHub stars. No framework.
document.querySelectorAll("[data-copy], [data-copy-target]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = button.getAttribute("data-copy-target")
    const text = target
      ? (document.getElementById(target)?.textContent ?? "").trim()
      : (button.getAttribute("data-copy") ?? "")
    try {
      await navigator.clipboard.writeText(text)
      const original = button.textContent
      button.textContent = "copied"
      setTimeout(() => (button.textContent = original), 1400)
    } catch {
      button.textContent = text
    }
  })
})

const year = document.getElementById("year")
if (year) year.textContent = String(new Date().getFullYear())

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("in")),
    { threshold: 0.12 },
  )
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el))
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"))
}

// Live GitHub star count for grist-ai/grist. If the fetch fails (offline,
// rate limit), the chip simply keeps its "star" label.
const starEls = document.querySelectorAll("[data-gh-stars]")
if (starEls.length) {
  fetch("https://api.github.com/repos/grist-ai/grist", { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("github"))))
    .then((d) => {
      const n = d.stargazers_count
      if (typeof n !== "number") return
      const label = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n)
      starEls.forEach((el) => (el.textContent = label))
    })
    .catch(() => {})
}
