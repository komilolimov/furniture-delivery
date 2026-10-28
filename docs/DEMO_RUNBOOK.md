# Run the application locally

This guide covers a fresh checkout and two local startup options:

- **Isolated demo (recommended for reviewers):** a populated application with
  40 synthetic orders, 10 crews and accounts for all three roles.
- **Development:** the ordinary development database and `pnpm dev`.

[Demo startup](#4-start-the-isolated-demo) | [Role logins](#5-sign-in-and-review-the-roles) |
[Development](#7-optional-ordinary-development-mode) | [Troubleshooting](#8-troubleshooting)

The application has one Next.js frontend, one NestJS API and PostgreSQL. Docker
Compose starts PostgreSQL; the frontend and API run as separate Node.js processes.
The commands below are local startup instructions, not a cloud deployment guide.

All commands run from the repository root unless stated otherwise. Shell examples
use Bash on macOS/Linux. The demo lifecycle relies on POSIX process inspection and
private filesystem permissions. Native Windows/PowerShell is not covered; Windows
users need a Linux environment such as WSL2, with the checkout in its Linux
filesystem. A fresh WSL2 run has not been independently verified.

## 1. Prerequisites

| Tool        | Required version or condition                                      |
| ----------- | ------------------------------------------------------------------ |
| Git         | Available in the terminal                                          |
| Node.js     | **24.22.1**, pinned in `.nvmrc` and `.node-version`                |
| pnpm        | **10.34.8**, pinned in `package.json`                              |
| Docker      | Docker Engine/Desktop running, with Compose v2 supporting `--wait` |
| Local ports | `3000` and `3001` available; demo PostgreSQL defaults to `5433`    |

On macOS, `lsof` must be available for demo process identification. On Linux,
process identification uses `ps` and `/proc`. Keep the checkout in a normal local
folder: the demo rejects symlinked or incorrectly owned private run directories.

## 2. Clone and install

```bash
git clone https://github.com/komilolimov/furniture-delivery.git
cd furniture-delivery
```

If you already use `nvm`, install and select the pinned Node.js version:

```bash
nvm install
nvm use
```

Alternatively, select Node.js 24.22.1 with your existing version manager. Install
the pinned pnpm version and the project dependencies:

```bash
npm install --global pnpm@10.34.8
node --version
pnpm --version
pnpm install --frozen-lockfile
```

The version commands should report `v24.22.1` and `10.34.8` respectively.

## 3. Configure the local environment

Create `.env` only if it does not already exist:

```bash
if [ ! -e .env ] && [ ! -L .env ]; then
  cp .env.example .env
fi
```

Open `.env` in your editor. Replace **both** password placeholders:

- `DATABASE_PASSWORD`: choose your own local development database password.
- `TEST_DATABASE_PASSWORD`: choose a separate local test database password.

Compose validates configuration for both database services even when you start
only one of them. Keep an existing `.env` and existing database credentials;
changing an environment value does not change the password inside an already
initialized PostgreSQL volume.

For the demo, keep these non-secret settings from `.env.example`:

| Variable                 | Local demo configuration                                       |
| ------------------------ | -------------------------------------------------------------- |
| `NODE_ENV`               | `development`; do not set it to `production` for demo commands |
| `TEST_DATABASE_HOST`     | `127.0.0.1`                                                    |
| `TEST_DATABASE_PORT`     | `5433`                                                         |
| `TEST_DATABASE_NAME`     | `furniture_delivery_test`                                      |
| `TEST_DATABASE_USER`     | `furniture_test`                                               |
| `TEST_DATABASE_PASSWORD` | Your local value replacing the placeholder                     |

All five `TEST_DATABASE_*` settings are required. The test database name must end
in `_test` and differ from `DATABASE_NAME`. Demo accepts only a loopback database
host; it never falls back to the development database. Already exported process
variables take precedence over `.env`.

`.env` and generated credentials are ignored by Git. Do not put passwords in
command arguments, screenshots, public archives or reports. `SEED_PASSWORD` is
**not needed for the isolated demo**: its account passwords are generated locally.

## 4. Start the isolated demo

### Start PostgreSQL

Check that Docker Engine is running and validate Compose without printing
resolved environment values:

```bash
docker info --format '{{.ServerVersion}}'
docker compose version
docker compose config --quiet
docker compose --profile test up -d --wait postgres-test
```

Only the `postgres-test` service is needed for this path. Its persistent volume is
separate from development PostgreSQL. Do not remove either volume.

### Prepare the data

Use one run ID consistently. The examples use `demo-manual-01`:

```bash
pnpm demo:prepare --run demo-manual-01
```

Prepare builds the shared contracts, creates its own database schema, applies all
migrations there and prepares the synthetic workflows through domain operations.
There is no separate `db:migrate` or `db:seed` step for this path; those root
commands target ordinary development configuration.

A successful prepare creates:

- 40 synthetic orders at different workflow stages;
- 10 crews and 40 individual crew-member accounts;
- one `ADMIN` and one `DISPATCHER` account;
- private material files, generated demonstration signatures and a scenario manifest.

Run IDs contain 4-40 characters: the first is a lowercase letter, followed by
lowercase letters, digits, `_` or `-`.

A new run uses today's date in `Europe/Rome`. A new prepare before `00:02` in that
zone is rejected because the delay scenario needs real elapsed time. Optional
`--base-date YYYY-MM-DD` accepts only today's Rome date for a new run. Repeating an
old run keeps its original dates; use a new ID for a new day's demonstration.

### Launch the frontend and API

If another instance of this application occupies ports `3000` or `3001`, stop it
normally in its own terminal first. Demo refuses occupied ports; it does not kill
other processes.

```bash
pnpm demo:start --run demo-manual-01
```

Leave this terminal open. Start builds the frontend in its isolated output
directory, launches the owned Next.js and NestJS processes, checks readiness and
reports when they are ready. The first frontend build can take some time; inspect
the private application log if startup fails.

Open [the login page](http://127.0.0.1:3000/login). Use exactly this origin,
including `127.0.0.1`: Origin/CSRF checks are active.

| Address                                                              | Purpose                          |
| -------------------------------------------------------------------- | -------------------------------- |
| [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login)           | Sign in                          |
| [http://127.0.0.1:3000](http://127.0.0.1:3000)                       | Service status                   |
| [http://127.0.0.1:3001/api/health](http://127.0.0.1:3001/api/health) | Direct API/database health check |

The internal Next.js production build does **not** mean that you should export
`NODE_ENV=production`. The demo supervisor applies its own local HTTP cookie
configuration and always rejects production-mode demo commands.

## 5. Sign in and review the roles

Open this private local file in your editor:

```text
.demo-runs/demo-manual-01/credentials.local.json
```

Its `accounts` array contains `username`, `password`, `role`, `displayName` and,
for crew members, `crewCode`. Copy the username and password from the **same
account entry** into the login form. Do not print or commit this file.

| Role          | Generated usernames                                   | Landing page  | Main capabilities                                           |
| ------------- | ----------------------------------------------------- | ------------- | ----------------------------------------------------------- |
| `ADMIN`       | `demo.admin`                                          | `/backoffice` | All backoffice actions and account management               |
| `DISPATCHER`  | `demo.dispatcher`                                     | `/backoffice` | Orders, planning, crews, payments, issues and return visits |
| `CREW_MEMBER` | `demo.crew01.member01` through `demo.crew10.member04` | `/crew`       | Permitted work and the member's own teams                   |

Every demo account has its own generated initial password. Your colleague's or
the author's local passwords are not needed. Manual password changes are retained;
the initial credentials file can become outdated after such a change.

Use separate browser profiles for simultaneous roles, or explicitly sign out
before signing in as another role. Multiple tabs in one profile share the session.
For crew testing, choose an account whose `crewCode` matches the assignment you
want to review. Crew responses deliberately exclude financial and internal data.

For a short walkthrough:

1. Sign in as `ADMIN` or `DISPATCHER` and open Dashboard, Orders and Planning.
2. Open a planned visit and inspect its assigned crews and task snapshots.
3. Sign in as a member of an assigned crew and inspect that crew's work.
4. Use the scenario manifest below to explore partial work, a return visit or
   completion. Changes are real writes to the isolated demo schema and survive reload.

## 6. Stop, restart and retain your edits

Press `Ctrl+C` in the foreground demo terminal, or run this in a second terminal
from the same checkout:

```bash
pnpm demo:stop --run demo-manual-01
```

Stopping retains the database schema, private files, users, passwords and manual
changes. PostgreSQL remains running. To resume the same run:

```bash
pnpm demo:start --run demo-manual-01
```

No migration, seed or repeated prepare is required to preserve data across a
normal stop/start. Do not use cleanup as an ordinary stop command.

Repeating a successful prepare is also safe:

```bash
pnpm demo:prepare --run demo-manual-01
```

It verifies the existing owned resources and returns without replaying workflows,
rescheduling visits or resetting manual edits, passwords, payments or signatures.
A partial or failed prepare is not automatically resumed. Preserve its diagnostics;
use a new run ID or explicitly clean up only that owned failed run when appropriate.

## 7. Optional: ordinary development mode

Use this alternative when you want the normal development database and hot reload.
Stop the demo first; both modes use frontend/API ports `3000` and `3001`.
Development PostgreSQL defaults to `5432`; isolated demo/test PostgreSQL defaults
to `5433`.
Complete the clone/install/environment steps above, then run:

```bash
docker compose config --quiet
docker compose up -d --wait postgres
pnpm --filter @furniture-delivery/contracts build
pnpm db:migrate
```

For a new database, the seed needs a locally supplied initial account password of
12-128 characters. The following opens a Bash subshell so the hidden password
prompt also works when your usual shell is zsh:

```bash
bash
read -r -s -p 'Initial local account password (12-128 characters): ' SEED_PASSWORD
printf '\n'
export SEED_PASSWORD
pnpm db:seed
unset SEED_PASSWORD
exit
```

Then start the application from the repository root:

```bash
pnpm dev
```

Leave the terminal open and visit [the login page](http://127.0.0.1:3000/login).
The development seed creates `demo.admin`, `demo.dispatcher` and the 40
`demo.crewNN.memberNN` accounts. Newly created accounts use the supplied initial
password with individual password hashes. This differs from isolated demo prepare,
which generates an independent password for each account.

Repeated development seed does not reset existing passwords or user edits. If all
accounts already exist, `SEED_PASSWORD` is not needed. Change an existing password
through ADMIN account management, rather than expecting seed to reset it.
For a populated calendar and the prepared multi-stage scenarios, use the isolated
demo path. Ordinary seed does not schedule visits or assign crews automatically.

To return from development to an existing demo, stop `pnpm dev` with `Ctrl+C`,
start `postgres-test` if needed, and run `demo:start` with that demo's original ID.
Do not assume that an account password is the same in both databases.

## 8. Troubleshooting

| Symptom                                               | What to check                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `nvm: command not found`                              | Use your installed Node version manager or install Node.js 24.22.1 before continuing. `nvm` itself is not included in the repository.       |
| Docker/Compose cannot connect to the engine           | Start Docker Desktop/Engine first. Do not replace it with a temporary database as a workaround.                                             |
| Password placeholder or missing environment error     | Edit the root `.env`; replace both database password placeholders and keep all five test settings.                                          |
| PostgreSQL authentication fails after changing `.env` | Existing volumes retain their original database credentials. Restore the matching local settings; do not delete volumes to reset passwords. |
| Ports `3000` or `3001` are occupied                   | Stop the known application instance normally. Demo does not terminate another process.                                                      |
| Demo command rejects production mode                  | Keep local `NODE_ENV=development`; check exported variables as they override `.env`.                                                        |
| Demo target, ownership or permissions are rejected    | Use the original checkout/run and exact test target. Preserve owner markers and private permissions; do not bypass the guard.               |
| Login fails or returns an Origin error                | Open exactly `http://127.0.0.1:3000/login`, use the correct run's credentials and sign out before switching roles.                          |
| A new day's visits do not appear                      | An old run retains its original Rome date. Prepare a new unused run ID for today.                                                           |
| A failed prepare is rejected on retry                 | Automatic resume is intentionally unsupported. Inspect diagnostics and choose a new run or explicitly remove only the owned failed run.     |
| `pnpm start` is missing                               | Use `pnpm demo:start --run ...` for the demo or `pnpm dev` for development; there is no root `start` script.                                |

The private log is `.demo-runs/<run-id>/application.log`. Inspect it locally;
redact secrets before sharing. A health response is `200` when the API can execute
`SELECT 1`, or `503` when the database is unavailable. The UI distinguishes API and
database connection failures and provides Retry.

## 9. Prepared scenarios

Open `.demo-runs/demo-manual-01/manifest.json` locally. It records order numbers/UUIDs,
backoffice/crew links, assignments and the three scenarios below. The manifest
captures initial preparation; after edits, the API is the source of current state.

Initial prepared distribution:

| State                 | Orders |
| --------------------- | -----: |
| `INBOX`               |      8 |
| `PLANNED`             |      4 |
| `ASSIGNED`            |      9 |
| `IN_PROGRESS`         |      3 |
| `PARTIALLY_COMPLETED` |      6 |
| `AWAITING_REVIEW`     |      6 |
| `COMPLETED`           |      3 |
| `REQUIRES_ATTENTION`  |      1 |

1. **`two-crews-close`:** independent reports from two crews, shared quantities
   without double counting, a synthetic snapshot/confirmations and explicit closure.
2. **`delay-return`:** a current finish estimate and downstream risk, partial work,
   protected evidence/issue and explicit remaining scope with a follow-up tomorrow.
   Search, preview, rescheduling and further execution are manual review steps.
3. **`issue-reopens`:** an issue after closure reopens the order and preserves its
   history. Resolving the issue does not automatically complete the order again;
   readiness and an explicit Complete order action are still required.

Photos and signature images are generated fixtures, not real customers or
signatures. Extended crew working hours are synthetic demo settings, not a
company schedule. There is no visible demo banner; isolation and CLI/manifest
markers remain in place.

## 10. Optional programmatic verification

Use a separate, unused ID:

```bash
pnpm demo:verify --run demo-verify-01
```

Verify creates its own 40-order fixture, edits a synthetic INBOX order, repeats
prepare and compares domain rows and private-file digests, including materials.
It also measures three intentional dashboard reads. This is a programmatic check,
not browser E2E, physical-device testing or an event-storm benchmark. Its run remains
prepared until you explicitly clean it up.

Other available checks are:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

Integration tests require the separate `postgres-test` service and explicit
`TEST_DATABASE_*` settings. Stop application processes before a production build
if they use the same build output. These commands are optional for simply viewing
the isolated demo; `demo:start` performs its own frontend build.

## 11. Optional removal of one demo run

**Cleanup deletes that run's synthetic data and files.** Use it only when you no
longer need the run and have stopped it. Normal stop/start does not require cleanup.

```bash
pnpm demo:cleanup --run demo-manual-01
```

If you also created the optional verification run and no longer need it, clean it
up separately:

```bash
pnpm demo:cleanup --run demo-verify-01
```

Cleanup checks matching ownership markers and removes only that stopped run's
schema, private storage, credentials, manifest, application log and
`.next-demo/<run-id>` build. It refuses unowned or inconsistent resources.
It does not delete the shared PostgreSQL volume or unrelated fixtures.

Do not use `docker compose down -v`, volume pruning or shared-directory deletion
as demo cleanup. Before cleanup, save a separately redacted copy of the private
application log if you need it. Independent verification logs under `.tmp/m8/`
are not removed by demo cleanup.

## 12. Data boundaries, backup and remaining acceptance

Demo uses a separate test schema and private storage for each run. Development
orders, files and passwords remain separate. The frontend uses the existing Next
proxy to the API for the selected demo schema. Authentication, current
roles/memberships, Origin/CSRF and protected file reads remain active.

Run/storage directories use private mode `0700`; state/manifest/credentials/log
files use `0600`. Next builds into `apps/web/.next-demo/<run-id>`. Stop verifies
PID, start time, cwd and command, preventing accidental termination of a reused
PID. Moving a run to another checkout can invalidate its workspace ownership.

**Backup/restore: NOT VERIFIED.** A consistent backup needs both PostgreSQL and
private filesystem storage. Signature PNGs are stored in PostgreSQL; photos/PDFs
are in private files. If preserving a whole run, also protect its local credentials,
manifest, state, ownership markers, source version and path configuration.

The following is a proposed procedure, not an executed restore check:

1. Stop application writes before copying database rows or private files. Keep the
   PostgreSQL volume.
2. Take a logical PostgreSQL dump with a compatible `pg_dump` and a separate
   protected copy of private storage. Keep credentials out of command arguments
   and public archives/logs. Both copies must represent the same application state.
3. Restore into a separate local test database/schema and new private storage,
   never over development. Verify ownership, file permissions, explicit target
   configuration, record counts, protected photo/document/signature reads,
   readiness/history and synthetic-account logins before recording restore as PASS.
   The demo CLI does not bypass ownership checks for a relocated workspace.

SSE is best effort within one backend process, without durable replay/outbox or
replica support. HTTP/1 browser per-origin connection limits can cause many tabs
to fall back to bounded periodic refresh. Offline support, external integrations
and a legal assessment of signatures are outside this MVP.

M5 browser scenarios B/C, real phone/camera, touch/canvas and deferred M6-M8 UI
scenarios remain in [FINAL_ACCEPTANCE.md](FINAL_ACCEPTANCE.md). Starting the demo
or passing programmatic checks does not imply user acceptance. See
[PROGRESS.md](PROGRESS.md) for actual results and pending checks.

## Historical engineering evidence

These are recorded earlier runs, not checks repeated when this guide was translated.
Their `.tmp` logs are local engineering artifacts and are not shipped in GitHub.

- `.tmp/m8/20261026T192023Z/35-demo-verification.{json,log}`: exit `0`, 40 orders,
  10 crews and 42 users; manual edits and all row/file digests retained. Three
  dashboard reads took 152/96/96 ms in that run; this is not an SLA.
- `37-demo-lifecycle-start` identified owned PIDs/cwds/listeners and checked isolated
  health/login readiness. `38-demo-lifecycle-stop` and `39-demo-lifecycle-cleanup`
  exited `0`. These results do not establish browser or phone acceptance.
- After the final privacy change, clean frozen install/build/verify runs `72-74`
  and start/stop/cleanup runs `75-77` all exited `0`. The isolated verification copy
  began without `node_modules`, `.next`, `dist`, `.env` or private runs and matched
  the final-ready source manifest. Its child log is
  `.tmp/m8/20261026T192023Z/clean-demo-application.log`, with credentials redacted.
- The historical M8 report recorded 474 unit/component and 210 integration tests
  plus proxy/load results. Later runs are tracked separately in
  [PROGRESS.md](PROGRESS.md); historical totals are not new verification results.
