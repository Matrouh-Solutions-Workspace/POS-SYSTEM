/**
 * Dining tables + floors service — SQLite primary database.
 */
import type { DiningTable, Floor } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { generateId } from '@renderer/lib/utils/id'

// ── Floors ────────────────────────────────────────────────────────────────

export async function listFloors(includeInactive = false): Promise<Floor[]> {
  let floors = await getCachedDocs<Floor>(COLLECTIONS.floors)
  if (!includeInactive) floors = floors.filter((f) => f.active)
  return floors.sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function saveFloor(input: Partial<Floor> & Pick<Floor, 'nameAr'>): Promise<Floor> {
  const now = Date.now()
  const floor: Floor = {
    id: input.id ?? generateId(),
    nameAr: input.nameAr.trim(),
    width: input.width ?? 1200,
    height: input.height ?? 800,
    bgColor: input.bgColor,
    walls: input.walls,          // ← preserve wall segments
    sortOrder: input.sortOrder ?? 0,
    active: input.active ?? true,
    createdAt: input.createdAt ?? now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.floors, [floor])
  return floor
}

export async function deleteFloor(floorId: string): Promise<void> {
  await dbDelete(COLLECTIONS.floors, floorId)
}

// ── Tables ────────────────────────────────────────────────────────────────

export async function listDiningTables(includeInactive = false): Promise<DiningTable[]> {
  let tables = await getCachedDocs<DiningTable>(COLLECTIONS.diningTables)
  if (!includeInactive) tables = tables.filter((t) => t.active)
  return tables.sort((a, b) => a.sortOrder - b.sortOrder || a.nameAr.localeCompare(b.nameAr))
}

export async function listTablesByFloor(floorId: string): Promise<DiningTable[]> {
  const all = await getCachedDocs<DiningTable>(COLLECTIONS.diningTables)
  return all.filter((t) => t.floorId === floorId && t.active)
}

export async function saveDiningTable(
  input: Partial<DiningTable> & Pick<DiningTable, 'nameAr'>
): Promise<DiningTable> {
  const now = Date.now()
  const table: DiningTable = {
    id: input.id ?? generateId(),
    nameAr: input.nameAr.trim(),
    categoryAr: input.categoryAr?.trim() || undefined,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    active: input.active ?? true,
    floorId: input.floorId,
    x: input.x,
    y: input.y,
    w: input.w ?? 90,
    h: input.h ?? 90,
    shape: input.shape ?? 'rect',
    seats: input.seats ?? 4,
    chairPositions: input.chairPositions,   // ← preserve per-chair positions
    rotation: input.rotation ?? 0,
    createdAt: input.createdAt ?? now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.diningTables, [table])
  return table
}

/** Batch-save multiple tables in one write (used by floor plan drag saves) */
export async function saveTablesBatch(tables: DiningTable[]): Promise<void> {
  if (tables.length === 0) return
  const now = Date.now()
  await cacheDocs(COLLECTIONS.diningTables, tables.map((t) => ({ ...t, updatedAt: now })))
}

export async function setDiningTableActive(tableId: string, active: boolean): Promise<void> {
  const tables = await getCachedDocs<DiningTable>(COLLECTIONS.diningTables)
  const table = tables.find((t) => t.id === tableId)
  if (!table) return
  await cacheDocs(COLLECTIONS.diningTables, [{ ...table, active, updatedAt: Date.now() }])
}

export async function deleteDiningTable(tableId: string): Promise<void> {
  await dbDelete(COLLECTIONS.diningTables, tableId)
}
