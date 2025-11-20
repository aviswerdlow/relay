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
- `pnpm --filter @relay/temporal-worker typecheck` – TypeScript typecheck.
- `pnpm --filter @relay/temporal-worker test` – run lightweight unit tests (hello workflow stub).
- The web API starts `startScanWorkflow` via `/api/scan`, so web needs the same Temporal env vars (`TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_TASK_QUEUE`).

## Structure

- `src/workflows/hello.workflow.ts` – sample workflow using `proxyActivities`.
- `src/activities/hello.ts` – sample activity implementation.
- `src/worker.ts` – worker entrypoint that connects and runs with configured namespace/task queue.

## Next steps

- Add real workflows/activities (e.g., scan orchestration from `convex/scanPipeline.ts`).
- Consider Dockerfile/Procfile for deployment and add monitoring/health checks per issue #21.
