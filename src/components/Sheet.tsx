import { useEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Full-height panel that slides over the current tab. */
export function Sheet({ title, onClose, children, footer }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // Runs once when the sheet opens; reading onClose through a ref keeps focus
  // from jumping back to the heading on every keystroke.
  useEffect(() => {
    headingRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('sheet-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('sheet-open')
    }
  }, [])

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header className="sheet-head">
          <h2 id="sheet-title" ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  )
}
