// Stops the dashboard zooming, so it behaves like an app on a phone.
//
// The viewport tag (index.html) blocks pinch zoom on Android, and the CSS
// `touch-action: manipulation` on <html> stops double-tap zoom everywhere.
// iPhone Safari ignores the viewport's limit, so pinches are cancelled here:
// its gesture events, and any touch move with two or more fingers. One-finger
// scrolling and swiping (the Share page's card row) are untouched.

export function blockZoom(doc: Document = document): () => void {
  const cancel = (e: Event) => e.preventDefault()
  const multiTouch = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault()
  }
  const opts = { passive: false } as const
  doc.addEventListener('gesturestart', cancel, opts)
  doc.addEventListener('gesturechange', cancel, opts)
  doc.addEventListener('touchmove', multiTouch, opts)
  return () => {
    doc.removeEventListener('gesturestart', cancel)
    doc.removeEventListener('gesturechange', cancel)
    doc.removeEventListener('touchmove', multiTouch)
  }
}
