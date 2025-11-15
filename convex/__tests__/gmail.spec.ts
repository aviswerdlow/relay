import { describe, expect, it } from 'vitest';
import {
  buildNewsletterQuery,
  classifyNewsletterFromMetadata,
  refinePlatformWithBody
} from '../gmail';

describe('buildNewsletterQuery', () => {
  it('includes time window and link filter', () => {
    const query = buildNewsletterQuery(30);
    expect(query).toContain('newer_than:30d');
    expect(query).toContain('has:link');
    expect(query).toContain('category:updates');
    expect(query).toContain('-is:chat');
  });

  it('clamps days between 1 and 365', () => {
    expect(buildNewsletterQuery(0)).toContain('newer_than:1d');
    expect(buildNewsletterQuery(999)).toContain('newer_than:365d');
  });
});

describe('classifyNewsletterFromMetadata', () => {
  it('detects Substack newsletters', () => {
    const platform = classifyNewsletterFromMetadata({
      from: 'Awesome Founder <hello@awesome.substackmail.com>',
      listId: '<awesome.substack.com>',
      subject: 'New drop'
    });
    expect(platform).toBe('substack');
  });

  it('detects Beehiiv newsletters', () => {
    const platform = classifyNewsletterFromMetadata({
      from: 'Beehiiv <team@updates.beehiiv.com>',
      listId: '<updates.beehiiv.com>',
      subject: 'Growth ideas'
    });
    expect(platform).toBe('beehiiv');
  });

  it('falls back to unknown when no signals are present', () => {
    const platform = classifyNewsletterFromMetadata({
      from: 'Generic Sender <news@example.com>',
      listId: '<generic.example.com>',
      subject: 'Weekly digest'
    });
    expect(platform).toBe('unknown');
  });
});

describe('refinePlatformWithBody', () => {
  it('uses body hints when metadata is unknown', () => {
    const platform = refinePlatformWithBody(
      '<html><body>Powered by Substack</body></html>',
      'unknown'
    );
    expect(platform).toBe('substack');
  });

  it('keeps initial platform when already identified', () => {
    const platform = refinePlatformWithBody('<p>content</p>', 'beehiiv');
    expect(platform).toBe('beehiiv');
  });
});
