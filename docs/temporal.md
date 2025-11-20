# Temporal Worker (Base Scaffold)

This package (`@relay/temporal-worker`) provides a minimal Temporal worker scaffold and a hello-world workflow to validate connectivity. It is a starting point for wiring the scan pipeline into Temporal.

## Environment

Required/optional env vars:

- `TEMPORAL_ADDRESS` (default: `localhost:7233`)
- `TEMPORAL_NAMESPACE` (default: `default`)
- `TEMPORAL_TASK_QUEUE` (default: `relay-scan`)
- `TEMPORAL_API_KEY` (for Temporal Cloud API-key auth)
- TLS options (Temporal Cloud):
  - `TEMPORAL_TLS_SERVER_NAME` (e.g., `us-east-1.aws.api.temporal.io`)
  - Optional mTLS: `TEMPORAL_TLS_CERT_PATH`, `TEMPORAL_TLS_KEY_PATH`, `TEMPORAL_TLS_CA_PATH`

Local Temporal can be started via the Temporal CLI (`temporal server start-dev`) or Temporal Cloud using the provided address/namespace.

## Commands

- `pnpm --filter @relay/temporal-worker dev` – start the worker (connects to `TEMPORAL_ADDRESS`, registers workflows/activities in `src/workflows`, `src/activities`).
- `pnpm --filter @relay/temporal-worker build` – build worker to `dist/`.
- `pnpm --filter @relay/temporal-worker start` – run built worker (`dist/worker.js`).
- `pnpm --filter @relay/temporal-worker health` – simple connectivity healthcheck (connects to Temporal and exits 0/1).
- `pnpm --filter @relay/temporal-worker typecheck` – TypeScript typecheck.
- `pnpm --filter @relay/temporal-worker test` – run lightweight unit tests (hello workflow stub).
- The web API starts `startScanWorkflow` via `/api/scan`, so web needs the same Temporal env vars (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`).

## Structure

- `src/workflows/hello.workflow.ts` – sample workflow using `proxyActivities`.
- `src/activities/hello.ts` – sample activity implementation.
- `src/worker.ts` – worker entrypoint that connects and runs with configured namespace/task queue.
- `src/healthcheck.ts` – connectivity probe usable as a container healthcheck.

## Next steps

- Add real workflows/activities (e.g., scan orchestration from `convex/scanPipeline.ts`).
- Consider Dockerfile/Procfile for deployment and add monitoring/health checks per issue #21.

## Deployment (Temporal worker)

- Docker image: `packages/temporal-worker/Dockerfile` builds the worker. Build from repo root:
  - `docker build -f packages/temporal-worker/Dockerfile -t relay-temporal-worker .`
- Runtime command: `node packages/temporal-worker/dist/worker.js` (default in Docker CMD).
- Required envs:
  - `TEMPORAL_ADDRESS` (e.g., `us-east-1.aws.api.temporal.io:7233`)
  - `TEMPORAL_NAMESPACE`
  - `TEMPORAL_TASK_QUEUE` (e.g., `relay-scan`)
  - `TEMPORAL_API_KEY` (Temporal Cloud API key)
  - Optional TLS overrides: `TEMPORAL_TLS_SERVER_NAME`, and mTLS (`TEMPORAL_TLS_CERT_PATH`, `TEMPORAL_TLS_KEY_PATH`, `TEMPORAL_TLS_CA_PATH`) if needed.
  - Convex/OpenAI/Gmail envs reused by scan pipeline (same as app).
- Healthcheck: `pnpm --filter @relay/temporal-worker health` or `node dist/healthcheck.js` inside container.
- Monitoring/alerts:
  - Use Temporal Cloud visibility/alerts to monitor failed or long-running workflows (e.g., scans exceeding budget/time). Configure alerts in Cloud UI.
  - Ship worker stdout/stderr to your log sink; surface “temporal:ok/temporal:unhealthy” from health script.
- Runbook (suggested):
  - If worker errors on connect: verify `TEMPORAL_*` envs, API key validity, TLS server name.
  - If scans stuck: check Temporal Cloud workflow list for `startScanWorkflow` executions; retry/terminate stuck runs in UI; confirm worker logs.
  - Rotate API key in Temporal Cloud, update envs, redeploy.
