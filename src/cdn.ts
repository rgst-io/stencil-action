import * as core from '@actions/core'
import * as exec from '@actions/exec'
import fs from 'fs'
import os from 'os'
import * as path from 'path'

// ── Configuration ──────────────────────────────────────────────────────────────

export const CDN_URL = 'https://bins.rgst.io'
const CDN_PATH = 'rgst-io/stencil'

// ── GPG Public Key ─────────────────────────────────────────────────────────────

const GPG_PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEaj6BbxYJKwYBBAHaRw8BAQdAF5Kh2/vFQkWd51a8LY5axyMC7LjcL9ZQeToD
9pF23CW0JHJnc3QuaW8gUmVsZWFzZSBLZXkgPHJlbGVuZ0ByZ3N0LmlvPoi1BBMW
CgBdFiEEUV6LkiiGoipIXByfLcroRplwi8YFAmo+gW8bFIAAAAAABAAObWFudTIs
Mi41KzEuMTIsMCwzAhsDBQkSzAMABQsJCAcCAiICBhUKCQgLAgQWAgMBAh4HAheA
AAoJEC3K6EaZcIvGxhIBAP1dPTvxqr8JwrjtGPv4y24k169rVJxmJNgRfBK27fJV
AQCLlrn7OO/mUVb7Xl60CN9q4pZJkpviSJqDARLjkQWDCA==
=wsD+
-----END PGP PUBLIC KEY BLOCK-----`

// ── CDN ────────────────────────────────────────────────────────────────────────

/**
 * Returns the CDN URL for a release asset. Versions on the CDN are never
 * prefixed with 'v'.
 */
export function getCdnAssetUrl(version: string, fileName: string): string {
  return `${CDN_URL}/${CDN_PATH}/${version.replace(/^v/, '')}/${fileName}`
}

/**
 * Fetch the latest stencil version from the CDN. When prereleases is true,
 * the newest release including prereleases is returned.
 */
export async function getLatestVersion(prereleases: boolean): Promise<string> {
  const url = `${CDN_URL}/${CDN_PATH}/${prereleases ? 'LATEST_PRERELEASE' : 'LATEST'}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest version from ${url}: HTTP ${response.status} ${response.statusText}`
    )
  }

  const version = (await response.text()).trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid latest version from ${url}: ${version}`)
  }
  return version
}

/**
 * Download a file from the CDN to a local path. A 404 is retried once with a
 * cache-busting query string, since Cloudflare caches 404s and a request for
 * an object made before it was uploaded would otherwise keep failing.
 */
export async function downloadFile(
  url: string,
  outputPath: string
): Promise<void> {
  let response = await fetch(url)
  if (response.status === 404) {
    core.debug(`Got 404 for ${url}, retrying without cache`)
    response = await fetch(`${url}?nocache=${Date.now()}`)
  }

  if (response.status === 404) {
    throw new Error(
      `${path.basename(url)} not found on CDN (${url}). Is this version/platform published?`
    )
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(outputPath, buffer)
}

// ── GPG Verification ───────────────────────────────────────────────────────────

/**
 * Verify an archive against its detached GPG signature. The public key is
 * imported into a temporary GPG home to avoid polluting the user's keyring.
 */
export async function verifyArchiveGpgSignature(
  archivePath: string,
  sigPath: string
): Promise<void> {
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-gpg-'))
  fs.chmodSync(gpgHome, 0o700)

  try {
    core.debug('Importing GPG public key')
    const keyFile = path.join(gpgHome, 'release-key.asc')
    fs.writeFileSync(keyFile, GPG_PUBLIC_KEY)
    await exec.exec('gpg', [
      '--batch',
      '--homedir',
      gpgHome,
      '--import',
      keyFile
    ])

    core.debug('Verifying GPG signature')
    await exec.exec('gpg', [
      '--batch',
      '--homedir',
      gpgHome,
      '--verify',
      sigPath,
      archivePath
    ])
  } finally {
    fs.rmSync(gpgHome, { recursive: true, force: true })
  }
}
