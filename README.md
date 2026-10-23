# FYP Compass

A final year project supervision portal for students, supervisors, examiners and coordinators. Includes proposals, supervisor allocation, milestones, contributions, similarity evidence, deterministic project health, advisory Gemini assistants, assessment, results and reporting.

Live website: https://fyp-compass-ten.vercel.app/

## Source and configuration

This is the sanitized source repository. API keys, real login credentials, owner account details, database backups, deployment credentials and internal audit logs are intentionally absent. No production data is seeded by CI. Configure credentials privately for your own deployment; never commit them, even to a private branch.

## Local setup

Use Node.js 24 and run `npm ci`. Copy `.env.example` to `.env` and fill the browser configuration locally. Server credentials belong only in the deployment provider's secret store; see [server environment](docs/SERVER-ENVIRONMENT.md).

For an isolated UI demonstration, copy `.env.demo.example` to `.env.demo` and run `npm run dev:demo`. This mode does not log in to the production database. For the loopback PostgreSQL harness, install `npm ci --prefix backend/local-tests`, copy `.env.localbackend.example` to `.env.localbackend`, run `npm run local:server`, and use `npm run dev:local` in another terminal.

## Validation

```sh
npm run lint
npm test -- --maxWorkers=1
npm run test:cloud
npm run test:email
npm run test:accounts
npm run db:check
npm run test:database
npm run build:demo
```

Database tests run isolated fixtures, not production queries. The canonical migration order is in `supabase/migration-order.json`. The fresh-database installer must never be replayed over an existing deployment. Browser tests can be run manually with `npm run test:e2e` after installing the Playwright browsers.

## Security and contribution

Read [SECURITY.md](SECURITY.md) before reporting an issue and [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) before pushing. CI uses immutable action commits, read-only tokens, a checksum-pinned secret scanner and isolated test data. Production deployment requires a separate explicit setup; this repository has no deployment tokens or automatic production deploy workflow.

Enable the local push guard with `git config core.hooksPath .githooks` and install Gitleaks on your PATH. The hook fails closed if the scanner is unavailable. Native GitHub push protection and branch checks complement local scanning; no scanner detects every possible secret.

## Project documentation

The six public context files have distinct roles: [architecture](context/Architecture.md), [phases](context/Phases.md), [database](context/Database.md), [AI prompts](context/Prompts.md), [security boundaries](context/Security.md), and [error handling](context/Error-handling.md). The live system has additional owner-controlled operational records which are not published here.


## Client demonstration and original acceptance cases

Use Node 24. Install dependencies with `npm ci --ignore-scripts` and `npm ci --prefix backend/local-tests --ignore-scripts`. Run `npm run demo:local`, then open http://127.0.0.1:5182. Choose one of the nine local accounts on the login page. The complete production SQL schema and private local files persist under `.private/local-backend-full`. Stop with Ctrl+C so the database closes cleanly. If the default ports are in use, set `FYP_LOCAL_WEB_PORT` and `FYP_LOCAL_API_PORT` to two different free ports.

This local mode isolates demonstration data. Cloud students use verified signup and their own accounts at https://fyp-compass-ten.vercel.app. Production secrets are not included in the source package. Without private server Gemini configuration, local health uses the required labeled fallback; other model agents clearly report that configuration is missing.

The unsplit original PRD and all ten detailed acceptance cases are in `docs/ORIGINAL-MVP-PRD.md` and `docs/ORIGINAL-TEN-ACCEPTANCE-CASES.md`. Run the frontend, database, local HTTP and three-engine browser suites using the package scripts. `scripts/audit-ten-cases.mjs --verify-existing` consumes executed raw evidence, checks every frontend test file and requires the complete workflow and connected browser audit; it will not count a missing report as a pass.

For the connected acceptance audit, use a fresh local database: start `npm run demo:local`, run `npm run seed:local-audit`, then `npm run test:local-browser`. Run `npm run test:e2e`, followed by `npm run test:mvp`. The seed refuses to replace existing demonstration data. Non-default loopback addresses can be supplied through `FYP_LOCAL_WEB_URL` and `FYP_LOCAL_API_URL`. Raw failures are retained; repeat reports identify an actual rerun rather than changing a failing result.

Run `npm run test:report-print` against the same seeded local stack to verify the real full-report link, exact final marks and browser print lifecycle. It saves a readable sample PDF and implementation-bound evidence under the ignored verification folder. The original acceptance gate requires this check; the paginated summary is not accepted as a substitute for the complete printable report.
