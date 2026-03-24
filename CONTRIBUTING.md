\# Contributing



Thanks for contributing! ðŸŽ‰



\## Prereqs

\- Python 3.12+

\- `pre-commit` installed (`pip install pre-commit` then `pre-commit install`)

\- Run `pip install -r requirements.txt` (and/or `dev-requirements.txt` if present)



\## Branching

\- Create feature branches from `main`: `feat/â€¦`, `fix/â€¦`, `docs/â€¦`

\- Keep PRs small and focused.



\## Checks

\- Run linters/formatters: `pre-commit run --all-files`

\- Run tests locally: `pytest -q`

\- CI must pass before merge.



\## Commits

\- Write clear, imperative messages:

&nbsp; - `feat(auth): add refresh token endpoint`

&nbsp; - `fix(events): return 200 on single-date create`



\## Pull Requests

\- Fill out the PR template.

\- Link issues (e.g., `Closes #123`)

\- Screenshots for UI/API responses when helpful.



\## DB vs In-Memory

\- Tests default to in-memory (`USE\_DB=0`).

\- For DB flows: set `USE\_DB=1` and export a `DATABASE\_URL` compatible with your driver.



\## Code Style

\- `black`, `isort` (profile: black)

\- Follow existing patterns in `main.py` and `app/routers/\*`.



\## Migrations

\- If changing models, add Alembic migrations and run locally against Postgres.
