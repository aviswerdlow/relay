import { describe, expect, it } from 'vitest';
import { helloWorkflow } from './workflows/hello.workflow.js';

describe('helloWorkflow', () => {
  it('returns greeting via proxied activity stub', async () => {
    const result = await helloWorkflow('Temporal', async (name) => `Hello, ${name}!`);
    expect(result).toBe('Hello, Temporal!');
  });
});
