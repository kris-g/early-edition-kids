// Early Edition on iPad: the child's reader, opened from a home-screen icon.
import './fonts.css'
import './styles.css'
import { ReaderApp } from './app'

// No pinch or double-tap zoom: this is a paper, not a web page (iOS ignores user-scalable=no).
document.addEventListener('gesturestart', (e) => e.preventDefault())
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false })
document.addEventListener(
  'touchmove',
  (e) => {
    if ((e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale?: number }).scale !== 1) e.preventDefault()
  },
  { passive: false },
)
// No long-press menus on photos or text.
document.addEventListener('contextmenu', (e) => e.preventDefault())

const app = document.getElementById('app')
const stage = document.getElementById('stage')
if (app && stage) new ReaderApp({ app, stage }).start()
