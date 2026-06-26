/**
 * DataTable — sortable, filterable table component.
 *
 * Provides a consistent table layout with optional sorting and empty state.
 */
import { useState, useMemo, type ReactNode } from 'react'
import { EmptyState } from './EmptyState'
import { MdArrowUpward, MdArrowDownward } from 'react-icons/md'

export interface DataTableColumn<T> {
  /** Unique key for the column */
  key: string
  /** Column header label */
  header: string
  /** Render cell content */
  render: (row: T, index: number) => ReactNode
  /** Sortable comparator — return -1, 0, or 1 */
  sort?: (a: T, b: T) => number
  /** Column width (CSS value) */
  width?: string
  /** Text alignment */
  align?: 'start' | 'center' | 'end'
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[]
  /** Data rows */
  data: T[]
  /** Unique key extractor */
  rowKey: (row: T) => string
  /** Empty state message when data is empty */
  emptyTitle?: string
  /** Empty state description */
  emptyDescription?: string
  /** Extra CSS class on the table wrapper */
  className?: string
  /** Render extra content in the actions column for each row */
  rowActions?: (row: T, index: number) => ReactNode
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyTitle = 'لا توجد بيانات',
  emptyDescription,
  className,
  rowActions
}: DataTableProps<T>): React.ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const allColumns = useMemo(() => {
    if (!rowActions) return columns
    return [
      ...columns,
      {
        key: '__actions',
        header: '',
        render: (row: T, index: number) => rowActions(row, index),
        width: 'auto'
      }
    ]
  }, [columns, rowActions])

  const sortedData = useMemo(() => {
    if (!sortKey) return data
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sort) return data
    const sorted = [...data].sort(col.sort)
    return sortAsc ? sorted : sorted.reverse()
  }, [data, sortKey, sortAsc, columns])

  function handleSort(key: string): void {
    if (sortKey === key) {
      setSortAsc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  if (data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className={`ui-data-table__wrap${className ? ` ${className}` : ''}`}>
      <table className="ui-data-table">
        <thead>
          <tr>
            {allColumns.map((col) => (
              <th
                key={col.key}
                className={col.sort ? 'ui-data-table__th--sortable' : undefined}
                style={{
                  width: col.width,
                  textAlign: col.align ?? 'start'
                }}
                onClick={col.sort ? () => handleSort(col.key) : undefined}
              >
                <span className="ui-data-table__th-content">
                  {col.header}
                  {col.sort && sortKey === col.key && (
                    sortAsc
                      ? <MdArrowUpward className="ui-data-table__sort-icon" />
                      : <MdArrowDownward className="ui-data-table__sort-icon" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => (
            <tr key={rowKey(row)}>
              {allColumns.map((col) => (
                <td
                  key={col.key}
                  style={{ textAlign: col.align ?? 'start' }}
                >
                  {col.render(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
