/**
 * Unit tests for src/cdn.ts
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import fs from 'fs'
import os from 'os'
import * as path from 'path'

import { downloadFile, getCdnAssetUrl, getLatestVersion } from '../src/cdn.js'

const fetchMock = jest.spyOn(globalThis, 'fetch')

function respond(body: string, status = 200): Response {
  return new Response(body, { status })
}

afterEach(() => {
  fetchMock.mockReset()
})

describe('getCdnAssetUrl', () => {
  it('builds the asset URL', () => {
    expect(getCdnAssetUrl('3.0.1', 'stencil_3.0.1_linux_amd64.tar.gz')).toBe(
      'https://bins.rgst.io/rgst-io/stencil/3.0.1/stencil_3.0.1_linux_amd64.tar.gz'
    )
  })

  it('strips the v prefix', () => {
    expect(getCdnAssetUrl('v3.0.1', 'checksums.txt')).toBe(
      'https://bins.rgst.io/rgst-io/stencil/3.0.1/checksums.txt'
    )
  })
})

describe('getLatestVersion', () => {
  it('reads LATEST', async () => {
    fetchMock.mockResolvedValueOnce(respond('3.0.1\n'))
    await expect(getLatestVersion(false)).resolves.toBe('3.0.1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bins.rgst.io/rgst-io/stencil/LATEST'
    )
  })

  it('reads LATEST_PRERELEASE when prereleases are enabled', async () => {
    fetchMock.mockResolvedValueOnce(respond('3.1.0-rc.1\n'))
    await expect(getLatestVersion(true)).resolves.toBe('3.1.0-rc.1')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://bins.rgst.io/rgst-io/stencil/LATEST_PRERELEASE'
    )
  })

  it('strips the v prefix', async () => {
    fetchMock.mockResolvedValueOnce(respond('v3.0.1'))
    await expect(getLatestVersion(false)).resolves.toBe('3.0.1')
  })

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(respond('', 500))
    await expect(getLatestVersion(false)).rejects.toThrow('HTTP 500')
  })

  it('throws on a body that is not a version', async () => {
    fetchMock.mockResolvedValueOnce(respond('<html>oops</html>'))
    await expect(getLatestVersion(false)).rejects.toThrow(
      'Invalid latest version'
    )
  })
})

describe('downloadFile', () => {
  const url = 'https://bins.rgst.io/rgst-io/stencil/3.0.1/checksums.txt'
  let tempDir: string

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function tempFile(): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-action-test-'))
    return path.join(tempDir, 'out')
  }

  it('writes the response body to disk', async () => {
    const out = tempFile()
    fetchMock.mockResolvedValueOnce(respond('hello'))
    await downloadFile(url, out)
    expect(fs.readFileSync(out, 'utf8')).toBe('hello')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 404 without cache', async () => {
    const out = tempFile()
    fetchMock
      .mockResolvedValueOnce(respond('', 404))
      .mockResolvedValueOnce(respond('hello'))
    await downloadFile(url, out)
    expect(fs.readFileSync(out, 'utf8')).toBe('hello')
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringMatching(new RegExp(`^${url}\\?nocache=\\d+$`))
    )
  })

  it('throws when the asset is not on the CDN', async () => {
    fetchMock.mockResolvedValue(respond('', 404))
    await expect(downloadFile(url, tempFile())).rejects.toThrow(
      'checksums.txt not found on CDN'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on other HTTP errors without retrying', async () => {
    fetchMock.mockResolvedValue(respond('', 503))
    await expect(downloadFile(url, tempFile())).rejects.toThrow('HTTP 503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
