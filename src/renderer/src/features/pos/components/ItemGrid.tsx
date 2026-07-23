import type { MenuItem } from '@shared/types'
import type { PendingCartSelection } from '../PosPage'

export function ItemGrid({
  items,
  unavailableItems,
  lowStockItems,
  onItemClick
}: {
  items: MenuItem[]
  unavailableItems: Map<string, string>
  lowStockItems: Set<string>
  onItemClick: (item: MenuItem, rect: DOMRect, isUnavailable: boolean, hasSizes: boolean) => void
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <div className="pos-items pos-items--empty">
        <div className="pos-items-empty">
          <strong>لا توجد أصناف</strong>
          <span>جرّب تصنيف آخر أو غيّر كلمات البحث.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pos-items">
      {items.map((item) => {
        const outReason = unavailableItems.get(item.id)
        const isUnavailable = !!outReason
        const isLow = !isUnavailable && lowStockItems.has(item.id)
        const hasSizes = !item.isWeighted && (item.sizeOptions?.length ?? 0) > 0
        const priceLabel = item.isWeighted
          ? item.allowCustomWeight
            ? `${(item.customWeightUnitPrice ?? item.price).toFixed(2)} / كجم`
            : 'أسعار محددة'
          : hasSizes
            ? 'أحجام'
            : item.price.toFixed(2)

        return (
          <div
            key={item.id}
            className={`pos-item-wrap${isUnavailable ? ' pos-item-wrap--unavailable' : ''}${isLow ? ' pos-item-wrap--low' : ''}`}
          >
            <button
              type="button"
              className="pos-item-btn"
              disabled={isUnavailable}
              onClick={(e) => {
                if (isUnavailable) return
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                onItemClick(item, rect, isUnavailable, hasSizes)
              }}
            >
              {item.imageUrl && <img className="pos-item-btn__image" src={item.imageUrl} alt="" />}
              {item.nameAr}
              <span className="pos-item-btn__price">{priceLabel}</span>
              {isLow && <span className="pos-item-badge pos-item-badge--low">قرب النفاد</span>}
            </button>
            {isUnavailable && (
              <div className="pos-item-overlay">
                <span className="pos-item-overlay__reason">نفذ: {outReason}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
