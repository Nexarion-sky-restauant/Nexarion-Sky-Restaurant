import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MenuCategory, MenuItem } from '../../types/database'
import {
  parsePrice,
  saveItem,
  uploadMenuImage,
  validateDescription,
  validateImageFile,
  validateName,
} from '../../lib/menu'

interface MenuItemEditorProps {
  organizationId: string
  categories: MenuCategory[]
  defaultCategoryId: string
  item: MenuItem | null
  existingImageUrl: string | null
  onClose: () => void
  onSaved: () => void
}

export default function MenuItemEditor({
  organizationId,
  categories,
  defaultCategoryId,
  item,
  existingImageUrl,
  onClose,
  onSaved,
}: MenuItemEditorProps) {
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId)
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? item.price.toFixed(2) : '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState(item?.is_available ?? true)
  const [isActive, setIsActive] = useState(item?.is_active ?? true)
  const [nameError, setNameError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextNameError = validateName(name)
    const nextDescriptionError = validateDescription(description)
    const nextPrice = parsePrice(price)
    const nextImageError = file ? validateImageFile(file) : null
    setNameError(nextNameError)
    setDescriptionError(nextDescriptionError)
    setPriceError(nextPrice.error)
    setImageError(nextImageError)
    if (nextNameError || nextDescriptionError || nextPrice.error || nextImageError) return
    if (!categoryId) {
      setError('Choose a category for this item.')
      return
    }
    if (nextPrice.value === null) return

    setBusy(true)
    setError(null)

    let imagePath = item?.image_path ?? null
    if (file) {
      const upload = await uploadMenuImage(organizationId, file)
      if (upload.error || !upload.path) {
        setBusy(false)
        setError(upload.error ?? 'The image could not be uploaded.')
        return
      }
      imagePath = upload.path
    }

    const { error: saveError } = await saveItem(organizationId, item?.id ?? null, {
      category_id: categoryId,
      name: name.trim(),
      description: description.trim(),
      price: nextPrice.value,
      image_path: imagePath,
      is_available: isAvailable,
      is_active: isActive,
    })
    setBusy(false)
    if (saveError) {
      setError(saveError)
      return
    }
    onSaved()
  }

  const shownImage = preview ?? existingImageUrl

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title" id="item-editor-title">
          {item ? 'Edit item' : 'New item'}
        </h2>
        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>Category</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Item name</span>
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

          <label className="field field-narrow">
            <span>Price (KES)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          {priceError && <div className="field-error">{priceError}</div>}

          <label className="field">
            <span>Image (JPEG, PNG or WebP — 2 MB max)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {imageError && <div className="field-error">{imageError}</div>}
          {shownImage && (
            <div className="menu-image-preview">
              <img src={shownImage} alt="Item preview" />
            </div>
          )}

          <div className="field-row">
            <label className="field-check">
              <input
                type="checkbox"
                checked={isAvailable}
                onChange={(event) => setIsAvailable(event.target.checked)}
              />
              <span>Available</span>
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
              {busy ? 'Saving…' : 'Save item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
