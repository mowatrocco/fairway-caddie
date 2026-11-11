/** Hand a file to the user: the iPhone share sheet where possible (Save to Files, AirDrop), else a download. */
export async function shareOrDownload(text: string, fileName: string, type = 'application/json'): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], fileName, { type })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // fall through to a plain download
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

