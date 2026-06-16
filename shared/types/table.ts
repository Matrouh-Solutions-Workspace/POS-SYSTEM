export type TableShape = 'rect' | 'circle'

export interface DiningTable {
  id: string
  nameAr: string
  categoryAr?: string
  sortOrder: number
  active: boolean
  /** Floor this table belongs to */
  floorId?: string
  /** Position on the floor canvas — logical pixels */
  x?: number
  y?: number
  /** Size on the canvas — logical pixels */
  w?: number
  h?: number
  /** Visual shape */
  shape?: TableShape
  /** Per-chair positions relative to canvas origin (not table) */
  chairPositions?: Array<{ id: string; x: number; y: number }>
  /** Legacy seat count — used when chairPositions is absent */
  seats?: number
  /** Rotation in degrees */
  rotation?: number
  createdAt: number
  updatedAt: number
}

/** A wall/line segment drawn on the floor canvas */
export interface WallSegment {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** stroke width in px, default 6 */
  thickness?: number
  color?: string
}

/** A floor / area of the restaurant */
export interface Floor {
  id: string
  nameAr: string
  width: number
  height: number
  bgColor?: string
  /** Wall/line segments drawn on this floor */
  walls?: WallSegment[]
  sortOrder: number
  active: boolean
  createdAt: number
  updatedAt: number
}
