# Codespaces and local Supabase

This note records environment behavior that was actually observed in the project
Codespace. Recheck it when the Docker daemon, Supabase CLI, or runtime image
changes; do not assume every developer has the same network restrictions.

## Local Supabase startup

The Supabase CLI is `2.122.0` in the environment where these notes were
confirmed. `npx supabase start`, including `--exclude realtime,...`, fails
during `Initialising schema...`: the CLI starts a temporary Realtime migration
container, which resolves the Postgres service name but times out opening
Postgres TCP port `5432`. The Postgres container reports healthy and listens on
`0.0.0.0:5432`, but that does not prove that the migration container can reach
it.
The CLI's `--experimental` startup mode and `supabase db start` hit the same
temporary-migrator failure; excluding the long-lived Realtime service does not
skip the schema migration.

The same limitation was reproduced with a separate Postgres container and a
probe container on both the default bridge subnet and a separate
`192.168.241.0/24` bridge. In contrast, a Postgres container's published port
was reachable from the Codespace host. Treat this as a Docker bridge networking
limitation in this environment, not evidence that the app's Supabase
configuration is wrong.

It was reproduced again on 2026-10-27: the temporary Realtime migrator resolved
`db` to the healthy Postgres container on the same Docker bridge, but its
database connection timed out. A fresh PostgreSQL probe container on that same
bridge also returned `no response` from `pg_isready -h db -p 5432`. The Codespace
cannot inspect or change the Docker host's forwarding firewall (`iptables`
returns `Permission denied`), so enabling bridge forwarding from inside the
workspace is not available. Do not edit Supabase or application configuration
to mask this host-level failure.

### Diagnose before retrying

1. Capture the startup log and inspect the temporary migrator while it is still
   running. Check service DNS (`getent hosts db`) and TCP connectivity
   (`pg_isready -h db -p 5432 -t 2`); DNS resolution and container health alone
   are insufficient.
2. Check whether a separate container on the same bridge can reach a disposable
   Postgres instance. If that also times out, avoid repeatedly retrying the
   Supabase CLI without changing the Docker networking or runtime.
3. `npx supabase db start` uses the same schema-initialization path and does not
   avoid the temporary Realtime migrator.
4. `npx supabase start --network-id host` is not a workaround here: the CLI
   requires network-scoped aliases, which Docker's built-in `host` network
   does not support.
5. A bridge container can connect through the Docker host gateway to a
   published Postgres port when `host.docker.internal` is explicitly mapped.
   This is useful for isolated migration and SQL/RPC checks, but does **not**
   make the Supabase Auth/REST stack or end-to-end app integration available.
6. This host-gateway probe does not unblock the Supabase CLI: its temporary
   Realtime migrator connects to the hostname `db`, and Docker manages the
   migrator's `/etc/hosts` as a read-only mount. `docker exec` cannot edit it,
   and `docker cp` cannot replace it (`device or resource busy`). Do not try to
   redirect the CLI this way unless its container supports an explicit
   `--add-host` mapping.
7. Trying a different non-overlapping bridge subnet did not restore
   container-to-container TCP. Do not spend time repeating the probe with more
   arbitrary subnets unless the Docker daemon/network policy changes.

Do not silently edit Supabase configuration or claim a full local stack is
running to work around this host-level limitation. Resume full-stack testing
when Docker bridge connectivity works or use an explicitly configured local
Supabase environment.

### Compose local app and Supabase-compatible services

On 2026-10-27, a minimal replacement was verified using Docker host networking:
host-network containers can communicate with one another and the Codespace
loopback, while the Supabase CLI cannot use host networking because it requires
network-scoped aliases. Start this project-specific stack with:

```sh
./start.sh
```

It runs the Supabase PostgreSQL image, PostgREST, GoTrue Auth, an Nginx API
gateway, and the app. It binds to loopback ports `5432` (Postgres), `54321`
(Supabase REST/Auth), and `8080` (Vite app), applies the Drizzle migrations, and
was verified with HTTP health checks, actual GoTrue signup and admin cleanup,
and a create/list/delete round-trip for a synthetic encrypted provider key.
All 10 Playwright browser E2E tests passed against the configured stack;
37 unit tests, production build, and Drizzle migration checks passed. The stack
has Docker-native endpoint healthchecks for Postgres, PostgREST, GoTrue,
gateway, and the app; `local-up` waits for them and independently probes app
and REST/Auth URLs before reporting readiness. The stack is deliberately
minimal: it does not include Supabase Studio, Storage, Realtime, or Edge Functions and is
not the full `supabase start` stack. The root `start.sh` script calls this
startup flow and then explicitly verifies PostgreSQL TCP, API gateway health,
app health, same-origin Auth proxy health, and Docker health status for all
five services. It reports failure rather than a ready message if any check
fails. It cannot verify Codespaces browser forwarding; port `8080` must still
be forwarded in the VS Code Ports panel.

The PostgREST upstream image is a minimal shell-less image. Do not copy the
BusyBox executable into it and assume it will run: the BusyBox binary from the
standard image needs a dynamic loader that the upstream filesystem lacks, and
Docker reports `exec /bin/busybox: no such file or directory`. Instead,
`docker/postgrest-health.Dockerfile` uses BusyBox as the runtime base and copies
the PostgREST binary into it; this provides a working HTTP healthcheck utility
without needing a shell inside the PostgREST container. The Compose healthcheck
for PostgREST probes its root OpenAPI response; the other services use their
native installed probes.

