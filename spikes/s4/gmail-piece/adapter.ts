import { Buffer } from "node:buffer";
import type {
  PullLimits, SourceAdapter, SourceItem, SourceItemRef, SourcePage, SourceScope,
} from "../../../packages/sources/src/interfaces.js";
import { gmailReadOnly } from "./piece.ts";
import type { BackfillPage, GmailMessage, GmailPart, HistoryChange, HistoryPage } from "./piece.ts";

const PAGE_BUDGET = 5;
const SECONDS_PER_MILLISECOND = 1 / 1000;
const MAX_TEXT_LENGTH = 64_000;
const CONNECTOR = "gmail";

type ActionName = "get_history_anchor" | "list_backfill_page" | "list_history_page" | "get_labeled_message";
type HistoryPosition = { phase: "history"; anchor: string; pageToken?: string };
type BackfillPosition = { phase: "backfill"; anchor: string; after: number; before: number; pageToken?: string };
type HistoryBatch = { phase: "history-batch"; ids: string[]; resume: HistoryPosition; complete: boolean };
type Position = HistoryPosition | BackfillPosition | HistoryBatch;

interface Options {
  accountKey: string;
  historyExpiry?: "restart-backfill" | "fail";
  labels: SourceScope[];
  accessToken(signal: AbortSignal): Promise<string>;
  now(): number;
}

function historyIds(changes: HistoryChange[]): string[] {
  return [...new Set(changes.flatMap(change => [
    ...(change.messages ?? []),
    ...(change.messagesAdded ?? []).map(event => event.message),
    ...(change.labelsAdded ?? []).map(event => event.message),
  ]).map(message => message.id))];
}

function plainParts(part: GmailPart): string[] {
  if (part.filename) return [];
  if (part.mimeType === "text/plain" && part.body?.data) {
    return [Buffer.from(part.body.data, "base64url").toString("utf8")];
  }
  if (part.mimeType?.startsWith("multipart/")) return (part.parts ?? []).flatMap(plainParts);
  return [];
}

