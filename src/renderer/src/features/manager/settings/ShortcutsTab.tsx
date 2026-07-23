import { useEffect, useState } from 'react'
import {
  SHORTCUT_ACTIONS,
  chordToDisplay,
  eventToChord,
  resolveChords,
  useKeyboardStore
} from '@renderer/features/keyboard/keyboard-store'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { updateSettings } from '@renderer/features/orders/order-service'
import { MdSave } from 'react-icons/md'

export function ShortcutsTab(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const storeChords = useKeyboardStore((s) => s.chords)
  const setChord    = useKeyboardStore((s) => s.setChord)
  const setCapturingShortcut = useKeyboardStore((s) => s.setCapturingShortcut)

  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...storeChords }))
  const [recording, setRecording] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setDraft({ ...storeChords })
  }, [storeChords])

  useEffect(() => {
    setCapturingShortcut(Boolean(recording))
    if (!recording) return () => setCapturingShortcut(false)
    function capture(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { setRecording(null); return }
      const chord = eventToChord(e)
      if (['ctrl', 'alt', 'shift', 'meta'].includes(chord)) return
      setDraft((d) => ({ ...d, [recording!]: chord }))
      setRecording(null)
    }
    window.addEventListener('keydown', capture, { capture: true })
    return () => {
      window.removeEventListener('keydown', capture, { capture: true })
      setCapturingShortcut(false)
    }
  }, [recording, setCapturingShortcut])

  function conflictFor(actionId: string): string | null {
    const chord = draft[actionId]
    if (!chord) return null
    for (const [otherId, otherChord] of Object.entries(draft)) {
      if (otherId !== actionId && otherChord === chord) {
        const other = SHORTCUT_ACTIONS.find((a) => a.id === otherId)
        return other?.labelAr ?? otherId
      }
    }
    return null
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMsg(null)
    try {
      for (const [id, chord] of Object.entries(draft)) {
        setChord(id, chord)
      }
      await updateSettings({ keyboardShortcuts: draft }, user)
      setMsg('تم حفظ الاختصارات ✓')
    } catch { setMsg('فشل الحفظ') }
    finally { setSaving(false) }
  }

  function handleReset(): void {
    const defaults = resolveChords({})
    setDraft({ ...defaults })
  }

  const groups = SHORTCUT_ACTIONS.reduce<Record<string, typeof SHORTCUT_ACTIONS>>((acc, a) => {
    ;(acc[a.groupAr] ??= []).push(a)
    return acc
  }, {})

  return (
    <div className="shortcuts-tab">
      <p className="shortcuts-tab__hint">
        اضغط على زر الاختصار ثم اضغط المفاتيح الجديدة. اضغط Escape للإلغاء.
      </p>

      {msg && (
        <p className={`form-message ${msg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>
          {msg}
        </p>
      )}

      {Object.entries(groups).map(([group, actions]) => (
        <div key={group} className="card">
          <h2 className="card__title">{group}</h2>
          <table className="data-table shortcuts-table">
            <thead>
              <tr>
                <th>الإجراء</th>
                <th>الاختصار</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => {
                const chord = draft[action.id] ?? ''
                const isRecording = recording === action.id
                const conflict = conflictFor(action.id)
                return (
                  <tr key={action.id} className={conflict ? 'shortcut-row--conflict' : ''}>
                    <td>{action.labelAr}</td>
                    <td>
                      <button
                        type="button"
                        className={`shortcut-chord-btn${isRecording ? ' shortcut-chord-btn--recording' : ''}`}
                        onClick={() => setRecording(isRecording ? null : action.id)}
                        title={isRecording ? 'اضغط المفاتيح أو Escape للإلغاء' : 'انقر لتغيير الاختصار'}
                      >
                        {isRecording ? (
                          <span className="shortcut-chord-btn__recording-label">اضغط المفاتيح…</span>
                        ) : chord ? (
                          chordToDisplay(chord)
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>غير مُعيَّن</span>
                        )}
                      </button>
                      {conflict && (
                        <div className="shortcut-conflict-msg">
                          ⚠️ تعارض مع: {conflict}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            const def = SHORTCUT_ACTIONS.find((a) => a.id === action.id)?.defaultChord ?? ''
                            setDraft((d) => ({ ...d, [action.id]: def }))
                          }}
                          title="استعادة الاختصار الافتراضي"
                        >
                          افتراضي
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setDraft((d) => ({ ...d, [action.id]: '' }))}
                          title="إزالة الاختصار"
                        >
                          مسح
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
          <MdSave /> {saving ? 'جارٍ الحفظ…' : 'حفظ الاختصارات'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleReset}>
          استعادة الافتراضي للكل
        </button>
      </div>
    </div>
  )
}
