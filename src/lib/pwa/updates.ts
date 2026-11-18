// Keeps the installed app up to date. When a new version has been published, the
// service worker fetches it in the background and the app reloads onto it. It checks
// whenever the app comes back to the front (and hourly), so you don't have to
// remember to fully close it.

export async function startUpdates(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        if (!reg) return
        const check = () => {
          if (navigator.onLine) reg.update().catch(() => {})
        }
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        setInterval(check, 60 * 60 * 1000)
      },
    })
  } catch {
    // Offline support is switched off in some builds (the preview); nothing to do.
  }
}
