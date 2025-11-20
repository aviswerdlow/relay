export type Id<TableName extends string> = `${TableName}:${string}`;

export interface MessageCandidate {
  id: string;
  threadId: string;
}

export interface MessageMetadata {
  gmailId: string;
  threadId: string;
  subject: string;
  from: string;
  listId: string | null;
  sentAt: number;
}
