import { useEffect, useRef, type ReactNode } from 'react'
import { CloseIcon } from './Icons'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  testId?: string
}

/**
 * A short panel that slides up from the bottom. The top of the screen stays in view,
 * so you can watch the distances and the club call change as you tap.
 */
export function Drawer({ title, onClose, children, testId }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    headingRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" data-testid={testId}>
        <header className="drawer-head">
          <h2 id="drawer-title" ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Done">
            <CloseIcon />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  )
}
