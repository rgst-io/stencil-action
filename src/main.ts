import * as core from '@actions/core'
import * as io from '@actions/io'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

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

    core.info(`Using stencil@${version}`)

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

    const downloadURL = `https://github.com/rgst-io/stencil/releases/download/v${version}/stencil_${version}_${osName}_${osArch}.tar.gz`
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stencil-action-'))
    const tempArchive = path.join(tempDir, 'stencil.tar.gz')

    core.info(`Downloading stencil from ${downloadURL} to ${tempDir}`)
    await exec.exec('curl', ['-fsSL', downloadURL, '--output', tempArchive])

    core.info('Verifying archive attestation')
    await verifyArchiveAttestation(tempArchive)

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

async function getVersion(): Promise<string> {
  const version = core.getInput('version').replace(/^v/, '')
  if (version && version !== 'latest') {
    return version
  }

  const octokit = github.getOctokit(core.getInput('github-token'))

  const releases = await octokit.rest.repos.listReleases({
    owner: 'rgst-io',
    repo: 'stencil'
  })
  if (releases.data.length === 0) {
    throw new Error('No releases found')
  }

  return releases.data[0].tag_name.replace(/^v/, '')
}

async function verifyArchiveAttestation(archivePath: string): Promise<void> {
  const githubToken = core.getInput('github-token')

  await exec.exec(
    'gh',
    ['attestation', 'verify','--deny-self-hosted-runners', '--repo', 'rgst-io/stencil', archivePath],
    {
      env: {
        GH_TOKEN: githubToken
      }
    }
  )
}
