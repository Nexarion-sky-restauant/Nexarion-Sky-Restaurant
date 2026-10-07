import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { formatKes, listMenu, setItemAvailability, signedImageUrls } from '../../lib/menu'
import type { MenuData } from '../../lib/menu'
import type { MenuCategory, MenuItem } from '../../types/database'
import AvailabilityToggle from './AvailabilityToggle'
import CategoryEditor from './CategoryEditor'
import MenuItemEditor from './MenuItemEditor'

type EditorState =
  | { kind: 'category'; category: MenuCategory | null }
  | { kind: 'item'; categoryId: string; item: MenuItem | null }
  | null

function MenuThumb({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="menu-thumb-empty" aria-hidden="true">
        ✻
      </div>
    )
  }
  return <img className="menu-thumb" src={url} alt="" />
}

export default function MenuListPage() {
  const { access, hasPermission } = useAuth()
  const canManage = hasPermission('menu.manage')
  const organizationId = access?.organization?.id ?? ''

  const [data, setData] = useState<MenuData | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editor, setEditor] = useState<EditorState>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data: menu, error: loadError } = await listMenu(includeInactive)
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setData(menu)
    const paths = [
      ...new Set(
        (menu?.items ?? [])
          .map((item) => item.image_path)
          .filter((path): path is string => Boolean(path)),
      ),
    ]
    if (paths.length > 0) {
      const { urls: signed, error: signError } = await signedImageUrls(paths)
      if (signError) {
        setError(signError)
      } else {
        setUrls((current) => ({ ...current, ...signed }))
      }
    }
    setLoading(false)
  }, [includeInactive])

  useEffect(() => {
    void load()
  }, [load])

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>()
    for (const item of data?.items ?? []) {
      const bucket = map.get(item.category_id) ?? []
      bucket.push(item)
      map.set(item.category_id, bucket)
    }
    return map
  }, [data])

  const handleSaved = () => {
    setEditor(null)
    void load()
  }

  const handleToggle = async (item: MenuItem, next: boolean) => {
    setBusyItemId(item.id)
    setError(null)
    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.map((row) => (row.id === item.id ? { ...row, is_available: next } : row)),
          }
        : current,
    )
    const { error: toggleError } = await setItemAvailability(item.id, next)
    setBusyItemId(null)
    // load() clears the error state when it starts, so report a failed toggle
    // after kicking off the reload or the alert would be wiped instantly.
    void load()
    if (toggleError) setError(toggleError)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Menu</h1>
        <p className="page-sub">Categories and dishes served across the restaurant.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {canManage && (
        <div className="menu-controls">
          <label className="field-check">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
            <span>Show inactive</span>
          </label>
          <div className="menu-controls-spacer" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditor({ kind: 'category', category: null })}
          >
            New category
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="card">
          <p className="card-note">Loading menu…</p>
        </div>
      ) : !data ? (
        <div className="card">
          <p className="card-note">The menu could not be loaded.</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            Retry
          </button>
        </div>
      ) : data.categories.length === 0 ? (
        <div className="card">
          <p className="card-note">
            {canManage
              ? 'No menu categories yet. Create the first category to start building the menu.'
              : 'The menu has not been published yet.'}
          </p>
        </div>
      ) : (
        data.categories.map((category) => {
          const items = itemsByCategory.get(category.id) ?? []
          return (
            <div key={category.id} className="card">
              <div className="menu-category-head">
                <div>
                  <h2 className="menu-category-name">
                    {category.name}
                    {!category.is_active && <span className="pill pill-inactive">Inactive</span>}
                  </h2>
                  {category.description && <p className="card-note">{category.description}</p>}
                </div>
                {canManage && (
                  <div className="menu-category-actions">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditor({ kind: 'category', category })}
                    >
                      Edit category
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditor({ kind: 'item', categoryId: category.id, item: null })}
                    >
                      Add item
                    </button>
                  </div>
                )}
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Price</th>
                    <th>Availability</th>
                    {canManage && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td className="table-empty" colSpan={canManage ? 4 : 3}>
                        No items in this category yet.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.id} className={item.is_active ? undefined : 'menu-row-inactive'}>
                        <td>
                          <div className="menu-item-cell">
                            <MenuThumb url={item.image_path ? urls[item.image_path] ?? null : null} />
                            <div>
                              <div className="menu-item-name">
                                {item.name}
                                {!item.is_active && <span className="pill pill-inactive">Inactive</span>}
                              </div>
                              {item.description && <div className="menu-item-desc">{item.description}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="mono menu-price">{formatKes(item.price)}</td>
                        <td>
                          {canManage ? (
                            <AvailabilityToggle
                              isAvailable={item.is_available}
                              disabled={busyItemId === item.id}
                              onToggle={(next) => void handleToggle(item, next)}
                            />
                          ) : (
                            <span className={item.is_available ? 'pill pill-active' : 'pill'}>
                              {item.is_available ? 'Available' : 'Unavailable'}
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditor({ kind: 'item', categoryId: category.id, item })}
                            >
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        })
      )}

      {editor?.kind === 'category' && (
        <CategoryEditor
          organizationId={organizationId}
          category={editor.category}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
      {editor?.kind === 'item' && (
        <MenuItemEditor
          organizationId={organizationId}
          categories={data?.categories ?? []}
          defaultCategoryId={editor.categoryId}
          item={editor.item}
          existingImageUrl={editor.item?.image_path ? urls[editor.item.image_path] ?? null : null}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
