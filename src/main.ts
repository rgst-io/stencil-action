import * as core from '@actions/core'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

import {
  downloadFile,
  getCdnAssetUrl,
  getLatestVersion,
  verifyArchiveGpgSignature
} from './cdn.js'

type GoPlatform = 'windows' | 'darwin' | 'linux'
type GoArch = 'amd64' | '386' | 'arm64' | 'armv6' | `ppc64`

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const version = await getVersion()
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

    core.info(`Using stencil@${version}`)

    const archiveName = `stencil_${version}_${osName}_${osArch}.tar.gz`
    const downloadURL = getCdnAssetUrl(version, archiveName)

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-action-'))
    const tempArchive = path.join(tempDir, 'stencil.tar.gz')
    const tempSig = path.join(tempDir, 'stencil.tar.gz.sig')

    core.info(`Downloading stencil from ${downloadURL} to ${tempDir}`)
    await downloadFile(downloadURL, tempArchive)
    await downloadFile(`${downloadURL}.sig`, tempSig)

    core.info('Verifying archive GPG signature')
    await verifyArchiveGpgSignature(tempArchive, tempSig)

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

/**
 * Resolve the stencil version to install. 'latest' (or no version) is looked
 * up from the CDN.
 */
async function getVersion(): Promise<string> {
  const version = core.getInput('version').replace(/^v/, '')
  if (version && version !== 'latest') {
    return version
  }

  const prereleases = core.getBooleanInput('prereleases')
  if (prereleases) core.debug('prereleases will be considered')

  const latest = await getLatestVersion(prereleases)
  core.info(`Found latest version ${latest}`)
  return latest
}
