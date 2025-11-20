import { proxyActivities } from '@temporalio/workflow';

const { greet } = proxyActivities<{ greet(name: string): Promise<string> }>({
  startToCloseTimeout: '1 minute'
});

const defaultGreeter: (name: string) => Promise<string> = greet as unknown as (
  name: string
) => Promise<string>;

export async function helloWorkflow(
  name: string,
  greeter: (name: string) => Promise<string> = defaultGreeter
): Promise<string> {
  return await greeter(name);
}
