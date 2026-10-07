import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MenuListPage from '../pages/menu/MenuListPage'
import { authValue, type AuthValue } from './authMock'
import {
  TEST_CATEGORY_ID,
  TEST_ITEM_ID,
  TEST_ORG_ID,
  makeAccess,
  makeMenuCategory,
  makeMenuItem,
} from './fixtures'

// jsdom does not implement object URLs; MenuItemEditor uses them for previews.
if (typeof URL.createObjectURL !== 'function') {
  Object.assign(URL as unknown as Record<string, unknown>, {
    createObjectURL: () => 'blob:menu-preview',
    revokeObjectURL: () => {},
  })
}

const mocks = vi.hoisted(() => ({
  current: null as unknown as AuthValue,
  listMenu: vi.fn(),
  saveCategory: vi.fn(),
  saveItem: vi.fn(),
  setItemAvailability: vi.fn(),
  uploadMenuImage: vi.fn(),
  signedImageUrls: vi.fn(),
}))

vi.mock('../lib/auth', () => ({
  useAuth: () => mocks.current,
}))

vi.mock('../lib/supabase', () => ({ supabase: {} }))

vi.mock('../lib/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/menu')>()
  return {
    ...actual,
    listMenu: mocks.listMenu,
    saveCategory: mocks.saveCategory,
    saveItem: mocks.saveItem,
    setItemAvailability: mocks.setItemAvailability,
    uploadMenuImage: mocks.uploadMenuImage,
    signedImageUrls: mocks.signedImageUrls,
  }
})

function managerAuth(): AuthValue {
  return authValue({
    access: makeAccess({ permissions: ['dashboard.view', 'menu.manage'] }),
    hasPermission: (key) => key === 'menu.manage',
  })
}

function staffAuth(): AuthValue {
  return authValue({
    access: makeAccess({ permissions: ['dashboard.view'] }),
    hasPermission: (key) => key === 'dashboard.view',
  })
}

function renderMenu(auth: AuthValue = managerAuth()) {
  mocks.current = auth
  return render(<MenuListPage />)
}

function submitDialog() {
  const dialog = screen.getByRole('dialog')
  const form = dialog.querySelector('form')
  if (!form) throw new Error('form not found')
  fireEvent.submit(form)
  return dialog
}

function fillNewCategory(dialog: HTMLElement, name: string) {
  fireEvent.change(within(dialog).getByLabelText('Category name'), { target: { value: name } })
}

beforeEach(() => {
  mocks.listMenu.mockReset()
  mocks.saveCategory.mockReset()
  mocks.saveItem.mockReset()
  mocks.setItemAvailability.mockReset()
  mocks.uploadMenuImage.mockReset()
  mocks.signedImageUrls.mockReset()

  mocks.listMenu.mockResolvedValue({
    data: { categories: [makeMenuCategory()], items: [makeMenuItem()] },
    error: null,
  })
  mocks.saveCategory.mockResolvedValue({ error: null })
  mocks.saveItem.mockResolvedValue({ error: null })
  mocks.setItemAvailability.mockResolvedValue({ error: null })
  mocks.uploadMenuImage.mockResolvedValue({ path: `${TEST_ORG_ID}/abc.jpg`, error: null })
  mocks.signedImageUrls.mockResolvedValue({ urls: {}, error: null })
})

