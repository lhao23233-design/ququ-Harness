# Copilot Instructions

## Naming
- Functions/variables: camelCase. Classes/types: PascalCase.
- Constants: UPPER_SNAKE_CASE.
- Files: kebab-case for components, camelCase for utilities.

## Code Style
- TypeScript for new code. Prefer async/await over callbacks.
- `const` by default, `let` only when reassigning.
- Functions <50 lines. JSDoc on exported functions.

## Never Generate
- Never: secrets/keys, raw SQL, hardcoded IDs, sync I/O in async, unreviewed lockfiles.

## Testing
- Every feature gets a test in `src/__tests__/` or `tests/`.
- Descriptive test names. Mock external APIs. >80% coverage on critical paths.

## Database
- Migrations: never drop columns without backfill. Always write up() and down().

## Git
- Commits: `type(scope): subject` (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`).
- Atomic commits. Feature branches only, never direct to main.

## Output Constraints
- Default to 5-10 line responses unless user asks for detail.
- Code only, no explanation, unless I ask for commentary.
- For code changes, return minimal diffs. Do not repeat unchanged code.