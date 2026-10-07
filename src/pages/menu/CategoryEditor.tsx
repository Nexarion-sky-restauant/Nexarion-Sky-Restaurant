import { useState } from 'react'
import type { FormEvent } from 'react'
import type { MenuCategory } from '../../types/database'
import { saveCategory, validateDescription, validateName } from '../../lib/menu'

interface CategoryEditorProps {
  organizationId: string
  category: MenuCategory | null
  onClose: () => void
  onSaved: () => void
}

export default function CategoryEditor({ organizationId, category, onClose, onSaved }: CategoryEditorProps) {
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [nameError, setNameError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextNameError = validateName(name)
    const nextDescriptionError = validateDescription(description)
    setNameError(nextNameError)
    setDescriptionError(nextDescriptionError)
    if (nextNameError || nextDescriptionError) return

    setBusy(true)
    setError(null)
    const { error: saveError } = await saveCategory(organizationId, category?.id ?? null, {
      name: name.trim(),
      description: description.trim(),
      sort_order: Number.parseInt(sortOrder, 10) || 0,
      is_active: isActive,
    })
    setBusy(false)
    if (saveError) {
      setError(saveError)
      return
    }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="category-editor-title">
          {category ? 'Edit category' : 'New category'}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Category name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />
          </label>
          {nameError && <div className="field-error">{nameError}</div>}

          <label className="field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
            />
          </label>
          {descriptionError && <div className="field-error">{descriptionError}</div>}

          <div className="field-row">
            <label className="field field-narrow">
              <span>Sort order</span>
              <input type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
            </label>
            <label className="field-check">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save category'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
