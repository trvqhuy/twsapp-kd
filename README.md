# Hybrid Bot

## Local development

- Install dependencies: `npm install`
- Start the app: `npm run start`
- Build backend binary (optional for local testing): `npm run build:backend`

## Packaging

- Windows/Linux builds are produced by `electron-builder`.
- The backend is bundled as a native executable built by PyInstaller.
- Build backend locally: `npm run build:backend`
- Package locally: `npm run dist`

## Releases and updates

- Releases are automated via GitHub Actions on `main`.
- `semantic-release` computes the next version and creates a GitHub release.
- The build jobs package the app for Windows and Linux and publish artifacts to the release.
- The app only checks for updates when the user clicks "Check for Updates" in the System Console.
- Updates are downloaded and installed after a restart.
- Use Conventional Commits (e.g. `feat: ...`, `fix: ...`) to trigger version bumps.
- Set `GH_TOKEN` in repo secrets for release automation.

## Installation

Download the latest release from GitHub Releases.

### Windows

- Download the `HybridBot-*.exe` (NSIS installer).
- Run the installer and follow the prompts.
- If SmartScreen appears, click "More info" → "Run anyway" (unsigned build).
- Launch from the Start Menu after install.
- Updates: open System Console → "Check for Updates" → "Download Update" → "Restart & Install".

### Ubuntu

- Download the `HybridBot-*.AppImage` file.
- Make it executable:

```bash
chmod +x "HybridBot-*.AppImage"
```

- Run it:

```bash
./"HybridBot-*.AppImage"
```

- Optional: integrate with the desktop by using an AppImage launcher.
- Updates: open System Console → "Check for Updates" → "Download Update" → "Restart & Install".

## Requirements

- Node.js 20
- Python 3.12 (for backend packaging)
