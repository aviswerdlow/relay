import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities/hello.js';
import * as scanActivities from './activities/scan.js';
import { readFileSync } from 'node:fs';
import { env } from './env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
  const address = env.TEMPORAL_ADDRESS;
  const namespace = env.TEMPORAL_NAMESPACE;
  const taskQueue = env.TEMPORAL_TASK_QUEUE ?? 'relay-scan';

  const tls = buildTlsOptions();
  const apiKey = env.TEMPORAL_API_KEY || undefined;

  const connection = await NativeConnection.connect({ address, tls, apiKey });
  const workflowsPath = join(__dirname, 'workflows');

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: { ...activities, ...scanActivities }
  });

  console.log(
    `Temporal worker started (namespace=${namespace}, taskQueue=${taskQueue}, address=${address})`
  );
  await worker.run();
}

run().catch((err) => {
  console.error('Failed to start Temporal worker', err);
  process.exit(1);
});

function buildTlsOptions(): any {
  // Temporal Cloud requires TLS; if no certs provided, use default TLS with optional server name override.
  const serverNameOverride = env.TEMPORAL_TLS_SERVER_NAME || undefined;
  const certPath = env.TEMPORAL_TLS_CERT_PATH;
  const keyPath = env.TEMPORAL_TLS_KEY_PATH;

  // If client certs provided, use mTLS; otherwise default TLS.
  if (certPath && keyPath) {
    const clientCertPair = {
      crt: readFileSync(certPath),
      key: readFileSync(keyPath)
    };
    const options: any = { clientCertPair };
    if (serverNameOverride) {
      options.serverNameOverride = serverNameOverride;
    }
    if (env.TEMPORAL_TLS_CA_PATH) {
      options.serverRootCACertificate = readFileSync(env.TEMPORAL_TLS_CA_PATH);
    }
    return options;
  }

  if (serverNameOverride) {
    return { serverNameOverride };
  }
  return {}; // default TLS
}
