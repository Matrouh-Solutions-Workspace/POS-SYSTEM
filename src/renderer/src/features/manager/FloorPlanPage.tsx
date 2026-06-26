/**
 * FloorPlanPage — visual floor-plan editor.
 *
 * Features:
 *  • Drag tables freely on a grid-snapped canvas
 *  • Each chair is an independent draggable element — drop it near any table to reassign
 *  • Draw wall/line segments in "Draw Wall" mode
 *  • Toggle table shape between square and circle directly from toolbar
 *  • Floors (areas) with tabs — Salon / Garden / Rooftop …
 *
 * Performance contract:
 *  • ALL drag operations mutate DOM refs only — zero React re-renders during drag
 *  • React state is committed only on pointerup
 */
import {
  useCallback, useEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { DiningTable, Floor, TableShape, WallSegment } from '@shared/types'
import {
  listFloors, saveFloor, deleteFloor,
  listDiningTables, saveDiningTable, saveTablesBatch, deleteDiningTable
} from '@renderer/features/tables/table-service'
import { ConfirmDeleteButton } from '@renderer/components/ConfirmDeleteButton'
import {
  MdAdd, MdSave, MdEdit, MdCheck,
  MdTableRestaurant, MdGridOn, MdGridOff, MdZoomIn, MdZoomOut,
  MdRotateRight, MdAddCircle, MdDraw, MdDelete
} from 'react-icons/md'

// ── Constants ──────────────────────────────────────────────────────────────

const GRID        = 20
const CHAIR_R     = 11    // chair radius in px
const CHAIR_GAP   = 5     // gap between chair edge and table edge
const SNAP_ASSIGN = 40    // px: drop chair near a table to reassign it
const MAX_ORBIT_R = 80    // px: max distance a chair can be from its table centre
const MIN_ZOOM    = 0.4
const MAX_ZOOM    = 2.0
const DEFAULT_W   = 80
const DEFAULT_H   = 80
const WALL_COLOR  = '#555'
const WALL_W      = 6

// ── Helpers ────────────────────────────────────────────────────────────────

function snap(v: number): number { return Math.round(v / GRID) * GRID }
function uid(): string { return crypto.randomUUID() }

/**
 * Clamp (px, py) so it stays within MAX_ORBIT_R of (cx, cy).
 * Returns the clamped point.
 */
function clampToOrbit(px: number, py: number, cx: number, cy: number, maxR: number): { x: number; y: number } {
  const dx = px - cx
  const dy = py - cy
  const dist = Math.hypot(dx, dy)
  if (dist <= maxR) return { x: px, y: py }
  const scale = maxR / dist
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function defaultChairPositions(
  tableX: number, tableY: number,
  tableW: number, tableH: number,
  count: number, shape: TableShape
): Array<{ id: string; x: number; y: number }> {
  const result: Array<{ id: string; x: number; y: number }> = []
  if (count <= 0) return result

  if (shape === 'circle') {
    const cx = tableX + tableW / 2
    const cy = tableY + tableH / 2
    const r  = tableW / 2 + CHAIR_R + CHAIR_GAP
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      result.push({ id: uid(), x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
    }
  } else {
    // distribute around rect sides
    const sides = [
      { dir: 'top',    n: Math.ceil(count / 4) },
      { dir: 'bottom', n: Math.ceil(count / 4) },
      { dir: 'left',   n: Math.floor(count / 4) },
      { dir: 'right',  n: Math.floor(count / 4) },
    ]
    // adjust so total === count
    let total = sides.reduce((s, d) => s + d.n, 0)
    let si = 0
    while (total > count) { sides[si % 4]!.n--; total--; si++ }
    while (total < count) { sides[si % 4]!.n++; total++; si++ }

    for (const side of sides) {
      for (let i = 0; i < side.n; i++) {
        const t = side.n === 1 ? 0.5 : i / (side.n - 1)
        let cx = 0, cy = 0
        const inset = 12
        if (side.dir === 'top') {
          cx = tableX + inset + t * (tableW - inset * 2)
          cy = tableY - CHAIR_R - CHAIR_GAP
        } else if (side.dir === 'bottom') {
          cx = tableX + inset + t * (tableW - inset * 2)
          cy = tableY + tableH + CHAIR_R + CHAIR_GAP
        } else if (side.dir === 'left') {
          cx = tableX - CHAIR_R - CHAIR_GAP
          cy = tableY + inset + t * (tableH - inset * 2)
        } else {
          cx = tableX + tableW + CHAIR_R + CHAIR_GAP
          cy = tableY + inset + t * (tableH - inset * 2)
        }
        result.push({ id: uid(), x: cx, y: cy })
      }
    }
  }
  return result
}

/** Return how many chairs already assigned to a table */
function chairsForTable(tableId: string, freeChairs: FreeChair[]): FreeChair[] {
  return freeChairs.filter((c) => c.tableId === tableId)
}

// ── Types ──────────────────────────────────────────────────────────────────

/** A chair that lives on the canvas independently */
interface FreeChair {
  id: string
  tableId: string   // which table this chair "belongs" to (shown in same color)
  x: number         // canvas position (centre)
  y: number
}

type ToolMode = 'select' | 'draw_wall'

interface MarqueeRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface DragTableSnapshot {
  id: string
  x: number
  y: number
  w: number
  h: number
}

interface DragChairSnapshot {
  id: string
  tableId: string
  x: number
  y: number
}

interface DragWallSnapshot {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

interface SelectionDragSnapshot {
  tables: DragTableSnapshot[]
  chairs: DragChairSnapshot[]
  walls: DragWallSnapshot[]
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): MarqueeRect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  }
}

function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function wallIntersectsRect(wall: WallSegment, rect: MarqueeRect): boolean {
  const pad = Math.max((wall.thickness ?? WALL_W) / 2, 8)
  const wallRect: MarqueeRect = {
    left: Math.min(wall.x1, wall.x2) - pad,
    top: Math.min(wall.y1, wall.y2) - pad,
    right: Math.max(wall.x1, wall.x2) + pad,
    bottom: Math.max(wall.y1, wall.y2) + pad,
  }
  return rectsIntersect(rect, wallRect)
}

// ── WallLayer SVG ──────────────────────────────────────────────────────────

function WallLayer({
  walls,
  width,
  height,
  selectedWallId,
  onSelectWall,
  drawingWall,
  onWallPointerDown,
  onWallClick,
  tool,
}: {
  walls: WallSegment[]
  width: number
  height: number
  selectedWallId: string | null
  onSelectWall: (id: string | null) => void
  drawingWall: WallSegment | null
  onWallPointerDown?: (e: React.PointerEvent<SVGLineElement>, id: string) => void
  onWallClick?: (id: string) => void
  tool: ToolMode
}): React.ReactElement {
  return (
    <svg
      style={{
        position: 'absolute', inset: 0, width, height,
        pointerEvents: 'none', zIndex: 0, overflow: 'visible'
      }}
    >
      {walls.map((w) => (
        <g key={w.id}>
          {/* Fat invisible hit area — much easier to click than the thin visible line */}
          <line
            x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke="transparent"
            strokeWidth={Math.max((w.thickness ?? WALL_W) + 16, 22)}
            strokeLinecap="round"
            style={{ pointerEvents: 'visibleStroke', cursor: tool === 'select' ? 'grab' : 'crosshair' }}
            onPointerDown={onWallPointerDown ? (e) => onWallPointerDown(e, w.id) : undefined}
            onClick={(e) => {
              e.stopPropagation()
              if (onWallClick) onWallClick(w.id)
              else onSelectWall(w.id)
            }}
          />
          {/* Visible stroke — pointer events off so the hit area handles everything */}
          <line
            x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke={selectedWallId === w.id ? 'var(--color-primary)' : (w.color ?? WALL_COLOR)}
            strokeWidth={(w.thickness ?? WALL_W) + (selectedWallId === w.id ? 4 : 0)}
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
          {/* Selection handles at endpoints when selected */}
          {selectedWallId === w.id && (
            <>
              <circle cx={w.x1} cy={w.y1} r={5} fill="var(--color-primary)" stroke="#fff" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
              <circle cx={w.x2} cy={w.y2} r={5} fill="var(--color-primary)" stroke="#fff" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
            </>
          )}
        </g>
      ))}
      {drawingWall && (
        <line
          x1={drawingWall.x1} y1={drawingWall.y1}
          x2={drawingWall.x2} y2={drawingWall.y2}
          stroke={WALL_COLOR} strokeWidth={WALL_W}
          strokeLinecap="round" strokeDasharray="8 4"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}

// ── ChairNode ──────────────────────────────────────────────────────────────

interface ChairNodeProps {
  chair: FreeChair
  color: string
  isSelected: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void
  onClick: (id: string) => void
  nodeRef?: (node: HTMLDivElement | null) => void
}

function ChairNode({ chair, color, isSelected, onPointerDown, onClick, nodeRef }: ChairNodeProps): React.ReactElement {
  return (
    <div
      ref={nodeRef}
      className={`fp-chair${isSelected ? ' fp-chair--selected' : ''}`}
      style={{
        position: 'absolute',
        left:  chair.x - CHAIR_R,
        top:   chair.y - CHAIR_R,
        width: CHAIR_R * 2,
        height: CHAIR_R * 2,
        borderRadius: '50%',
        background: color,
        border: isSelected ? '2.5px solid #fff' : '2px solid rgba(0,0,0,0.25)',
        cursor: 'grab',
        zIndex: 20,
        touchAction: 'none',
        boxSizing: 'border-box',
        boxShadow: isSelected ? `0 0 0 2px var(--color-primary)` : '1px 1px 3px rgba(0,0,0,0.2)',
      }}
      onPointerDown={(e) => onPointerDown(e, chair.id)}
      onClick={(e) => { e.stopPropagation(); onClick(chair.id) }}
    />
  )
}

// ── TableNode ──────────────────────────────────────────────────────────────

interface TableNodeProps {
  table: DiningTable
  isSelected: boolean
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void
  onClick: (id: string) => void
  nodeRef?: (node: HTMLDivElement | null) => void
}

function TableNode({ table, isSelected, onPointerDown, onClick, nodeRef }: TableNodeProps): React.ReactElement {
  const x = table.x ?? 0
  const y = table.y ?? 0
  const w = table.w ?? DEFAULT_W
  const h = table.h ?? DEFAULT_H
  const shape = table.shape ?? 'rect'
  const rotation = table.rotation ?? 0
  const borderRadius = shape === 'circle' ? '50%' : '6px'

  return (
    <div
      ref={nodeRef}
      className={`fp-table${isSelected ? ' fp-table--selected' : ''}`}
      style={{
        position: 'absolute',
        left: x,
        top:  y,
        width: w,
        height: h,
        cursor: 'grab',
        userSelect: 'none',
        touchAction: 'none',
        zIndex: isSelected ? 10 : 2,
        borderRadius,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
      }}
      onPointerDown={(e) => onPointerDown(e, table.id)}
      onClick={(e) => { e.stopPropagation(); onClick(table.id) }}
    >
      <span className="fp-table__label">{table.nameAr}</span>
    </div>
  )
}

// ── AddTableModal ──────────────────────────────────────────────────────────

interface AddTableModalProps {
  floorId: string
  dropX?: number
  dropY?: number
  onSave: (t: DiningTable, chairs: FreeChair[]) => void
  onClose: () => void
}

function AddTableModal({ floorId, dropX, dropY, onSave, onClose }: AddTableModalProps): React.ReactElement {
  const [nameAr, setNameAr] = useState('')
  const [shape, setShape]   = useState<TableShape>('rect')
  const [seats, setSeats]   = useState(4)
  const [w, setW]           = useState(DEFAULT_W)
  const [h, setH]           = useState(DEFAULT_H)
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    if (!nameAr.trim()) return
    setSaving(true)
    const tx = snap(dropX ?? 120)
    const ty = snap(dropY ?? 120)
    const t  = await saveDiningTable({
      nameAr: nameAr.trim(), floorId,
      x: tx, y: ty, w, h, shape,
      seats, active: true, sortOrder: Date.now()
    })
    const chairs = defaultChairPositions(tx, ty, w, h, seats, shape).map((c) => ({
      ...c, tableId: t.id
    }))
    onSave(t, chairs)
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">إضافة ترابيزة</h2>
          <button type="button" className="order-details__close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-form-grid mb-12">
          <label className="field settings-form-grid__full">
            <span>اسم الترابيزة</span>
            <input autoFocus value={nameAr} onChange={(e) => setNameAr(e.target.value)}
              placeholder="1 أو VIP أو…"
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }} />
          </label>
          <label className="field">
            <span>الشكل</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button"
                className={`btn btn--sm ${shape === 'rect' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setShape('rect')}>
                ▭ مربع
              </button>
              <button type="button"
                className={`btn btn--sm ${shape === 'circle' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setShape('circle')}>
                ● دائري
              </button>
            </div>
          </label>
          <label className="field">
            <span>عدد الكراسي</span>
            <input type="number" min={0} max={20} value={seats}
              onChange={(e) => setSeats(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>العرض</span>
            <input type="number" min={40} max={300} step={20} value={w}
              onChange={(e) => setW(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>الارتفاع</span>
            <input type="number" min={40} max={300} step={20} value={h}
              onChange={(e) => setH(Number(e.target.value))} />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn--primary"
            disabled={saving || !nameAr.trim()} onClick={() => void handleSave()}>
            <MdAdd /> إضافة
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}

// ── EditTableModal ─────────────────────────────────────────────────────────

interface EditTableModalProps {
  table: DiningTable
  onSave: (t: DiningTable) => void
  onClose: () => void
}

function EditTableModal({ table, onSave, onClose }: EditTableModalProps): React.ReactElement {
  const [nameAr, setNameAr]   = useState(table.nameAr)
  const [w, setW]             = useState(table.w ?? DEFAULT_W)
  const [h, setH]             = useState(table.h ?? DEFAULT_H)
  const [rotation, setRot]    = useState(table.rotation ?? 0)
  const [saving, setSaving]   = useState(false)

  async function handleSave(): Promise<void> {
    if (!nameAr.trim()) return
    setSaving(true)
    const updated = await saveDiningTable({ ...table, nameAr, w, h, rotation })
    onSave(updated)
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="order-details__header">
          <h2 className="order-details__title">تعديل الترابيزة</h2>
          <button type="button" className="order-details__close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-form-grid mb-12">
          <label className="field settings-form-grid__full">
            <span>الاسم</span>
            <input autoFocus value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </label>
          <label className="field">
            <span>العرض</span>
            <input type="number" min={40} max={300} step={20} value={w}
              onChange={(e) => setW(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>الارتفاع</span>
            <input type="number" min={40} max={300} step={20} value={h}
              onChange={(e) => setH(Number(e.target.value))} />
          </label>
          <label className="field settings-form-grid__full">
            <span>الدوران</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[0, 45, 90, 135, 180, 270].map((deg) => (
                <button key={deg} type="button"
                  className={`btn btn--sm ${rotation === deg ? 'btn--primary' : 'btn--secondary'}`}
                  style={{ minHeight: 30, padding: '0 8px' }}
                  onClick={() => setRot(deg)}>{deg}°</button>
              ))}
            </div>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn--primary"
            disabled={saving || !nameAr.trim()} onClick={() => void handleSave()}>
            <MdCheck /> حفظ
          </button>
          <button type="button" className="btn btn--secondary" onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}

// ── Colour palette for tables ──────────────────────────────────────────────

const TABLE_COLORS = [
  '#1a7a4a', '#0e7490', '#7c3aed', '#b8430a',
  '#1d4ed8', '#be185d', '#374151', '#b91c1c'
]

function tableColor(tableId: string, tables: DiningTable[]): string {
  const idx = tables.findIndex((t) => t.id === tableId)
  return TABLE_COLORS[idx % TABLE_COLORS.length] ?? TABLE_COLORS[0]!
}

// ── FloorPlanPage ──────────────────────────────────────────────────────────

export function FloorPlanPage(): React.ReactElement {
  const [floors, setFloors]         = useState<Floor[]>([])
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null)
  const [tables, setTables]         = useState<DiningTable[]>([])
  const [chairs, setChairs]         = useState<FreeChair[]>([])
  const [walls, setWalls]           = useState<WallSegment[]>([])

  // selection
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([])
  const [selectedChairIds, setSelectedChairIds] = useState<string[]>([])
  const [selectedWallIds, setSelectedWallIds]   = useState<string[]>([])
  const [selectionBox, setSelectionBox]         = useState<MarqueeRect | null>(null)

  // UI
  const [tool, setTool]             = useState<ToolMode>('select')
  const [showGrid, setShowGrid]     = useState(true)
  const [zoom, setZoom]             = useState(1)
  const [msg, setMsg]               = useState<string | null>(null)
  const [savingAll, setSavingAll]   = useState(false)
  const [showAddTable, setShowAddTable] = useState(false)
  const [dropPos, setDropPos]       = useState<{ x: number; y: number } | null>(null)
  const [editingTable, setEditingTable] = useState<DiningTable | null>(null)

  // floor form
  const [floorFormOpen, setFloorFormOpen] = useState(false)
  const [floorName, setFloorName]         = useState('')
  const [editingFloor, setEditingFloor]   = useState<Floor | null>(null)

  // ── Drag refs — no state, zero re-renders during drag ──────────────────
  type DragState = { kind: 'selection' } | { kind: 'chair'; id: string }
  const dragging    = useRef<DragState | null>(null)
  const dragStartPoint = useRef({ x: 0, y: 0 })
  const dragOffset  = useRef({ x: 0, y: 0 })
  const selectionDragRef = useRef<SelectionDragSnapshot | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)
  const canvasRef   = useRef<HTMLDivElement>(null)
  const tableNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const chairNodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  /** True once the pointer has moved >4px during a drag — used to distinguish click vs drag */
  const dragMoved   = useRef(false)

  // ── Wall drawing refs ──────────────────────────────────────────────────
  const [drawingWall, setDrawingWall] = useState<WallSegment | null>(null)
  const wallStartRef  = useRef<{ x: number; y: number } | null>(null)
  const drawingWallRef = useRef<WallSegment | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const fl = await listFloors(true)
    setFloors(fl)
    if (fl.length > 0) setActiveFloorId((p) => p ?? fl[0]!.id)
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!activeFloorId) return
    void listDiningTables(true).then((all) => {
      const floorTables = all.filter((t) => t.floorId === activeFloorId)
      setTables(floorTables)
      // Hydrate chairs from stored chairPositions
      const allChairs: FreeChair[] = []
      for (const t of floorTables) {
        if (t.chairPositions && t.chairPositions.length > 0) {
          for (const cp of t.chairPositions) {
            allChairs.push({ id: cp.id, tableId: t.id, x: cp.x, y: cp.y })
          }
        } else if ((t.seats ?? 0) > 0) {
          // Legacy: generate default positions
          const positions = defaultChairPositions(
            t.x ?? 0, t.y ?? 0, t.w ?? DEFAULT_W, t.h ?? DEFAULT_H,
            t.seats ?? 4, t.shape ?? 'rect'
          )
          for (const p of positions) allChairs.push({ id: p.id, tableId: t.id, x: p.x, y: p.y })
        }
      }
      setChairs(allChairs)
    })
    // Load walls from floor
    const fl = floors.find((f) => f.id === activeFloorId)
    setWalls(fl?.walls ?? [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloorId])

  // Sync walls when floors update
  useEffect(() => {
    const fl = floors.find((f) => f.id === activeFloorId)
    if (fl) setWalls(fl.walls ?? [])
  }, [floors, activeFloorId])

  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null

  const clearSelection = useCallback((): void => {
    setSelectedTableIds([])
    setSelectedChairIds([])
    setSelectedWallIds([])
  }, [])

  const setSelection = useCallback((tableIds: string[], chairIds: string[], wallIds: string[]): void => {
    setSelectedTableIds(Array.from(new Set(tableIds)))
    setSelectedChairIds(Array.from(new Set(chairIds)))
    setSelectedWallIds(Array.from(new Set(wallIds)))
  }, [])

  const selectedTableId =
    selectedTableIds.length === 1 && selectedChairIds.length === 0 && selectedWallIds.length === 0
      ? selectedTableIds[0] ?? null
      : null
  const selectedChairId =
    selectedChairIds.length === 1 && selectedTableIds.length === 0 && selectedWallIds.length === 0
      ? selectedChairIds[0] ?? null
      : null
  const selectedWallId =
    selectedWallIds.length === 1 && selectedTableIds.length === 0 && selectedChairIds.length === 0
      ? selectedWallIds[0] ?? null
      : null
  const totalSelected = selectedTableIds.length + selectedChairIds.length + selectedWallIds.length

  useEffect(() => {
    clearSelection()
    setSelectionBox(null)
    marqueeStartRef.current = null
    dragging.current = null
    selectionDragRef.current = null
    dragNodeRef.current = null
  }, [activeFloorId, clearSelection])

  // ── Flash message ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3000)
    return () => clearTimeout(t)
  }, [msg])

  // ── Keyboard shortcuts: Delete, Ctrl+/-, Ctrl+0 ───────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Don't intercept when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // ── Ctrl + zoom ─────────────────────────────────────────────────────
      if (e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(1)))
          return
        }
        if (e.key === '-') {
          e.preventDefault()
          setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(1)))
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          setZoom(1)
          return
        }
      }

      // ── Delete / Backspace ───────────────────────────────────────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (totalSelected > 0) {
          void handleDeleteSelection()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSelected, selectedTableIds, selectedChairIds, selectedWallIds, activeFloor, walls, tables, chairs])

  // ── Canvas coord helper ────────────────────────────────────────────────
  function canvasCoord(clientX: number, clientY: number): { x: number; y: number } {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom }
  }

  function buildSelectionDragSnapshot(tableIds: string[], chairIds: string[], wallIds: string[]): SelectionDragSnapshot {
    const tableIdSet = new Set(tableIds)
    const chairIdSet = new Set(chairIds)
    const wallIdSet = new Set(wallIds)

    const selectedTables = tables
      .filter((t) => tableIdSet.has(t.id))
      .map((t) => ({
        id: t.id,
        x: t.x ?? 0,
        y: t.y ?? 0,
        w: t.w ?? DEFAULT_W,
        h: t.h ?? DEFAULT_H,
      }))

    const selectedChairs = chairs
      .filter((c) => (tableIdSet.has(c.tableId) || chairIdSet.has(c.id)))
      .map((c) => ({ id: c.id, tableId: c.tableId, x: c.x, y: c.y }))

    const selectedWalls = walls
      .filter((w) => wallIdSet.has(w.id))
      .map((w) => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 }))

    return {
      tables: selectedTables,
      chairs: selectedChairs,
      walls: selectedWalls,
    }
  }

  function clampSelectionDelta(dx: number, dy: number, snapshot: SelectionDragSnapshot): { dx: number; dy: number } {
    if (!activeFloor || snapshot.tables.length === 0) return { dx, dy }

    let minDx = -Infinity
    let maxDx = Infinity
    let minDy = -Infinity
    let maxDy = Infinity

    for (const table of snapshot.tables) {
      minDx = Math.max(minDx, -table.x)
      maxDx = Math.min(maxDx, activeFloor.width - (table.x + table.w))
      minDy = Math.max(minDy, -table.y)
      maxDy = Math.min(maxDy, activeFloor.height - (table.y + table.h))
    }

    return {
      dx: Math.max(minDx, Math.min(dx, maxDx)),
      dy: Math.max(minDy, Math.min(dy, maxDy)),
    }
  }

  function applySelectionPreview(snapshot: SelectionDragSnapshot, dx: number, dy: number): void {
    for (const table of snapshot.tables) {
      const node = tableNodeRefs.current[table.id]
      if (!node) continue
      node.style.left = `${table.x + dx}px`
      node.style.top = `${table.y + dy}px`
      node.style.zIndex = '100'
      node.style.cursor = 'grabbing'
    }

    for (const chair of snapshot.chairs) {
      const node = chairNodeRefs.current[chair.id]
      if (!node) continue
      node.style.left = `${chair.x + dx - CHAIR_R}px`
      node.style.top = `${chair.y + dy - CHAIR_R}px`
      node.style.zIndex = '200'
      node.style.cursor = 'grabbing'
    }

    if (snapshot.walls.length > 0) {
      const wallIdSet = new Set(snapshot.walls.map((w) => w.id))
      const wallOrigin = new Map(snapshot.walls.map((w) => [w.id, w]))
      setWalls((prev) => prev.map((wall) => {
        if (!wallIdSet.has(wall.id)) return wall
        const original = wallOrigin.get(wall.id)
        return original
          ? { ...wall, x1: original.x1 + dx, y1: original.y1 + dy, x2: original.x2 + dx, y2: original.y2 + dy }
          : wall
      }))
    }
  }

  function resetSelectionPreview(snapshot: SelectionDragSnapshot): void {
    for (const table of snapshot.tables) {
      const node = tableNodeRefs.current[table.id]
      if (!node) continue
      node.style.zIndex = selectedTableIds.includes(table.id) ? '10' : '2'
      node.style.cursor = 'grab'
    }

    for (const chair of snapshot.chairs) {
      const node = chairNodeRefs.current[chair.id]
      if (!node) continue
      node.style.zIndex = '20'
      node.style.cursor = 'grab'
    }
  }

  function startSelectionDrag(pointerX: number, pointerY: number, tableIds: string[], chairIds: string[], wallIds: string[]): void {
    const snapshot = buildSelectionDragSnapshot(tableIds, chairIds, wallIds)
    if (snapshot.tables.length === 0 && snapshot.chairs.length === 0 && snapshot.walls.length === 0) return
    dragStartPoint.current = { x: pointerX, y: pointerY }
    selectionDragRef.current = snapshot
    dragging.current = { kind: 'selection' }
    dragMoved.current = false
    applySelectionPreview(snapshot, 0, 0)
  }

  // ── Table drag ─────────────────────────────────────────────────────────
  function handleTablePointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string): void {
    if (tool !== 'select' || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)

    const table = tables.find((t) => t.id === id)
    if (!table) return

    const isInSelection = selectedTableIds.includes(id)
    const nextTableIds = isInSelection ? selectedTableIds : [id]
    const nextChairIds = isInSelection ? selectedChairIds : []
    const nextWallIds = isInSelection ? selectedWallIds : []

    if (!isInSelection) setSelection(nextTableIds, nextChairIds, nextWallIds)

    const { x: cx, y: cy } = canvasCoord(e.clientX, e.clientY)
    startSelectionDrag(cx, cy, nextTableIds, nextChairIds, nextWallIds)
  }

  // ── Chair drag ─────────────────────────────────────────────────────────
  function handleChairPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string): void {
    if (tool !== 'select' || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)

    const chair = chairs.find((c) => c.id === id)
    if (!chair) return

    const isInSelection = selectedChairIds.includes(id)
    const nextTableIds = isInSelection ? selectedTableIds : []
    const nextChairIds = isInSelection ? selectedChairIds : [id]
    const nextWallIds = isInSelection ? selectedWallIds : []

    if (!isInSelection) setSelection(nextTableIds, nextChairIds, nextWallIds)

    const { x: cx, y: cy } = canvasCoord(e.clientX, e.clientY)
    const selectionCount = nextTableIds.length + nextChairIds.length + nextWallIds.length
    if (selectionCount === 1) {
      dragOffset.current = { x: cx - chair.x, y: cy - chair.y }
      dragging.current = { kind: 'chair', id }
      dragMoved.current = false
      dragNodeRef.current = e.currentTarget
      dragNodeRef.current.style.zIndex = '200'
      dragNodeRef.current.style.cursor = 'grabbing'
      return
    }

    startSelectionDrag(cx, cy, nextTableIds, nextChairIds, nextWallIds)
  }

  // ── Wall drag ──────────────────────────────────────────────────────────
  function handleWallPointerDown(e: React.PointerEvent<SVGLineElement>, id: string): void {
    if (tool !== 'select' || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)

    const isInSelection = selectedWallIds.includes(id)
    const nextTableIds = isInSelection ? selectedTableIds : []
    const nextChairIds = isInSelection ? selectedChairIds : []
    const nextWallIds = isInSelection ? selectedWallIds : [id]

    if (!isInSelection) setSelection(nextTableIds, nextChairIds, nextWallIds)

    const { x: cx, y: cy } = canvasCoord(e.clientX, e.clientY)
    startSelectionDrag(cx, cy, nextTableIds, nextChairIds, nextWallIds)
  }
  function handleCanvasPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const { x: cx, y: cy } = canvasCoord(e.clientX, e.clientY)

    // Wall drawing
    if (tool === 'draw_wall' && wallStartRef.current) {
      const nx = snap(cx), ny = snap(cy)
      const next: WallSegment = {
        id: drawingWallRef.current?.id ?? uid(),
        x1: wallStartRef.current.x, y1: wallStartRef.current.y,
        x2: nx, y2: ny,
        thickness: WALL_W, color: WALL_COLOR
      }
      drawingWallRef.current = next
      setDrawingWall(next)
      return
    }

    if (marqueeStartRef.current) {
      e.preventDefault()
      const rect = normalizeRect(marqueeStartRef.current.x, marqueeStartRef.current.y, cx, cy)
      setSelectionBox(rect)
      dragMoved.current = rect.right - rect.left > 4 || rect.bottom - rect.top > 4
      return
    }

    if (!dragging.current) return
    e.preventDefault()

    if (dragging.current.kind === 'selection') {
      const snapshot = selectionDragRef.current
      if (!snapshot) return
      let dx = snap(cx - dragStartPoint.current.x)
      let dy = snap(cy - dragStartPoint.current.y)
      const clamped = clampSelectionDelta(dx, dy, snapshot)
      dx = clamped.dx
      dy = clamped.dy
      dragMoved.current = dragMoved.current || dx !== 0 || dy !== 0
      applySelectionPreview(snapshot, dx, dy)
      return
    }

    if (dragging.current.kind === 'chair') {
      if (!dragNodeRef.current) return
      const chairId = dragging.current.id
      const chair   = chairs.find((c) => c.id === chairId)
      const table   = chair ? tables.find((t) => t.id === chair.tableId) : null

      let rawX = cx - dragOffset.current.x
      let rawY = cy - dragOffset.current.y

      if (table) {
        const tcx = (table.x ?? 0) + (table.w ?? DEFAULT_W) / 2
        const tcy = (table.y ?? 0) + (table.h ?? DEFAULT_H) / 2
        const orbitR = Math.max(table.w ?? DEFAULT_W, table.h ?? DEFAULT_H) / 2 + MAX_ORBIT_R
        const clamped = clampToOrbit(rawX, rawY, tcx, tcy, orbitR)
        rawX = clamped.x
        rawY = clamped.y
      }

      dragNodeRef.current.style.left = `${rawX - CHAIR_R}px`
      dragNodeRef.current.style.top  = `${rawY - CHAIR_R}px`
      dragMoved.current = true
    }
  }

  // ── Canvas pointer up ──────────────────────────────────────────────────
  function handleCanvasPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const { x: cx, y: cy } = canvasCoord(e.clientX, e.clientY)

    // Finish wall drawing
    if (tool === 'draw_wall' && wallStartRef.current) {
      const nx = snap(cx), ny = snap(cy)
      const dx = nx - wallStartRef.current.x
      const dy = ny - wallStartRef.current.y
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        const newWall: WallSegment = {
          id: drawingWallRef.current?.id ?? uid(),
          x1: wallStartRef.current.x, y1: wallStartRef.current.y,
          x2: nx, y2: ny,
          thickness: WALL_W, color: WALL_COLOR
        }
        const nextWalls = [...walls, newWall]
        setWalls(nextWalls)
        // Persist walls into floor
        if (activeFloor) void saveFloor({ ...activeFloor, walls: nextWalls })
      }
      wallStartRef.current = null
      drawingWallRef.current = null
      setDrawingWall(null)
      return
    }

    if (marqueeStartRef.current) {
      const rect = normalizeRect(marqueeStartRef.current.x, marqueeStartRef.current.y, cx, cy)
      marqueeStartRef.current = null
      setSelectionBox(null)

      if (rect.right - rect.left <= 4 && rect.bottom - rect.top <= 4) {
        clearSelection()
        dragMoved.current = false
        return
      }

      const nextTableIds = tables
        .filter((t) => rectsIntersect(rect, normalizeRect(
          t.x ?? 0,
          t.y ?? 0,
          (t.x ?? 0) + (t.w ?? DEFAULT_W),
          (t.y ?? 0) + (t.h ?? DEFAULT_H),
        )))
        .map((t) => t.id)

      const nextChairIds = chairs
        .filter((c) => rectsIntersect(rect, normalizeRect(
          c.x - CHAIR_R,
          c.y - CHAIR_R,
          c.x + CHAIR_R,
          c.y + CHAIR_R,
        )))
        .map((c) => c.id)

      const nextWallIds = walls.filter((w) => wallIntersectsRect(w, rect)).map((w) => w.id)
      setSelection(nextTableIds, nextChairIds, nextWallIds)
      dragMoved.current = false
      return
    }

    if (!dragging.current) return

    if (dragging.current.kind === 'selection') {
      const snapshot = selectionDragRef.current
      if (!snapshot) {
        dragging.current = null
        dragMoved.current = false
        return
      }

      let dx = snap(cx - dragStartPoint.current.x)
      let dy = snap(cy - dragStartPoint.current.y)
      const clamped = clampSelectionDelta(dx, dy, snapshot)
      dx = clamped.dx
      dy = clamped.dy

      const movedTableIds = new Set(snapshot.tables.map((t) => t.id))
      const movedChairIds = new Set(snapshot.chairs.map((c) => c.id))
      const movedWallIds = new Set(snapshot.walls.map((w) => w.id))

      const nextTables = tables.map((table) =>
        movedTableIds.has(table.id)
          ? { ...table, x: (table.x ?? 0) + dx, y: (table.y ?? 0) + dy }
          : table
      )

      const nextTableMap = new Map(nextTables.map((table) => [table.id, table]))
      const nextChairs = chairs.map((chair) => {
        if (!movedChairIds.has(chair.id)) return chair

        let nextX = chair.x + dx
        let nextY = chair.y + dy
        const ownerTable = nextTableMap.get(chair.tableId)
        if (ownerTable && !movedTableIds.has(chair.tableId)) {
          const tcx = (ownerTable.x ?? 0) + (ownerTable.w ?? DEFAULT_W) / 2
          const tcy = (ownerTable.y ?? 0) + (ownerTable.h ?? DEFAULT_H) / 2
          const orbitR = Math.max(ownerTable.w ?? DEFAULT_W, ownerTable.h ?? DEFAULT_H) / 2 + MAX_ORBIT_R
          const clampedChair = clampToOrbit(nextX, nextY, tcx, tcy, orbitR)
          nextX = clampedChair.x
          nextY = clampedChair.y
        }
        return { ...chair, x: nextX, y: nextY }
      })

      let nextWalls = walls
      if (movedWallIds.size > 0) {
        const wallOrigin = new Map(snapshot.walls.map((wall) => [wall.id, wall]))
        nextWalls = walls.map((wall) => {
          if (!movedWallIds.has(wall.id)) return wall
          const original = wallOrigin.get(wall.id)
          return original
            ? { ...wall, x1: original.x1 + dx, y1: original.y1 + dy, x2: original.x2 + dx, y2: original.y2 + dy }
            : wall
        })
      }

      setTables(nextTables)
      setChairs(nextChairs)
      if (movedWallIds.size > 0) {
        setWalls(nextWalls)
        if (activeFloor) void saveFloor({ ...activeFloor, walls: nextWalls })
      }

      resetSelectionPreview(snapshot)
      selectionDragRef.current = null
      dragging.current = null
      dragMoved.current = false
      return
    }

    if (!dragNodeRef.current) return

    if (dragging.current.kind === 'chair') {
      // Chair — clamp to orbit, optionally reassign to nearest table
      const chairId = dragging.current.id
      const chair   = chairs.find((c) => c.id === chairId)
      if (chair) {
        let rawX = snap(cx - dragOffset.current.x)
        let rawY = snap(cy - dragOffset.current.y)

        // If the user actually dragged (not just clicked), find closest table
        let newTableId = chair.tableId
        if (dragMoved.current) {
          let closest: DiningTable | null = null
          let closestDist = Infinity
          for (const t of tables) {
            const tcx = (t.x ?? 0) + (t.w ?? DEFAULT_W) / 2
            const tcy = (t.y ?? 0) + (t.h ?? DEFAULT_H) / 2
            const dist = Math.hypot(rawX - tcx, rawY - tcy)
            if (dist < closestDist) { closestDist = dist; closest = t }
          }
          if (closest && closestDist < SNAP_ASSIGN + (closest.w ?? DEFAULT_W) / 2) {
            newTableId = closest.id
          }
        }

        // Clamp to orbit of the (possibly new) table
        const ownerTable = tables.find((t) => t.id === newTableId)
        if (ownerTable) {
          const tcx = (ownerTable.x ?? 0) + (ownerTable.w ?? DEFAULT_W) / 2
          const tcy = (ownerTable.y ?? 0) + (ownerTable.h ?? DEFAULT_H) / 2
          const orbitR = Math.max(ownerTable.w ?? DEFAULT_W, ownerTable.h ?? DEFAULT_H) / 2 + MAX_ORBIT_R
          const clamped = clampToOrbit(rawX, rawY, tcx, tcy, orbitR)
          rawX = clamped.x
          rawY = clamped.y
        }

        setChairs((prev) => prev.map((c) =>
          c.id === chairId ? { ...c, x: rawX, y: rawY, tableId: newTableId } : c
        ))
      }
    }

    dragNodeRef.current.style.zIndex = '20'
    dragNodeRef.current.style.cursor = 'grab'
    dragging.current  = null
    dragNodeRef.current = null
    dragMoved.current = false
  }

  // ── Canvas pointer down (for wall drawing) ─────────────────────────────
  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if ((e.target as HTMLElement) !== canvasRef.current) return

    if (tool === 'draw_wall') {
      e.preventDefault()
      const { x, y } = canvasCoord(e.clientX, e.clientY)
      wallStartRef.current = { x: snap(x), y: snap(y) }
      return
    }

    if (tool !== 'select' || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = canvasCoord(e.clientX, e.clientY)
    marqueeStartRef.current = { x, y }
    setSelectionBox(normalizeRect(x, y, x, y))
    dragMoved.current = false
  }

  // ── Canvas double-click to add table ───────────────────────────────────
  function handleCanvasDblClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (tool !== 'select' || !activeFloorId) return
    if ((e.target as HTMLElement).closest('.fp-table, .fp-chair')) return
    const { x, y } = canvasCoord(e.clientX, e.clientY)
    setDropPos({ x: snap(x), y: snap(y) })
    setShowAddTable(true)
  }

  // ── Shape toggle ───────────────────────────────────────────────────────
  async function toggleShape(shape: TableShape): Promise<void> {
    if (!selectedTableId) return
    const table = tables.find((t) => t.id === selectedTableId)
    if (!table) return
    const updated = await saveDiningTable({ ...table, shape })
    setTables((prev) => prev.map((t) => t.id === selectedTableId ? updated : t))
    // Re-layout chairs for new shape
    const count = chairsForTable(selectedTableId, chairs).length
    if (count > 0) {
      const newPositions = defaultChairPositions(
        updated.x ?? 0, updated.y ?? 0, updated.w ?? DEFAULT_W, updated.h ?? DEFAULT_H,
        count, shape
      )
      setChairs((prev) => {
        const others = prev.filter((c) => c.tableId !== selectedTableId)
        const updated2 = newPositions.map((p, i) => {
          const existing = prev.filter((c) => c.tableId === selectedTableId)[i]
          return { id: existing?.id ?? uid(), tableId: selectedTableId, x: p.x, y: p.y }
        })
        return [...others, ...updated2]
      })
    }
  }

  // ── Rotate selected table ──────────────────────────────────────────────
  async function handleRotate(): Promise<void> {
    if (!selectedTableId) return
    const table = tables.find((t) => t.id === selectedTableId)
    if (!table) return
    const newRot = ((table.rotation ?? 0) + 90) % 360
    const updated = await saveDiningTable({ ...table, rotation: newRot })
    setTables((prev) => prev.map((t) => t.id === selectedTableId ? updated : t))
  }

  // ── Add chair to selected table ────────────────────────────────────────
  function handleAddChair(): void {
    if (!selectedTableId) return
    const table = tables.find((t) => t.id === selectedTableId)
    if (!table) return
    const current = chairsForTable(selectedTableId, chairs)
    const count   = current.length + 1
    const all = defaultChairPositions(
      table.x ?? 0, table.y ?? 0, table.w ?? DEFAULT_W, table.h ?? DEFAULT_H,
      count, table.shape ?? 'rect'
    )
    // Keep existing chair ids, add one new
    const newChair: FreeChair = { id: uid(), tableId: selectedTableId, x: all[count - 1]!.x, y: all[count - 1]!.y }
    setChairs((prev) => [...prev, newChair])
  }

  async function handleDeleteSelection(): Promise<void> {
    if (totalSelected === 0) return

    const tableIds = [...selectedTableIds]
    const chairIds = [...selectedChairIds]
    const wallIds = [...selectedWallIds]
    const tableIdSet = new Set(tableIds)
    const chairIdSet = new Set(chairIds)
    const wallIdSet = new Set(wallIds)

    if (tableIds.length > 0) {
      await Promise.all(tableIds.map((tableId) => deleteDiningTable(tableId)))
    }

    if (wallIds.length > 0 && activeFloor) {
      const nextWalls = walls.filter((wall) => !wallIdSet.has(wall.id))
      setWalls(nextWalls)
      await saveFloor({ ...activeFloor, walls: nextWalls })
    }

    setTables((prev) => prev.filter((table) => !tableIdSet.has(table.id)))
    setChairs((prev) => prev.filter((chair) => !tableIdSet.has(chair.tableId) && !chairIdSet.has(chair.id)))
    clearSelection()
  }

  // ── Save all ───────────────────────────────────────────────────────────
  async function handleSaveAll(): Promise<void> {
    setSavingAll(true)
    try {
      // Persist chair positions back into each table's chairPositions field
      const updated = tables.map((t) => {
        const myChairs = chairs.filter((c) => c.tableId === t.id)
        return {
          ...t,
          seats: myChairs.length,
          chairPositions: myChairs.map((c) => ({ id: c.id, x: c.x, y: c.y }))
        }
      })
      await saveTablesBatch(updated)
      setTables(updated)
      setMsg('تم الحفظ ✓')
    } catch { setMsg('فشل الحفظ') }
    finally { setSavingAll(false) }
  }

  // ── Floor management ───────────────────────────────────────────────────
  async function handleSaveFloor(): Promise<void> {
    if (!floorName.trim()) return
    const floor = await saveFloor(
      editingFloor
        ? { ...editingFloor, nameAr: floorName }
        : { nameAr: floorName }
    )
    setFloorFormOpen(false); setFloorName(''); setEditingFloor(null)
    await load()
    setActiveFloorId(floor.id)
  }

  async function handleDeleteFloor(floorId: string): Promise<void> {
    await deleteFloor(floorId)
    await load()
    setActiveFloorId((p) => p === floorId ? null : p)
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null
  const selectedChairCount = selectedTableId ? chairsForTable(selectedTableId, chairs).length : 0
  const selectionLabel = totalSelected <= 1
    ? null
    : [
        selectedTableIds.length > 0 ? `${selectedTableIds.length} ترابيزة` : null,
        selectedChairIds.length > 0 ? `${selectedChairIds.length} كرسي` : null,
        selectedWallIds.length > 0 ? `${selectedWallIds.length} جدار` : null,
      ].filter(Boolean).join(' + ')

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="fp-page">

      {/* ── Toolbar ── */}
      <div className="fp-toolbar">
        <div className="fp-toolbar__left">
          {floors.map((fl) => (
            <button key={fl.id} type="button"
              className={`fp-floor-tab${activeFloorId === fl.id ? ' fp-floor-tab--active' : ''}`}
              onClick={() => { setActiveFloorId(fl.id); clearSelection() }}>
              {fl.nameAr}
            </button>
          ))}
          <button type="button" className="fp-floor-tab fp-floor-tab--add"
            onClick={() => { setFloorFormOpen(true); setEditingFloor(null); setFloorName('') }}
            title="إضافة منطقة"><MdAdd /></button>
        </div>

        <div className="fp-toolbar__right">
          {/* Tool mode */}
          <button type="button"
            className={`btn btn--sm ${tool === 'select' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setTool('select')} title="أداة التحديد">
            ↖ تحديد
          </button>
          <button type="button"
            className={`btn btn--sm ${tool === 'draw_wall' ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setTool('draw_wall')} title="رسم جدار / خط">
            <MdDraw /> جدار
          </button>

          <div className="fp-toolbar__divider" />

          {/* Grid + Zoom */}
          <button type="button"
            className={`btn btn--sm ${showGrid ? 'btn--primary' : 'btn--secondary'}`}
            onClick={() => setShowGrid((v) => !v)} title="شبكة">
            {showGrid ? <MdGridOn /> : <MdGridOff />}
          </button>
          <button type="button" className="btn btn--secondary btn--sm"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(1)))}><MdZoomOut /></button>
          <span className="fp-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn btn--secondary btn--sm"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(1)))}><MdZoomIn /></button>

          {/* Selected table context actions */}
          {selectedTable && (
            <>
              <div className="fp-toolbar__divider" />
              <span className="fp-toolbar__selected-label">{selectedTable.nameAr}</span>

              {/* Shape toggle */}
              <button type="button"
                className={`btn btn--sm ${(selectedTable.shape ?? 'rect') === 'rect' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => void toggleShape('rect')} title="شكل مربع">
                ▭
              </button>
              <button type="button"
                className={`btn btn--sm ${selectedTable.shape === 'circle' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => void toggleShape('circle')} title="شكل دائري">
                ●
              </button>

              {/* Rotate */}
              <button type="button" className="btn btn--secondary btn--sm"
                onClick={() => void handleRotate()} title="تدوير 90°">
                <MdRotateRight />
              </button>

              {/* Chair controls */}
              <button type="button" className="btn btn--secondary btn--sm"
                onClick={handleAddChair} title="إضافة كرسي">
                + 🪑 ({selectedChairCount})
              </button>

              {/* Edit name/size */}
              <button type="button" className="btn btn--secondary btn--sm"
                onClick={() => setEditingTable(selectedTable)} title="تعديل">
                <MdEdit />
              </button>

              <button type="button" className="btn btn--danger btn--sm"
                onClick={() => void handleDeleteSelection()} title="حذف المحدد">
                <MdDelete />
              </button>
            </>
          )}

          {/* Selected chair delete */}
          {selectedChairId && !selectedTable && (
            <>
              <div className="fp-toolbar__divider" />
              <span className="fp-toolbar__selected-label">كرسي</span>
              <button type="button" className="btn btn--danger btn--sm"
                onClick={() => void handleDeleteSelection()} title="حذف الكرسي">
                <MdDelete />
              </button>
            </>
          )}

          {/* Selected wall delete */}
          {selectedWallId && (
            <>
              <div className="fp-toolbar__divider" />
              <span className="fp-toolbar__selected-label">جدار</span>
              <button type="button" className="btn btn--danger btn--sm"
                onClick={() => void handleDeleteSelection()} title="حذف الجدار">
                <MdDelete />
              </button>
            </>
          )}

          {/* Multi-selection actions */}
          {selectionLabel && (
            <>
              <div className="fp-toolbar__divider" />
              <span className="fp-toolbar__selected-label">{selectionLabel}</span>
              <button type="button" className="btn btn--danger btn--sm"
                onClick={() => void handleDeleteSelection()} title="حذف المحدد">
                <MdDelete />
              </button>
            </>
          )}

          <div className="fp-toolbar__divider" />

          {activeFloorId && (
            <button type="button" className="btn btn--secondary btn--sm"
              onClick={() => { setDropPos(null); setShowAddTable(true) }}>
              <MdAddCircle /> ترابيزة
            </button>
          )}

          <button type="button" className="btn btn--primary btn--sm"
            onClick={() => void handleSaveAll()} disabled={savingAll || !activeFloorId}>
            <MdSave /> {savingAll ? 'جارٍ…' : 'حفظ'}
          </button>
        </div>
      </div>

      {/* ── Message ── */}
      {msg && (
        <div className={`fp-msg ${msg.includes('فشل') ? 'fp-msg--error' : 'fp-msg--ok'}`}>{msg}</div>
      )}

      {/* ── Empty ── */}
      {floors.length === 0 && (
        <div className="fp-empty">
          <MdTableRestaurant className="fp-empty__icon" />
          <p>لا توجد مناطق بعد</p>
          <button type="button" className="btn btn--primary"
            onClick={() => { setFloorFormOpen(true); setEditingFloor(null); setFloorName('') }}>
            <MdAdd /> إضافة منطقة
          </button>
        </div>
      )}

      {/* ── Workspace ── */}
      {activeFloor && (
        <div className="fp-workspace">

          {/* Sidebar */}
          <aside className="fp-sidebar">
            <div className="fp-sidebar__section">
              <h3>المنطقة</h3>
              <p className="fp-sidebar__name">{activeFloor.nameAr}</p>
              <p className="fp-sidebar__meta">{tables.length} ترابيزة — {chairs.length} كرسي</p>
              <button type="button" className="btn btn--secondary btn--sm" style={{ width: '100%', marginTop: 8 }}
                onClick={() => { setEditingFloor(activeFloor); setFloorName(activeFloor.nameAr); setFloorFormOpen(true) }}>
                <MdEdit /> تعديل المنطقة
              </button>
              <ConfirmDeleteButton
                confirmMessage={`حذف "${activeFloor.nameAr}"؟`}
                onConfirm={() => handleDeleteFloor(activeFloor.id)}
              />
            </div>

            <div className="fp-sidebar__section">
              <h3>الترابيزات</h3>
              {tables.length === 0 && (
                <p className="fp-sidebar__empty">نقر مزدوج على اللوحة لإضافة ترابيزة</p>
              )}
              {tables.map((t) => {
                const count = chairsForTable(t.id, chairs).length
                return (
                  <button key={t.id} type="button"
                    className={`fp-table-list-item${selectedTableIds.includes(t.id) ? ' fp-table-list-item--active' : ''}`}
                    onClick={() => setSelection([t.id], [], [])}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-block', width: 10, height: 10,
                          background: tableColor(t.id, tables),
                          borderRadius: t.shape === 'circle' ? '50%' : '2px',
                          flexShrink: 0
                        }}
                      />
                      {t.nameAr}
                    </span>
                    <span className="fp-table-list-item__meta">{count} 🪑</span>
                  </button>
                )
              })}
            </div>

            <div className="fp-sidebar__section fp-sidebar__hint">
              <p>💡 نقر مزدوج لإضافة ترابيزة</p>
              <p>💡 اسحب على مساحة فارغة لتحديد عدة عناصر</p>
              <p>💡 اسحب الكرسي لترحيله لترابيزة أخرى</p>
              <p>💡 ▭ / ● لتغيير شكل الترابيزة</p>
              <p>💡 أداة الجدار: اسحب لرسم خط</p>
            </div>
          </aside>

          {/* Canvas wrapper */}
          <div className="fp-canvas-wrapper">
            <div className="fp-canvas-scroll">
              <div
                ref={canvasRef}
                className={`fp-canvas${showGrid ? ' fp-canvas--grid' : ''}${tool === 'draw_wall' ? ' fp-canvas--draw-mode' : ''}`}
                style={{
                  width:  activeFloor.width,
                  height: activeFloor.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: 'top left',
                  position: 'relative',
                  flexShrink: 0
                }}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerLeave={handleCanvasPointerUp}
                onDoubleClick={handleCanvasDblClick}
              >
                {/* Wall SVG layer */}
                <WallLayer
                  walls={walls}
                  width={activeFloor.width}
                  height={activeFloor.height}
                  selectedWallId={selectedWallId}
                  onSelectWall={(id) => setSelection([], [], id ? [id] : [])}
                  onWallClick={(id) => {
                    if (!dragMoved.current) setSelection([], [], [id])
                  }}
                  drawingWall={drawingWall}
                  onWallPointerDown={tool === 'select' ? handleWallPointerDown : undefined}
                  tool={tool}
                />

                {/* Tables */}
                {tables.map((t) => (
                  <TableNode
                    key={t.id}
                    table={{ ...t, shape: t.shape ?? 'rect' }}
                    isSelected={selectedTableIds.includes(t.id)}
                    onPointerDown={handleTablePointerDown}
                    nodeRef={(node) => { tableNodeRefs.current[t.id] = node }}
                    onClick={(id) => {
                      // Only act if this was a pure click (no drag movement)
                      if (!dragMoved.current) {
                        setSelection([id], [], [])
                      }
                    }}
                  />
                ))}

                {/* Chairs */}
                {chairs.map((c) => (
                  <ChairNode
                    key={c.id}
                    chair={c}
                    color={tableColor(c.tableId, tables)}
                    isSelected={selectedChairIds.includes(c.id)}
                    onPointerDown={handleChairPointerDown}
                    nodeRef={(node) => { chairNodeRefs.current[c.id] = node }}
                    onClick={(id) => {
                      if (!dragMoved.current) {
                        setSelection([], [id], [])
                      }
                    }}
                  />
                ))}

                {selectionBox && (
                  <div
                    className="fp-selection-box"
                    style={{
                      left: selectionBox.left,
                      top: selectionBox.top,
                      width: selectionBox.right - selectionBox.left,
                      height: selectionBox.bottom - selectionBox.top,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Floor modal ── */}
      {floorFormOpen && (
        <div className="modal-overlay" onClick={() => setFloorFormOpen(false)}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">{editingFloor ? 'تعديل المنطقة' : 'إضافة منطقة'}</h2>
              <button type="button" className="order-details__close" onClick={() => setFloorFormOpen(false)}>✕</button>
            </div>
            <label className="field">
              <span>اسم المنطقة</span>
              <input autoFocus value={floorName}
                onChange={(e) => setFloorName(e.target.value)}
                placeholder="الصالة / الحديقة / الطابق الثاني"
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveFloor() }} />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn btn--primary"
                disabled={!floorName.trim()} onClick={() => void handleSaveFloor()}>
                <MdCheck /> {editingFloor ? 'تعديل' : 'إضافة'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => setFloorFormOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add table modal ── */}
      {showAddTable && activeFloorId && (
        <AddTableModal
          floorId={activeFloorId}
          dropX={dropPos?.x}
          dropY={dropPos?.y}
          onSave={(t, newChairs) => {
            setTables((prev) => [...prev, t])
            setChairs((prev) => [...prev, ...newChairs])
            setSelection([t.id], [], [])
            setShowAddTable(false)
            setDropPos(null)
          }}
          onClose={() => { setShowAddTable(false); setDropPos(null) }}
        />
      )}

      {/* ── Edit table modal ── */}
      {editingTable && (
        <EditTableModal
          table={editingTable}
          onSave={(updated) => {
            setTables((prev) => prev.map((t) => t.id === updated.id ? updated : t))
            setEditingTable(null)
          }}
          onClose={() => setEditingTable(null)}
        />
      )}

    </div>
  )
}
