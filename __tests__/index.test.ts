import { jest } from '@jest/globals'

import * as mainMock from '../__fixtures__/main.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('../src/main.js', () => mainMock)

describe('index', () => {
  it('calls run when imported', async () => {
    await import('../src/index.js')

    expect(mainMock.run).toHaveBeenCalled()
  })
})
