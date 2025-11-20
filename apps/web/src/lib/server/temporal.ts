import { env as privateEnv } from '$env/dynamic/private';
import { Client, Connection } from '@temporalio/client';
import { readFileSync } from 'node:fs';

function requireEnv(name: string, fallback?: string): string {
	const value = privateEnv[name] ?? fallback;
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export async function getTemporalClient() {
	const address = requireEnv('TEMPORAL_ADDRESS', 'localhost:7233');
	const namespace = requireEnv('TEMPORAL_NAMESPACE', 'default');
	const tls = buildTlsOptions();
	const apiKey = privateEnv.TEMPORAL_API_KEY || undefined;
	const connection = await Connection.connect({ address, tls, apiKey });
	return new Client({
		connection,
		namespace
	});
}

export function getTemporalTaskQueue() {
	return requireEnv('TEMPORAL_TASK_QUEUE', 'relay-scan');
}

function buildTlsOptions(): any {
	const certPath = privateEnv.TEMPORAL_TLS_CERT_PATH;
	const keyPath = privateEnv.TEMPORAL_TLS_KEY_PATH;
	// If cert/key not provided, use default TLS with optional server name override.
	const serverNameOverride = privateEnv.TEMPORAL_TLS_SERVER_NAME || undefined;
	if (!certPath || !keyPath) {
		if (serverNameOverride || privateEnv.TEMPORAL_TLS_CA_PATH) {
			const opts: any = {};
			if (serverNameOverride) opts.serverNameOverride = serverNameOverride;
			if (privateEnv.TEMPORAL_TLS_CA_PATH) {
				opts.serverRootCACertificate = readFileSync(privateEnv.TEMPORAL_TLS_CA_PATH);
			}
			return opts;
		}
		return {}; // default TLS
	}

	const clientCertPair = {
		crt: readFileSync(certPath),
		key: readFileSync(keyPath)
	};

	const options: any = { clientCertPair };
	if (serverNameOverride) {
		options.serverNameOverride = serverNameOverride;
	}
	if (privateEnv.TEMPORAL_TLS_CA_PATH) {
		options.serverRootCACertificate = readFileSync(privateEnv.TEMPORAL_TLS_CA_PATH);
	}
	return options;
}
