import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { giteaApi } from 'gitea-js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const REPO_OWNER = 'rgst-io'
const REPO_NAME = 'stencil'

// ── Types ──────────────────────────────────────────────────────────────────────

type GoPlatform = 'windows' | 'darwin' | 'linux'
type GoArch = 'amd64' | '386' | 'arm64' | 'armv6' | `ppc64`

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

// ── Forgejo API ────────────────────────────────────────────────────────────────

const FORGEJO_URL = 'https://git.rgst.io'

/**
 * Find a release asset by filename and return its download URL.
 */
function findAssetUrl(
  assets: { name?: string; browser_download_url?: string }[],
  fileName: string
): string | null {
  const asset = assets.find((a) => a.name === fileName)
  return asset?.browser_download_url ?? null
}

/**
 * Fetch the release from Forgejo and find the asset download URL by filename.
 */
export async function getForgejoAssetUrl(
  version: string,
  fileName: string
): Promise<string | null> {
  try {
    const client = giteaApi(FORGEJO_URL)
    const response = await client.repos.repoGetReleaseByTag(
      REPO_OWNER,
      REPO_NAME,
      `v${version}`
    )
    const assets = response.data.assets ?? []
    return findAssetUrl(assets, fileName)
  } catch {
    return null
  }
}

/**
 * Fetch the latest stencil version from a Forgejo instance.
 * Returns null on any error so we can fall back to GitHub.
 */
export async function getForgejoVersion(
  forgejoUrl: string,
  prereleases: boolean
): Promise<string | null> {
  try {
    const client = giteaApi(forgejoUrl)
    const response = await client.repos.repoListReleases(REPO_OWNER, REPO_NAME)

    const releases = response.data
    if (!releases || releases.length === 0) {
      return null
    }

    for (const release of releases) {
      if (!prereleases && release.prerelease) continue
      const tag = release.tag_name?.replace(/^v/, '') ?? ''
      if (tag) return tag
    }

    return null
  } catch {
    // Any error (network, auth, etc.) — fall back to GitHub
    return null
  }
}

/**
 * Check if a release exists on Forgejo by tag.
 */
export async function forgejoReleaseExists(version: string): Promise<boolean> {
  try {
    const client = giteaApi(FORGEJO_URL)
    await client.repos.repoGetReleaseByTag(REPO_OWNER, REPO_NAME, `v${version}`)
    return true
  } catch {
    return false
  }
}

// ── GPG Verification ───────────────────────────────────────────────────────────

/**
 * Verify the archive using GPG signature from Forgejo.
 * Downloads the .sig file, imports the public key into a temporary GPG home,
 * and verifies the signature.
 */
export async function verifyArchiveGpgSignature(
  archivePath: string,
  tempDir: string,
  version: string,
  osName: GoPlatform,
  osArch: GoArch
): Promise<void> {
  const sigFileName = `stencil_${version}_${osName}_${osArch}.tar.gz.sig`
  const sigURL = await getForgejoAssetUrl(version, sigFileName)

  if (!sigURL) {
    throw new Error(
      `Signature asset ${sigFileName} not found in v${version} release on Forgejo`
    )
  }

  const sigPath = path.join(tempDir, sigFileName)

  core.debug(`Downloading GPG signature from ${sigURL}`)
  await downloadFile(sigURL, sigPath)

  // Create a temporary GPG home directory to avoid polluting the user's keyring
  const gpgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-gpg-'))
  fs.chmodSync(gpgHome, 0o700)

  try {
    // Import the GPG public key into the temporary home
    core.debug('Importing GPG public key')
    const keyFile = path.join(tempDir, 'release-key.asc')
    fs.writeFileSync(keyFile, GPG_PUBLIC_KEY)
    await exec.exec('gpg', [
      '--batch',
      '--homedir',
      gpgHome,
      '--import',
      keyFile
    ])

    // Verify the signature using the temporary home
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
    // Clean up the temporary GPG home directory
    fs.rmSync(gpgHome, { recursive: true, force: true })
  }
}

// ── HTTP Helpers ───────────────────────────────────────────────────────────────

/**
 * Download a file from a URL to a local path using Node's built-in fetch.
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: HTTP ${response.status} ${response.statusText}`
    )
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(outputPath, buffer)
}
