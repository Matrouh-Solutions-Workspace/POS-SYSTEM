import type { MenuCategory } from '@shared/types'

export function CategoryBrowser({
  categories,
  categoryChildren,
  selectedCategory,
  onSelectCategory
}: {
  categories: MenuCategory[]
  categoryChildren: Map<string, MenuCategory[]>
  selectedCategory: string
  onSelectCategory: (id: string) => void
}): React.ReactElement {
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  const selected = selectedCategory === 'all' ? undefined : categoriesById.get(selectedCategory)
  const roots = categories.filter(
    (category) => !category.parentId || !categoriesById.has(category.parentId)
  )
  const selectedChildren = selected ? (categoryChildren.get(selected.id) ?? []) : roots
  const visibleCategories =
    selected && selectedChildren.length === 0
      ? selected.parentId
        ? (categoryChildren.get(selected.parentId) ?? roots)
        : roots
      : selectedChildren
  const breadcrumb: MenuCategory[] = []
  let cursor = selected

  while (cursor) {
    breadcrumb.unshift(cursor)
    cursor = cursor.parentId ? categoriesById.get(cursor.parentId) : undefined
  }

  return (
    <div className="pos-category-browser">
      <div className="pos-category-breadcrumb" aria-label="مسار التصنيف">
        <button
          type="button"
          className={`pos-category-breadcrumb__item${selectedCategory === 'all' ? ' active' : ''}`}
          onClick={() => onSelectCategory('all')}
        >
          الكل
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

      <div className="pos-categories">
        {selected && selectedChildren.length > 0 && (
          <button
            type="button"
            className="pos-cat-btn pos-cat-btn--current active"
            onClick={() => onSelectCategory(selected.id)}
          >
            كل {selected.nameAr}
          </button>
        )}
        {visibleCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`pos-cat-btn${selectedCategory === category.id ? ' active' : ''}`}
            onClick={() => onSelectCategory(category.id)}
          >
            <span>{category.nameAr}</span>
            {(categoryChildren.get(category.id)?.length ?? 0) > 0 && (
              <span className="pos-cat-btn__children">›</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
