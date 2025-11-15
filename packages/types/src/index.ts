/**
 * Shared enums and DTOs for the Relay workspace.
 * Keep these definitions in sync with docs/PRD.md and docs/TDD.md.
 */

export const COMPANY_CATEGORIES = [
  'Consumer AI',
  'Fintech',
  'Commerce',
  'Health',
  'Social',
  'Creator Tools',
  'Marketplaces',
  'Productivity',
  'Gaming',
  'Hardware',
  'Other'
] as const;
export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export const COMPANY_STAGES = ['pre-seed', 'seed', 'A', 'B', 'unknown'] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const COMPANY_SIGNALS = [
  'waitlist',
  'launch',
  'funding',
  'traction',
  'notable_founder',
  'partnership'
] as const;
export type CompanySignal = (typeof COMPANY_SIGNALS)[number];

export type CompanyDecision = 'unreviewed' | 'saved' | 'ignored';

export interface CompanySnippet {
  /** Direct quote pulled from the newsletter or linked page. */
  quote: string;
  /** Optional start offset (character index) within the normalized body. */
  start?: number;
  /** Optional end offset (character index) within the normalized body. */
  end?: number;
}

export interface CompanyRecord {
  id: string;
  name: string;
  homepageUrl: string | null;
  altDomains: string[];
  oneLineSummary: string;
  category: CompanyCategory;
  stage: CompanyStage;
  location: string | null;
  newsletterPlatform?: NewsletterPlatform;
  keySignals: CompanySignal[];
  sourceEmailIds: string[];
  sourceSnippets: CompanySnippet[];
  confidence: number;
  decision: CompanyDecision;
  score: number;
  firstSeenAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export type ScanStatus = 'pending' | 'running' | 'complete' | 'failed';

export interface ScanRun {
  id: string;
  userId: string;
  status: ScanStatus;
  timeWindowDays: number;
  totalMessages: number;
  processedMessages: number;
  processedCompanies: number;
  newslettersClassified: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  failureReason?: string;
}

export interface UserSettings {
  timeWindowDays: number;
  retentionDays: number;
}

export type NewsletterPlatform = 'substack' | 'beehiiv' | 'buttondown' | 'unknown';

export interface EmailMetadata {
  id: string;
  runId: string;
  gmailId: string;
  threadId: string;
  subject: string;
  from: string;
  listId: string | null;
  newsletterPlatform: NewsletterPlatform;
  sentAt: number;
}

export interface EmailBody {
  emailId: string;
  runId: string;
  normalizedHtml: string | null;
  normalizedText: string | null;
  links: string[];
  normalizedAt: number;
  retentionExpiry: number;
}

export interface LinkMetadata {
  url: string;
  fetchedAt: number;
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  socialLinks: string[];
}

export interface ScanProgress {
  runId: string;
  status: ScanStatus;
  totalMessages: number;
  processedMessages: number;
  processedCompanies: number;
  newslettersClassified: number;
  lastUpdatedAt: number;
}

export interface ExportMetadata {
  id: string;
  runId: string;
  userId: string;
  status: 'pending' | 'ready' | 'expired' | 'failed';
  url: string | null;
  filename: string;
  requestedAt: number;
  availableAt?: number;
  expiresAt?: number;
  failureReason?: string;
}

export interface SessionSummary {
  userId: string;
  email: string;
  settings: UserSettings;
  convexAuthToken?: string;
}
