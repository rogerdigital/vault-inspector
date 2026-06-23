# Contributing

## Setup

```bash
git clone https://github.com/rogerdigital/vault-inspector.git
cd vault-inspector
npm install
```

## Development

```bash
npm run dev                 # watch mode
npm run lint                # eslint
npm run lint:obsidian-warnings # Obsidian review warning checks
npm run build               # production build
npm test                    # run tests
```

## Pull Requests

1. Fork the repo and create a branch from `main` (`feat/`, `fix/`, `chore/`)
2. Make changes, ensure `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test` pass
3. Use conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`)
4. Open a PR against `main`

## Guidelines

- Keep changes focused — one concern per PR
- Scanners go in `src/scanner/scanners/`, each in its own file
- No direct `app.*` calls in scanner logic — use `ScanContext`
- Run lint + build + tests before pushing; CI enforces this. Full check: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`