function normalize(message: GmailMessage, ref: SourceItemRef): SourceItem | null {
  const text = (message.payload ? plainParts(message.payload).join("\n").trim() : "") || message.snippet?.trim();
  if (!text) return null;
  const from = message.payload?.headers?.find(header => header.name.toLowerCase() === "from")?.value ?? "";
  const authorId = (/<([^<>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const timestamp = /^\d+$/.test(message.internalDate) ? new Date(Number(message.internalDate)) : new Date(NaN);
  if (!authorId || !Number.isFinite(timestamp.getTime())) throw new Error("invalid_gmail_message_metadata");

  return {
    ...ref, authorId, happenedAt: timestamp.toISOString(), text: text.slice(0, MAX_TEXT_LENGTH),
    ...(message.threadId ? { threadRemoteId: message.threadId } : {}),
  };
}

export class GmailSourceAdapter implements SourceAdapter {
  readonly id = CONNECTOR;
  private readonly labels: Map<string, SourceScope>;

  constructor(private readonly options: Options) {
    if (!options.accountKey.trim()) throw new Error("gmail_account_required");
    this.labels = new Map(options.labels.map(label => [
      JSON.stringify([options.accountKey, label.id]), { ...label },
    ]));
    if (this.labels.size !== options.labels.length || options.labels.some(label => !label.id.trim())) {
      throw new Error("invalid_gmail_labels");
    }
  }

  async scopes(): Promise<SourceScope[]> {
    return [...this.labels].map(([id, label]) => ({ id, label: label.label }));
  }

  async pull(scope: SourceScope, cursor: string | null, limits: PullLimits): Promise<SourcePage> {
    const label = this.labels.get(scope.id);
    if (!label || !Number.isInteger(limits.limit) || limits.limit < 1) throw new Error("invalid_gmail_pull");
    const pageSize = Math.min(limits.limit, PAGE_BUDGET);
    const saved = cursor === null ? null : this.position(scope.id, cursor);
    const token = await this.token(limits.signal);
    const position = saved ?? await this.startBackfill(token, limits);

    if (position.phase === "backfill") return this.backfill(scope.id, label.id, position, pageSize, token, limits.signal);
    const batch = position.phase === "history-batch" ? position : await this.history(label.id, position, pageSize, token, limits.signal);
    if (batch === null) {
      const recovery = await this.startBackfill(token, limits);
      return this.backfill(scope.id, label.id, recovery, pageSize, token, limits.signal);
    }
    return this.historyBatch(scope.id, label.id, batch, pageSize, token, limits.signal);
  }

  async read(ref: SourceItemRef, signal: AbortSignal): Promise<SourceItem | null> {
    const label = this.labels.get(ref.scopeId);
    const prefix = this.messageKey("");
    if (ref.connector !== this.id || !label || !ref.remoteId.startsWith(prefix)) return null;
    const id = ref.remoteId.slice(prefix.length);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
    return this.readMessage(ref.scopeId, label.id, id, await this.token(signal), signal);
  }

  permalink(): null { return null; }

  private async startBackfill(token: string, { since, signal }: PullLimits): Promise<BackfillPosition> {
    const after = Math.floor(Date.parse(since) * SECONDS_PER_MILLISECOND);
    const { historyId } = await this.action<{ historyId: string }>("get_history_anchor", {}, token, signal);
    const before = Math.floor(this.options.now() * SECONDS_PER_MILLISECOND) + 1;
    if (!Number.isSafeInteger(after) || !Number.isSafeInteger(before) || after < 0 || before <= after) {
      throw new Error("invalid_gmail_backfill_window");
    }
    return { phase: "backfill", anchor: historyId, after, before };
  }

  private async backfill(scopeId: string, labelId: string, position: BackfillPosition, pageSize: number,
    token: string, signal: AbortSignal): Promise<SourcePage> {
    const { after, before, pageToken, anchor } = position;
    const page = await this.action<BackfillPage>("list_backfill_page", { labelId, pageSize, after, before, pageToken }, token, signal);
    if (page.messages.length > pageSize) throw new Error("gmail_backfill_page_over_budget");
    const items = await this.readMessages(scopeId, labelId, page.messages.map(message => message.id), token, signal);
    return {
      items,
      next: page.nextPageToken === null ? null : this.cursor(scopeId, { ...position, pageToken: page.nextPageToken }),
      checkpoint: this.cursor(scopeId, { phase: "history", anchor }),
    };
  }

  private async history(labelId: string, position: HistoryPosition, pageSize: number, token: string,
    signal: AbortSignal): Promise<HistoryBatch | null> {
    try {
      const page = await this.action<HistoryPage>("list_history_page", {
        labelId, pageSize, startHistoryId: position.anchor, pageToken: position.pageToken,
      }, token, signal);
      if (page.nextPageToken !== null && page.nextPageToken === position.pageToken) {
        throw new Error("gmail_history_cursor_stalled");
      }
      const ids = historyIds(page.changes);
      if (page.nextPageToken !== null) {
        return { phase: "history-batch", ids, resume: { ...position, pageToken: page.nextPageToken }, complete: false };
      }
      if (page.checkpoint === null) throw new Error("missing_gmail_checkpoint");
      return { phase: "history-batch", ids, resume: { phase: "history", anchor: page.checkpoint }, complete: true };
    } catch (error) {
      if (this.options.historyExpiry !== "fail" && error instanceof Error && error.message === "gmail_history_expired") return null;
      throw error;
    }
  }

  private async historyBatch(scopeId: string, labelId: string, batch: HistoryBatch, pageSize: number, token: string,
    signal: AbortSignal): Promise<SourcePage> {
    const items = await this.readMessages(scopeId, labelId, batch.ids.slice(0, pageSize), token, signal);
    const remaining = batch.ids.slice(pageSize);
    const checkpoint = this.cursor(scopeId, batch.resume);
    const next = remaining.length ? this.cursor(scopeId, { ...batch, ids: remaining }) : batch.complete ? null : checkpoint;
    return { items, next, checkpoint };
  }

  private async readMessages(scopeId: string, labelId: string, ids: string[], token: string,
    signal: AbortSignal): Promise<SourceItem[]> {
    const messages = await Promise.all([...new Set(ids)].map(id => this.readMessage(scopeId, labelId, id, token, signal)));
    return messages.filter(message => message !== null);
  }

  private async readMessage(scopeId: string, labelId: string, id: string, token: string,
    signal: AbortSignal): Promise<SourceItem | null> {
    const message = await this.action<GmailMessage | null>("get_labeled_message", { labelId, messageId: id }, token, signal);
    return message === null ? null : normalize(message, { connector: this.id, scopeId, remoteId: this.messageKey(id) });
  }

  private messageKey(id: string): string { return JSON.stringify(this.options.accountKey) + ":" + id; }

  private cursor(scopeId: string, position: Position): string {
    return JSON.stringify({ version: 1, scopeId, position });
  }

  private position(scopeId: string, cursor: string): Position {
    const decoded = JSON.parse(cursor) as { version?: number; scopeId?: string; position?: Position };
    if (decoded?.version !== 1 || decoded.scopeId !== scopeId || !decoded.position) {
      throw new Error("invalid_gmail_cursor");
    }
    return decoded.position;
  }

  private async token(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const token = await this.options.accessToken(signal);
    signal.throwIfAborted();
    return token;
  }

  private async action<T>(name: ActionName, propsValue: Record<string, unknown>, token: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const action = gmailReadOnly.getAction(name);
    if (!action) throw new Error("unknown_gmail_action");
    // These actions use only the auth, props and cancellation parts of the local context.
    const context = { auth: { type: "OAUTH2", access_token: token }, propsValue, signal };
    const result = await action.run(context as unknown as Parameters<typeof action.run>[0]);
    signal.throwIfAborted();
    return result as T;
  }
}