describe('MenuListPage manager view', () => {
  it('renders category, item, price and management controls', async () => {
    renderMenu()
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()
    expect(screen.getByText('Starters')).toBeInTheDocument()
    expect(screen.getByText('KES 950.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New category' })).toBeInTheDocument()
    expect(screen.getByLabelText('Show inactive')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit category' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the manager empty state before any category exists', async () => {
    mocks.listMenu.mockResolvedValue({ data: { categories: [], items: [] }, error: null })
    renderMenu()
    expect(
      await screen.findByText(
        'No menu categories yet. Create the first category to start building the menu.',
      ),
    ).toBeInTheDocument()
  })

  it('surfaces a load error with a retry action', async () => {
    mocks.listMenu.mockResolvedValue({ data: null, error: 'permission denied' })
    renderMenu()
    expect(await screen.findByText('permission denied')).toBeInTheDocument()
    expect(screen.getByText('The menu could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('MenuListPage staff view', () => {
  it('renders the menu read-only without editing controls', async () => {
    renderMenu(staffAuth())
    expect(await screen.findByText('Truffle Soup')).toBeInTheDocument()
    expect(screen.getByText('KES 950.00')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Show inactive')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add item' })).not.toBeInTheDocument()
  })

  it('shows the staff empty state when nothing is published', async () => {
    mocks.listMenu.mockResolvedValue({ data: { categories: [], items: [] }, error: null })
    renderMenu(staffAuth())
    expect(await screen.findByText('The menu has not been published yet.')).toBeInTheDocument()
  })
})

describe('availability toggle', () => {
  it('persists the toggle and reloads the menu', async () => {
    mocks.listMenu
      .mockResolvedValueOnce({
        data: { categories: [makeMenuCategory()], items: [makeMenuItem()] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          categories: [makeMenuCategory()],
          items: [makeMenuItem({ is_available: false })],
        },
        error: null,
      })
    renderMenu()
    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(mocks.setItemAvailability).toHaveBeenCalledWith(TEST_ITEM_ID, false),
    )
    await waitFor(() => expect(mocks.listMenu).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('reports a toggle failure without losing the table', async () => {
    mocks.setItemAvailability.mockResolvedValue({ error: 'row level security denied' })
    renderMenu()
    fireEvent.click(await screen.findByRole('switch'))
    expect(await screen.findByText('row level security denied')).toBeInTheDocument()
    expect(screen.getByText('Truffle Soup')).toBeInTheDocument()
  })
})

describe('inactive filter', () => {
  it('reloads the menu with inactive rows included', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    expect(mocks.listMenu).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByLabelText('Show inactive'))
    await waitFor(() => expect(mocks.listMenu).toHaveBeenLastCalledWith(true))
  })
})

describe('category editing', () => {
  it('creates a category through the modal', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New category')).toBeInTheDocument()
    fillNewCategory(dialog, 'Desserts')
    submitDialog()

    await waitFor(() =>
      expect(mocks.saveCategory).toHaveBeenCalledWith(TEST_ORG_ID, null, {
        name: 'Desserts',
        description: '',
        sort_order: 0,
        is_active: true,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(mocks.listMenu).toHaveBeenCalledTimes(2))
  })

  it('blocks an empty name without calling the save', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    submitDialog()
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(mocks.saveCategory).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes the modal on cancel without saving', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.saveCategory).not.toHaveBeenCalled()
  })
})

describe('menu item editing', () => {
  it('uploads a new image before creating the item', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('New item')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Item name'), {
      target: { value: 'Bruschetta' },
    })
    fireEvent.change(within(dialog).getByLabelText('Price (KES)'), {
      target: { value: '350.5' },
    })
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(within(dialog).getByLabelText(/Image/), { target: { files: [file] } })
    submitDialog()

    await waitFor(() => expect(mocks.uploadMenuImage).toHaveBeenCalledWith(TEST_ORG_ID, file))
    await waitFor(() =>
      expect(mocks.saveItem).toHaveBeenCalledWith(TEST_ORG_ID, null, {
        category_id: TEST_CATEGORY_ID,
        name: 'Bruschetta',
        description: '',
        price: 350.5,
        image_path: `${TEST_ORG_ID}/abc.jpg`,
        is_available: true,
        is_active: true,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rejects a price the column cannot store before any upload', async () => {
    renderMenu()
    await screen.findByText('Truffle Soup')
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Item name'), {
      target: { value: 'Bruschetta' },
    })
    fireEvent.change(within(dialog).getByLabelText('Price (KES)'), {
      target: { value: '12.345' },
    })
    submitDialog()
    expect(
      await screen.findByText('Enter a price with up to 2 decimal places.'),
    ).toBeInTheDocument()
    expect(mocks.saveItem).not.toHaveBeenCalled()
    expect(mocks.uploadMenuImage).not.toHaveBeenCalled()
  })
})

describe('signed images', () => {
  it('renders an uploaded image through a signed URL', async () => {
    const imagePath = `${TEST_ORG_ID}/dish.jpg`
    mocks.listMenu.mockResolvedValue({
      data: {
        categories: [makeMenuCategory()],
        items: [makeMenuItem({ image_path: imagePath })],
      },
      error: null,
    })
    mocks.signedImageUrls.mockResolvedValue({
      urls: { [imagePath]: 'https://signed.example/dish.jpg' },
      error: null,
    })

    const { container } = renderMenu()
    await waitFor(() => expect(mocks.signedImageUrls).toHaveBeenCalledWith([imagePath]))
    await waitFor(() => {
      expect(container.querySelector('img.menu-thumb')).toHaveAttribute(
        'src',
        'https://signed.example/dish.jpg',
      )
    })
  })
})
