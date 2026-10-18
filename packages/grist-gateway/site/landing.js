// Grist landing — copy buttons, scroll reveal, footer year. No framework.
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const text = button.getAttribute("data-copy") ?? ""
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
