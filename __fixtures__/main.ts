import { jest } from '@jest/globals'

export const run = jest.fn<typeof import('../src/main.js').run>()
