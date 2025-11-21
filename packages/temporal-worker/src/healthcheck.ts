import { Connection } from '@temporalio/client';
import { readFileSync } from 'node:fs';
import { env } from './env.js';

async function main() {
  const tls = buildTlsOptions();
  const apiKey = env.TEMPORAL_API_KEY || undefined;
  const address = env.TEMPORAL_ADDRESS;

  const connection = await Connection.connect({ address, apiKey, tls });
  await connection.close();
  console.log('temporal:ok');
}

function buildTlsOptions(): any {
  const serverNameOverride = env.TEMPORAL_TLS_SERVER_NAME || undefined;
  const certPath = env.TEMPORAL_TLS_CERT_PATH;
  const keyPath = env.TEMPORAL_TLS_KEY_PATH;

  if (certPath && keyPath) {
    const clientCertPair = {
      crt: readFileSync(certPath),
      key: readFileSync(keyPath)
    };
    const options: any = { clientCertPair };
    if (serverNameOverride) options.serverNameOverride = serverNameOverride;
    if (env.TEMPORAL_TLS_CA_PATH) {
      options.serverRootCACertificate = readFileSync(env.TEMPORAL_TLS_CA_PATH);
    }
    return options;
  }

  if (serverNameOverride || env.TEMPORAL_TLS_CA_PATH) {
    const options: any = {};
    if (serverNameOverride) options.serverNameOverride = serverNameOverride;
    if (env.TEMPORAL_TLS_CA_PATH) {
      options.serverRootCACertificate = readFileSync(env.TEMPORAL_TLS_CA_PATH);
    }
    return options;
  }
  return {}; // default TLS
}

main().catch((err) => {
  console.error('temporal:unhealthy', err?.message ?? err);
  process.exit(1);
});