The command generates `.env.local-supabase` with mode `0600`; it is gitignored
and contains local-only passwords, signing keys, and management credentials.
Keep this file while retaining the named Postgres volume, as the database
password must match the one used when the volume was initialized. Stop services
with `./docker/manage.sh local-down`; this retains database data.
`./docker/manage.sh local-down --volumes` removes the database volume.
`./docker/manage.sh local-logs` follows service logs.

On a regular Docker host, the browser app defaults to
`http://127.0.0.1:8080`; the local REST/Auth API gateway listens at
`http://127.0.0.1:54321`. Browser Supabase Auth is proxied through the app's
same-origin `/auth/v1` path, avoiding a separate browser connection to port
`54321`. In Codespaces, the helper derives a candidate public app URL from
`CODESPACE_NAME` and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, but this is not
evidence that the proxy has forwarded the port. `local-up` verifies local app
and REST/Auth health only. Open the VS Code Ports panel, confirm port `8080` is
forwarded, and use the browse URL shown there. Do not send a guessed URL as
verified. Port `9999` is GoTrue's internal
Auth listener, not the web app, and its root path returns 404. `SUPABASE_URL`
remains loopback for server-side requests. After changing URLs, `local-up`
recreates Auth/web services so their redirect allowlist and Vite client
configuration take effect.

#### Verify Codespaces port access before sharing a URL

On 2026-10-27, local `http://127.0.0.1:8080/health` returned HTTP 200 while
both derived external URLs for ports `8080` and `54321` returned HTTP 404. The
GitHub CLI could not inspect the Codespace's forwarded-port list because this
session lacks GitHub authentication (`gh codespace ports` requested the
`codespace` auth scope). Therefore external access was not verified from the
workspace. Check the actual forwarded-port state and browse URL in VS Code's
Ports panel before telling a user a public URL works. If no port is forwarded,
forward `8080`. A local health check or generated URL cannot substitute for
this external check.

The public Auth endpoint `https://<codespace>-54321.app.github.dev/auth/v1/health`
was probed and returned an empty HTTP 404 from the Codespaces tunnel even while
local gateway/Auth health probes returned 200. Signup also produced
`AuthRetryableFetchError` with status 0, confirming the browser could not
establish an HTTP request to the separate forwarded port. The local Compose
configuration now points the browser client at the app's port 8080 and proxies
`/auth/v1` to the healthy local gateway. This same-origin path avoids the
separate port forwarding and cross-origin request. Local Docker health still
does not prove the public app port is forwarded; check the Ports panel. The
account page renders structured Auth errors and the request URL.

The failed full Supabase CLI retries accumulated large images. A targeted
cleanup of unused Supabase components (Studio, Storage, Realtime, Edge Runtime,
Logflare, and related services) freed about 6 GB while retaining Postgres,
PostgREST, GoTrue, Nginx, and the Playwright image. Avoid `docker system prune`
or broad image pruning while development images are still needed.

## Disposable migration checks

The official Supabase Postgres image can be used to validate ordered Drizzle
migrations and database functions in isolation:

- Wait for the container's health status to become `healthy`; the initial
  `pg_isready` success can occur during image initialization, before its
  initialization script has shut down the bootstrap server.
- Use the `supabase_admin` role for Supabase-owned schemas. The `postgres` role
  is not a superuser in this image, and `auth` is owned by `supabase_admin`.
- On a pristine image, PostgreSQL GraphQL DDL event triggers can reference a
  schema version sequence that has not been initialized. Disabling those
  triggers is acceptable only inside a disposable migration-test database; do
  not apply that workaround to a real Supabase project.
- Apply migrations in lexical order and use `psql -v ON_ERROR_STOP=1`.
  Exercise the important RPCs and grants, not just migration syntax.
- Use synthetic keys only and delete only the explicitly named temporary
  containers and networks created by the check.

This verifies the SQL and RPC behavior, not persistence across a Supabase
service restart, PostgREST/Auth integration, or provider audio synthesis.
Real synthesis requires a deliberately configured provider credential; never
print or commit one.

## Project commands

```sh
npx supabase start
npm run dev
npm test
npm run build
npx drizzle-kit check
```

The CLI's generated `supabase/.temp/` state is ignored by Git. Do not commit it.

## HTTP smoke tests and production preview

`npm run dev -- --host 127.0.0.1` was verified to serve the app, `/docs`, and
`/api/public/openapi.json`. Use it for local HTTP smoke checks in this
Codespace.

`npm run build` succeeds and emits the Nitro/Cloudflare worker under `.output/`.
However, `npm run preview` (`vite preview`) currently fails because the
TanStack preview plugin looks for `dist/server/server.js`, which this build
does not produce. Do not treat that preview error as an application route
failure or repeatedly retry the same command. Production artifact runtime
verification needs a preview command that targets the configured Cloudflare
output; until then, report build validation and dev-server HTTP validation
separately.

## Browser end-to-end tests

Run the Playwright browser suite in the pinned official browser container:

```sh
./docker/manage.sh e2e
```

The Playwright container starts the Vite app and browser in the same container,
so this test does not depend on Docker bridge connectivity to another app
container or the host. Docker Compose build contexts and bind mounts are
resolved relative to the configured project directory in this setup; with
`--project-directory` at the repository root, use `context: .`,
`dockerfile: docker/Dockerfile`, and an explicit repository-root-relative
artifact path. When the test process runs as the Playwright image's non-root
user, ensure `/workspace/node_modules/.vite` is writable; `npm ci` creates the
directory as root, and Vite's optimizer otherwise fails to write its cache.
The Docker runner must build the image before `compose run` so Dockerfile
permission fixes and test-source changes are not silently tested with a stale
image.
