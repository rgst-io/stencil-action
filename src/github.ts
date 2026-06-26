import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'

const REPO_OWNER = 'rgst-io'
const REPO_NAME = 'stencil'

// ── GitHub API ─────────────────────────────────────────────────────────────────

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
 * Fetch the release from GitHub and find the asset download URL by filename.
 */
export async function getGitHubAssetUrl(
  version: string,
  fileName: string
): Promise<string | null> {
  const octokit = github.getOctokit(core.getInput('github-token'))
  const response = await octokit.rest.repos.getReleaseByTag({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    tag: `v${version}`
  })
  const assets = response.data.assets ?? []
  return findAssetUrl(assets, fileName)
}

/**
 * Fetch the latest stencil version from GitHub.
 */
export async function getGitHubVersion(prereleases: boolean): Promise<string> {
  const octokit = github.getOctokit(core.getInput('github-token'))
  const releases = await octokit.rest.repos.listReleases({
    owner: REPO_OWNER,
    repo: REPO_NAME
  })

  if (releases.data.length === 0) {
    throw new Error('No releases found')
  }

  // Find the first non-prerelease release
  for (const release of releases.data) {
    // If we're not considering prereleases, but this release is a
    // prerelease then we should skip it.
    if (!prereleases && release.prerelease) continue
    return release.tag_name.replace(/^v/, '')
  }

  // Didn't find a release somehow.
  throw new Error('Failed to find a release')
}

// ── Attestation Verification ───────────────────────────────────────────────────

/**
 * Verify the archive using GitHub attestation.
 */
export async function verifyArchiveAttestation(
  archivePath: string
): Promise<void> {
  const githubToken = core.getInput('github-token')

  await exec.exec(
    'gh',
    [
      'attestation',
      'verify',
      '--deny-self-hosted-runners',
      '--repo',
      `${REPO_OWNER}/${REPO_NAME}`,
      archivePath
    ],
    {
      env: {
        GH_TOKEN: githubToken
      }
    }
  )
}
