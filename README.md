# stencil-action

[![GitHub Super-Linter](https://github.com/rgst-io/stencil-action/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/rgst-io/stencil-action/actions/workflows/ci.yml/badge.svg)
[![Check dist/](https://github.com/rgst-io/stencil-action/actions/workflows/check-dist.yml/badge.svg)](https://github.com/rgst-io/stencil-action/actions/workflows/check-dist.yml)
[![CodeQL](https://github.com/rgst-io/stencil-action/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/rgst-io/stencil-action/actions/workflows/codeql-analysis.yml)
[![Coverage](./badges/coverage.svg)](./badges/coverage.svg)

## Usage

Currently, the only functionality exposed is to install `stencil` for usage in
other steps.

```yaml
steps:
  - name: Checkout
    id: checkout
    uses: actions/checkout@v4

  - name: Install Stencil
    uses: rgst-io/stencil-action@latest
    with:
      # Used for attestation validation and when version is 'latest'.
      github-token: ${{ github.token }}
      # Optional: Version of stencil to install.
      version: 'latest'
      # Optional: Location to install stencil to. Automatically added
      # to the $PATH.
      binary-dir: '~/.local/bin'

  - name: Use Stencil
    run: stencil --version
```

## Publishing a New Release

This project includes a helper script, [`script/release`](./script/release)
designed to streamline the process of tagging and pushing new releases for
GitHub Actions.

GitHub Actions allows users to select a specific version of the action to use,
based on release tags. This script simplifies this process by performing the
following steps:

1. **Retrieving the latest release tag:** The script starts by fetching the most
   recent SemVer release tag of the current branch, by looking at the local data
   available in your repository.
1. **Prompting for a new release tag:** The user is then prompted to enter a new
   release tag. To assist with this, the script displays the tag retrieved in
   the previous step, and validates the format of the inputted tag (vX.X.X). The
   user is also reminded to update the version field in package.json.
1. **Tagging the new release:** The script then tags a new release and syncs the
   separate major tag (e.g. v1, v2) with the new release tag (e.g. v1.0.0,
   v2.1.2). When the user is creating a new major release, the script
   auto-detects this and creates a `releases/v#` branch for the previous major
   version.
1. **Pushing changes to remote:** Finally, the script pushes the necessary
   commits, tags and branches to the remote repository. From here, you will need
   to create a new release in GitHub so users can easily reference the new tags
   in their workflows.
