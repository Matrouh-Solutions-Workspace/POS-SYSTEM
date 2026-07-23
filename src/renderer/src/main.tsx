import './styles/global.css'
import './styles/components.css'

const rootEl = document.getElementById('root')!
rootEl.innerHTML =
  '<div class="app-loading"><p>جاري التحميل...</p></div>'

void import('@renderer/lib/app-bootstrap').then((m) => m.bootstrapApp())
