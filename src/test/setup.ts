import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Vitest runs without globals, so React Testing Library's automatic cleanup
// is not registered for us.
afterEach(() => {
  cleanup()
})
