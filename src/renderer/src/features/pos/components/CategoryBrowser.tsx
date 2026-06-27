import type { MenuCategory, MenuItem } from '@shared/types'

export function CategoryBrowser({
  categories,
  categoryChildren,
  items,
  selectedCategory,
  onSelectCategory
}: {
  categories: MenuCategory[]
  categoryChildren: Map<string, MenuCategory[]>
  items: MenuItem[]
  selectedCategory: string | null
  onSelectCategory: (id: string | null) => void
}): React.ReactElement {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const selected = selectedCategory ? categoriesById.get(selectedCategory) : undefined
  const roots = categories.filter(
    (category) => !category.parentId || !categoriesById.has(category.parentId)
  )
  const breadcrumb: MenuCategory[] = []
  let cursor = selected

  while (cursor) {
    breadcrumb.unshift(cursor)
    cursor = cursor.parentId ? categoriesById.get(cursor.parentId) : undefined
  }

  const countItemsInCategory = (categoryId: string): number => {
    const visibleIds = new Set<string>([categoryId])
    const collectChildren = (id: string): void => {
      for (const child of categoryChildren.get(id) ?? []) {
        visibleIds.add(child.id)
        collectChildren(child.id)
      }
    }
    collectChildren(categoryId)
    return items.filter((item) => visibleIds.has(item.categoryId)).length
  }

  if (!selected) {
    return (
      <div className="pos-category-browser pos-category-browser--landing">
        <div className="pos-category-landing__header">
          <div>
            <h2>التصنيفات</h2>
            <p>اختر تصنيف لعرض الأصناف داخله</p>
          </div>
        </div>
        <div className="pos-category-grid">
          {roots.map((category) => {
            const childrenCount = categoryChildren.get(category.id)?.length ?? 0
            const itemCount = countItemsInCategory(category.id)
            return (
              <button
                key={category.id}
                type="button"
                className="pos-category-card"
                onClick={() => onSelectCategory(category.id)}
              >
                <span className="pos-category-card__name">{category.nameAr}</span>
                <span className="pos-category-card__meta">
                  {itemCount} صنف{childrenCount > 0 ? ` / ${childrenCount} فرعي` : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const selectedChildren = categoryChildren.get(selected.id) ?? []

  return (
    <div className="pos-category-browser">
      <div className="pos-category-header">
        <button
          type="button"
          className="pos-category-back"
          onClick={() => onSelectCategory(null)}
        >
          رجوع للتصنيفات
        </button>
        <div className="pos-category-title">
          <h2>{selected.nameAr}</h2>
          <div className="pos-category-breadcrumb" aria-label="مسار التصنيف">
            <button
              type="button"
              className="pos-category-breadcrumb__item"
              onClick={() => onSelectCategory(null)}
            >
              التصنيفات
            </button>
            {breadcrumb.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`pos-category-breadcrumb__item${selectedCategory === category.id ? ' active' : ''}`}
                onClick={() => onSelectCategory(category.id)}
              >
                {category.nameAr}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedChildren.length > 0 && (
        <div className="pos-categories">
          <button
            type="button"
            className="pos-cat-btn pos-cat-btn--current active"
            onClick={() => onSelectCategory(selected.id)}
          >
            كل {selected.nameAr}
          </button>
          {selectedChildren.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`pos-cat-btn${selectedCategory === category.id ? ' active' : ''}`}
              onClick={() => onSelectCategory(category.id)}
            >
              <span>{category.nameAr}</span>
              <span className="pos-cat-btn__count">{countItemsInCategory(category.id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
