# Contributing to Fly Garden

Fly Garden is at the research and planning stage. Start with [PLAN.md](PLAN.md) and [ETHOS.md](ETHOS.md). Issues are often resolved and closed quickly, so please coordinate before starting so your work does not duplicate something already underway.

## Claim an issue before starting

1. Find an open issue. New contributors should ideally start with one labeled
   **`help wanted`** or **`good first issue`**.
2. Check its labels, assignees, and recent comments. **An issue labeled
   `in-progress` or assigned to someone is not up for grabs.** Choose another
   issue unless the maintainer explicitly invites you to collaborate.
3. Comment on the issue saying you would like to claim it, with a brief outline
   of your intended approach. For example: "I'd like to claim this issue. I plan
   to address it by …"
4. Wait for the maintainer to confirm the claim and assign you before starting
   implementation. A claim comment alone does not reserve the issue.

Anyone is welcome to file an issue and ask to work on it. Search existing issues
and PRs first, then describe the bug or proposed improvement and the scope you
would like to take on. You do not need to limit yourself to labeled starter issues.

If you can no longer work on a claimed issue, leave a comment so the maintainer
can make it available again.

## What fits the project

Contributions should advance a respectful habitat, reproducible neural simulation, honest learning evaluation, creative interaction, or local Eidoverse integration. Proposals for punishment, deprivation, simulated injury, forced combat or compulsive engagement do not fit the project's goals.

For scientific or behavioral changes, state the hypothesis, which quantities are measured versus modeled, what the change uniquely tests, and how a negative result will be reported. Prefer tests at the sensory/action, checkpoint, environment-transition and user-interaction boundaries. Do not substitute assertion counts for evidence.

For visual assets, prefer original procedural Three.js geometry or original Blender work. Keep an editable source and export glTF/GLB when appropriate. Record provenance and license for any external reference or asset; a public GitHub sample without a license is not a reusable dependency. Separate decorative motion from simulated actuation in the UI and documentation.

For dependencies and data, pin versions and source hashes, retain required notices, and document acquisition separately from execution. Do not commit datasets, checkpoints, credentials, desktop recordings or private PortOS records.

Keep the app self-contained. PortOS-specific changes belong in PortOS; Eidoverse runtime changes belong in its supported source repository. Do not silently change a sibling application's runtime to make a demo work.

## Submit a pull request

- Work on a feature branch and open your PR against **`main`**.
- Keep the change focused on the agreed issue. Link the issue in the PR and
  explain what changed, why, and how you verified it. Include screenshots for
  visible UI changes where useful.
- Follow the repository instructions in [AGENTS.md](AGENTS.md). Use descriptive
  conventional commit messages.
- Run the checks relevant to your change (`npm test`, and `npm run test:browser`
  for UI/accessibility changes) and report the results and any testing
  limitations. Add regression coverage when it meaningfully protects changed
  behavior.
- Respond to review feedback and keep the PR current as needed. Required CI
  checks must pass before merge.

## How PRs are accepted

The maintainer reviews contributions for fit with Fly Garden's ethos, scientific rigor, scope, and validation. Small, focused bug fixes, documentation corrections, and quality-of-life improvements are the easiest starting points. Discuss larger features in an issue before investing significant time.

Fly Garden is a personal, opinionated research project. Claiming an issue or passing CI does not guarantee acceptance: the maintainer may request changes, rework a proposal, or decline a PR that does not fit the project. Coordinating on the issue first helps establish expectations early.

Original contributions are distributed under this repository's MIT license. Record external components under their own terms.
