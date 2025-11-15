import { describe, expect, it } from 'vitest';
import { deleteAllDataForUser } from '../auth';

interface RecordBase {
  _id: string;
  [key: string]: any;
}

interface Predicate {
  field: string;
  value: any;
}

interface Builder {
  eq(field: string, value: any): Predicate;
}

class MockDB {
  data: Record<string, RecordBase[]>;

  constructor(data: Record<string, RecordBase[]>) {
    this.data = data;
  }

  normalizeId(_table: string, id: string) {
    return id;
  }

  query(table: string) {
    const self = this;
    const predicates: Predicate[] = [];
    const apply = (cb: (builder: any) => Predicate) => {
      const cond = cb({ eq: (field: string, value: any) => ({ field, value }) });
      if (cond) predicates.push(cond);
    };

    const query = {
      withIndex(_name: string, cb: (builder: any) => Predicate) {
        apply(cb);
        return query;
      },
      filter(cb: (builder: any) => Predicate) {
        apply(cb);
        return query;
      },
      collect() {
        return (self.data[table] ?? []).filter((record) =>
          predicates.every((cond) => record[cond.field] === cond.value)
        );
      }
    };

    return query;
  }

  async delete(id: string) {
    for (const key of Object.keys(this.data)) {
      const idx = this.data[key].findIndex((record) => record._id === id);
      if (idx !== -1) {
        this.data[key].splice(idx, 1);
        break;
      }
    }
  }
}

function createCtx() {
  const data: Record<string, RecordBase[]> = {
    runs: [{ _id: 'run1', userId: 'user1' }],
    emails: [
      { _id: 'email1', runId: 'run1' },
      { _id: 'email2', runId: 'run1' }
    ],
    email_bodies: [
      { _id: 'body1', runId: 'run1', emailId: 'email1' },
      { _id: 'body2', runId: 'run1', emailId: 'email2' }
    ],
    companies: [{ _id: 'company1', runId: 'run1' }],
    link_metadata: [{ _id: 'link1', runId: 'run1' }],
    exports: [
      { _id: 'export1', runId: 'run1' },
      { _id: 'export2', userId: 'user1' }
    ],
    sessions: [{ _id: 'session1', userId: 'user1' }]
  };

  return { db: new MockDB(data), data };
}

describe('deleteAllDataForUser', () => {
  it('removes runs, emails, bodies, companies, metadata, exports, and sessions', async () => {
    const { db, data } = createCtx();
    await deleteAllDataForUser({ db }, 'user1');

    expect(data.runs).toHaveLength(0);
    expect(data.emails).toHaveLength(0);
    expect(data.email_bodies).toHaveLength(0);
    expect(data.companies).toHaveLength(0);
    expect(data.link_metadata).toHaveLength(0);
    expect(data.sessions).toHaveLength(0);
    expect(data.exports).toHaveLength(0);
  });
});
