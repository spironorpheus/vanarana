import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './recording-dialog.css'

type RecordingDialogProps = {
  children: ReactNode
  onStop: () => void
  status: string
}

function restoreAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

function tabStops(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]')]
    .filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor)
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
        if (ancestor === dialog) break
      }
      return true
    })
    .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity))
}

export default function RecordingDialog({ children, onStop, status }: RecordingDialogProps) {
  const statusId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const stop = useRef(onStop)
  const [portal] = useState(() => {
    const element = document.createElement('div')
    element.className = 'tx-recording-portal'
    return element
  })

  // Status and audio-clock renders must not unlock the page or reset focus.
  useLayoutEffect(() => { stop.current = onStop }, [onStop])

  useLayoutEffect(() => {
    const panel = dialog.current
    const button = stopButton.current
    if (!panel || !button) return

    const body = document.body
    const html = document.documentElement
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scroll = { x: window.scrollX, y: window.scrollY }
    const bodyStyle = body.getAttribute('style')
    const htmlStyle = html.getAttribute('style')
    const siblings = new Map<Element, { inert: string | null; ariaHidden: string | null }>()

    body.appendChild(portal)
    const isolateBackground = () => {
      for (const element of body.children) {
        if (element === portal || siblings.has(element)) continue
        siblings.set(element, { inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') })
        element.setAttribute('inert', '')
        element.setAttribute('aria-hidden', 'true')
      }
    }
    // Move focus before hiding its previous ancestor from assistive technology.
    button.focus({ preventScroll: true })
    isolateBackground()
    const observer = new window.MutationObserver(isolateBackground)
    observer.observe(body, { childList: true })

    // A fixed body also locks Safari's background page while keeping the chart
    // at its original coordinates. The portal itself fills the visual viewport.
    body.style.position = 'fixed'
    body.style.top = `${-scroll.y}px`
    body.style.left = `${-scroll.x}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    html.style.scrollBehavior = 'auto'

    const focusInside = (event: FocusEvent) => {
      if (event.target instanceof window.Node && !panel.contains(event.target)) button.focus({ preventScroll: true })
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!event.repeat) stop.current()
        return
      }
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const items = tabStops(panel)
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = current < 0 ? (event.shiftKey ? items.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + items.length) % items.length
      event.preventDefault()
      ;(items[next] ?? button).focus({ preventScroll: true })
    }
    document.addEventListener('focusin', focusInside)
    document.addEventListener('keydown', keyboard, true)

    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', focusInside)
      document.removeEventListener('keydown', keyboard, true)
      for (const [element, previous] of siblings) {
        restoreAttribute(element, 'inert', previous.inert)
        restoreAttribute(element, 'aria-hidden', previous.ariaHidden)
      }
      portal.remove()
      restoreAttribute(body, 'style', bodyStyle)
      // Restore focus without bringing a distant chart cell into view. A route
      // change can remove that control, in which case there is nothing to focus.
      if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true })
      // Keep smooth-scroll styles disabled until the exact position is restored.
      if (window.scrollX !== scroll.x || window.scrollY !== scroll.y) {
        window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' })
      }
      restoreAttribute(html, 'style', htmlStyle)
    }
  }, [portal])

  return createPortal(
    <div ref={dialog} className="tx-recording-dialog" role="dialog" aria-modal="true" aria-label="Record melody" aria-describedby={statusId}>
      <div className="tx-recording-header">
        <p id={statusId} className="tx-recording-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
        <button ref={stopButton} className="tx-recording-stop" type="button" onClick={() => stop.current()}>Stop recording</button>
      </div>
      <div className="tx-recording-content">{children}</div>
    </div>,
    portal,
  )
}
