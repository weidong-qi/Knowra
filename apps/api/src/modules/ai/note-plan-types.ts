import type { NoteRepository } from '../knowledge/infrastructure/note-repository.ts';

export type PlanNote = NonNullable<ReturnType<NoteRepository['findById']>>;
export interface NoteImage {
  id: string;
  spaceId: string | null | undefined;
  title: string;
  folderId: string | null;
  tagIds: string[];
  rawMarkdown: string;
  aiVisibility?: string;
}
export interface NoteEdit {
  start: number;
  end: number;
  quote: string;
  replacement: string;
}
export interface NoteBaseline {
  targetNoteId: string;
  exists: boolean;
  expectedUpdatedAt?: string;
  contentHash?: string;
  metadataHash?: string;
}
export interface NotePlanItem {
  before: NoteImage | null;
  after: NoteImage;
  baseline: NoteBaseline;
  edits: NoteEdit[];
}
export interface NotePlanIdentity {
  actorId: string;
  ownerId: string;
  datasetId: string;
  datasetEpoch: string;
  spaceId: string;
  requestId: string;
  operationId: string;
  targetNoteId: string;
}
export interface TrustedNoteTarget extends NotePlanIdentity {
  note?: PlanNote | null;
  allowedFolderIds?: string[];
  allowedTagIds?: string[];
  appendOffset?: number;
}
export interface CreateNoteArguments {
  title: string;
  rawMarkdown: string;
  folderId?: string | null;
  tagIds?: string[];
}
export interface AppendNoteArguments {
  noteId: string;
  rawMarkdown: string;
}
export interface PatchNoteArguments {
  noteId: string;
  replacements: NoteEdit[];
}
export type NoteWriteArguments = CreateNoteArguments | AppendNoteArguments | PatchNoteArguments;
export interface NoteWriteInput {
  toolName: string;
  arguments: unknown;
  trusted: TrustedNoteTarget;
}
export interface ActionReference {
  kind: string;
  id: string;
  hash: string;
}
export interface OrganizeArguments {
  changes: { noteId: string; title?: string; folderId?: string | null; tagIds?: string[] }[];
}
export interface ActionPlanInput<Provenance> {
  toolName: string;
  args: unknown;
  trusted: TrustedNoteTarget & { identity: Partial<NotePlanIdentity>; provenance?: Provenance | null };
  notes: PlanNote[];
  references: ActionReference[];
}
