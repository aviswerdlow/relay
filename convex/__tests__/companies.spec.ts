import { describe, expect, it } from 'vitest';
import { internalUpsertCompany } from '../companies';

function makeFakeCtx() {
  const inserted: any[] = [];

  class FakeIndexQuery {
    unique = async () => null;
    collect = async () => [];
    take = async () => [];
    eq = () => this;
    filter = () => this;
  }

  class FakeQuery extends FakeIndexQuery {
    withIndex = () => new FakeIndexQuery();
  }

  const ctx = {
    db: {
      normalizeId: (_table: string, id: string) => ({ toString: () => `${_table}:${id}` }),
      query: () => new FakeQuery(),
      insert: async (_table: string, doc: any) => {
        inserted.push(doc);
        return { toString: () => `${_table}:new` };
      },
      patch: async () => {
        /* noop for these tests */
      }
    }
  };

  return { ctx, inserted };
}

describe('internalUpsertCompany validator', () => {
  it('allows optional/null location', () => {
    const argsJson = JSON.parse((internalUpsertCompany as any).exportArgs());
    const locationField = argsJson?.value?.location;
    expect(locationField?.optional).toBe(true);
    const unionTypes = locationField?.fieldType?.value?.map((v: any) => v.type);
    expect(unionTypes).toContain('null');
    expect(unionTypes).toContain('string');
  });
});

describe('internalUpsertCompany handler', () => {
  const baseArgs = {
    userId: 'user-1',
    runId: 'run-1',
    emailId: 'email-1',
    gmailId: 'gmail-1',
    name: 'TestCo',
    homepageUrl: undefined,
    altDomains: [],
    oneLineSummary: 'Summary',
    category: undefined,
    stage: undefined,
    platform: undefined,
    keySignals: [],
    snippets: [],
    confidence: 0.5,
    sentAt: Date.now()
  };

  it('inserts cleanly when location is null', async () => {
    const { ctx, inserted } = makeFakeCtx();
    await (internalUpsertCompany as any)._handler(ctx, { ...baseArgs, location: null });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].location).toBeNull();
  });

  it('inserts cleanly when location is undefined', async () => {
    const { ctx, inserted } = makeFakeCtx();
    await (internalUpsertCompany as any)._handler(ctx, { ...baseArgs, location: undefined });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].location).toBeNull();
  });
});
