import * as core from '@actions/core'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

import {
  getForgejoAssetUrl,
  getForgejoVersion,
  forgejoReleaseExists,
  verifyArchiveGpgSignature
} from './forgejo.js'
import {
  getGitHubAssetUrl,
  getGitHubVersion,
  verifyArchiveAttestation
} from './github.js'

type GoPlatform = 'windows' | 'darwin' | 'linux'
type GoArch = 'amd64' | '386' | 'arm64' | 'armv6' | `ppc64`

// ── Configuration ──────────────────────────────────────────────────────────────

const FORGEJO_URL = 'https://git.rgst.io'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const { version, source } = await getVersion()
    let binaryDir = core.getInput('binary-dir')

    // Resolve ~ to the user's home directory
    if (binaryDir.startsWith('~')) {
      binaryDir = binaryDir.replace('~', os.homedir())
    }

    core.info(`Downloading stencil to ${binaryDir}`)

    core.debug(`Creating binary directory ${binaryDir} (mkdir -p)`)
    if (!fs.existsSync(binaryDir)) {
      fs.mkdirSync(binaryDir, { recursive: true })
    }

    let osName: GoPlatform
    let osArch: GoArch

    switch (os.platform()) {
      case 'win32':
        osName = 'windows'
        break
      case 'darwin':
        osName = 'darwin'
        break
      case 'linux':
        osName = 'linux'
        break
      default:
        throw new Error('Unsupported platform')
    }

    switch (os.arch()) {
      case 'arm64':
        osArch = 'arm64'
        break
      case 'arm':
        osArch = 'armv6'
        break
      case 'ia32':
        osArch = '386'
        break
      case 'x64':
        osArch = 'amd64'
        break
      case 'ppc64':
        osArch = 'ppc64'
        break
      default:
        throw new Error('Unsupported architecture')
    }

    // Determine the effective source — for explicit versions, try Forgejo first
    let effectiveSource: VersionSource = source

    if (source === 'forgejo' && !isExplicitVersion()) {
      // Version was resolved from Forgejo API — already confirmed available
    } else if (source === 'forgejo') {
      // Explicit version — try Forgejo download, fall back to GitHub
      effectiveSource = await tryDownloadWithFallback(version)
    }

    const platformLabel = effectiveSource === 'forgejo' ? 'Forgejo' : 'GitHub'
    core.info(`Using stencil@${version} (source: ${platformLabel})`)

    const archiveName = `stencil_${version}_${osName}_${osArch}.tar.gz`
    const downloadURL =
      effectiveSource === 'forgejo'
        ? await getForgejoAssetUrl(version, archiveName)
        : await getGitHubAssetUrl(version, archiveName)

    if (!downloadURL) {
      throw new Error(
        `Asset ${archiveName} not found in v${version} release on ${platformLabel}`
      )
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-action-'))
    const tempArchive = path.join(tempDir, 'stencil.tar.gz')

    core.info(`Downloading stencil from ${downloadURL} to ${tempDir}`)
    await downloadFile(downloadURL, tempArchive)

    // Verify the archive — GPG for Forgejo, attestation for GitHub
    if (effectiveSource === 'forgejo') {
      core.info('Verifying archive GPG signature')
      await verifyArchiveGpgSignature(
        tempArchive,
        tempDir,
        version,
        osName,
        osArch
      )
    } else {
      core.info('Verifying archive attestation')
      await verifyArchiveAttestation(tempArchive)
    }

    core.debug(`Extracting stencil.tar.gz to ${tempDir}`)
    await exec.exec('tar', ['-xzf', tempArchive, '-C', tempDir])

    core.debug(`Moving stencil to ${binaryDir}`)
    await io.mv(path.join(tempDir, 'stencil'), path.join(binaryDir, 'stencil'))

    core.debug(`Making stencil executable (chmod +x)`)
    await exec.exec('chmod', ['+x', path.join(binaryDir, 'stencil')])

    core.debug(`Testing stencil installation`)
    await exec.exec(path.join(binaryDir, 'stencil'), ['--version'])

    core.debug(`Adding ${binaryDir} to PATH`)
    core.addPath(binaryDir)

    core.info(`stencil has been installed to ${binaryDir}`)
  } catch (err) {
    // Fail the workflow run if an error occurs
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else {
      throw err
    }
  }
}

type VersionSource = 'forgejo' | 'github'

interface ResolvedVersion {
  version: string
  source: VersionSource
  explicit: boolean
}

function isExplicitVersion(): boolean {
  const version = core.getInput('version').replace(/^v/, '')
  return version !== '' && version !== 'latest'
}

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

/**
 * For explicit versions, try Forgejo first and fall back to GitHub.
 */
async function tryDownloadWithFallback(
  version: string
): Promise<VersionSource> {
  if (await forgejoReleaseExists(version)) {
    return 'forgejo'
  }

  core.debug(`Forgejo does not have v${version}, falling back to GitHub`)
  return 'github'
}

/**
 * Resolve the stencil version, trying Forgejo first and falling back to GitHub.
 */
async function getVersion(): Promise<ResolvedVersion> {
  const version = core.getInput('version').replace(/^v/, '')
  if (version && version !== 'latest') {
    // Explicit version — will try Forgejo first at download time
    return { version, source: 'forgejo', explicit: true }
  }

  const prereleases = core.getBooleanInput('prereleases')
  if (prereleases) core.debug('prereleases will be considered')

  // Try Forgejo first
  core.debug(`Trying Forgejo at ${FORGEJO_URL} for latest version`)
  const forgejoVersion = await getForgejoVersion(FORGEJO_URL, prereleases)
  if (forgejoVersion) {
    core.info(`Found latest version ${forgejoVersion} on Forgejo`)
    return { version: forgejoVersion, source: 'forgejo', explicit: false }
  }

  // Fall back to GitHub
  core.debug('Forgejo unavailable, falling back to GitHub')
  const githubVersion = await getGitHubVersion(prereleases)
  core.info(`Found latest version ${githubVersion} on GitHub`)
  return { version: githubVersion, source: 'github', explicit: false }
}
