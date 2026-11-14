import { createAction, createPiece, PieceAuth, Property } from "@activepieces/pieces-framework";

const GMAIL_MAILBOX = "https://gmail.googleapis.com/gmail/v1/users/me/";
const MAX_PAGE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10_000;

const auth = PieceAuth.OAuth2({
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  required: true,
});

const paging = {
  labelId: Property.ShortText({ displayName: "Label ID", required: true }),
  pageSize: Property.Number({ displayName: "Page size", required: true }),
  pageToken: Property.ShortText({ displayName: "Continuation token", required: false }),
};

type MailboxRoute = "profile" | "messages" | "history" | `messages/${string}`;
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  labelIds?: string[];
  threadId?: string;
  internalDate: string;
  payload?: GmailPart;
  snippet?: string;
}
type MessageRef = { id: string; threadId: string };
type ChangedMessage = { message: MessageRef };
export interface HistoryChange {
  id: string;
  messages?: MessageRef[];
  messagesAdded?: ChangedMessage[];
  labelsAdded?: ChangedMessage[];
}
export interface BackfillPage {
  messages: MessageRef[];
  nextPageToken: string | null;
}
export interface HistoryPage {
  changes: HistoryChange[];
  nextPageToken: string | null;
  checkpoint: string | null;
}

function localSignal(context: object): AbortSignal | undefined {
  return "signal" in context && context.signal instanceof AbortSignal ? context.signal : undefined;
}

function pageQuery(pageSize: number, pageToken?: string): URLSearchParams {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error("invalid_gmail_page_size");
  }

  const query = new URLSearchParams({ maxResults: String(pageSize) });
  if (pageToken) query.set("pageToken", pageToken);
  return query;
}

function labelId(value: string): string {
  if (!value.trim()) throw new Error("gmail_label_required");
  return value;
}

function historyId(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("invalid_gmail_history_id");
  }
  return value;
}

function continuation(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value) throw new Error("invalid_gmail_page_token");
  return value;
}

async function read<T>(route: MailboxRoute, accessToken: string, query?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  if (!accessToken) throw new Error("gmail_token_required");

  const url = new URL(route, GMAIL_MAILBOX);
  if (query) url.search = query.toString();

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  if (route === "history" && response.status === 404) throw new Error("gmail_history_expired");
  if (!response.ok) throw new Error(`gmail_http_${response.status}`);
  return (await response.json()) as T;
}

export const getHistoryAnchor = createAction({
  auth,
  name: "get_history_anchor",
  displayName: "Get mailbox history anchor",
  description: "Capture the history ID before starting a backfill.",
  props: {},
  async run(context) {
    const profile = await read<{ historyId?: string }>("profile", context.auth.access_token, undefined, localSignal(context));
    return { historyId: historyId(profile.historyId) };
  },
});

export const listBackfillPage = createAction({
  auth,
  name: "list_backfill_page",
  displayName: "List a backfill page",
  description: "List message references in one selected Gmail label and time window.",
  props: {
    ...paging,
    after: Property.Number({ displayName: "Start (Unix seconds)", required: true }),
    before: Property.Number({ displayName: "End (Unix seconds)", required: true }),
  },
  async run(context): Promise<BackfillPage> {
    const { auth, propsValue } = context;
    const { after, before, pageSize, pageToken } = propsValue;
    if (!Number.isSafeInteger(after) || !Number.isSafeInteger(before) || after < 0 || before <= after) {
      throw new Error("invalid_gmail_backfill_window");
    }

    const query = pageQuery(pageSize, pageToken);
    query.set("labelIds", labelId(propsValue.labelId));
    query.set("q", `after:${after} before:${before}`);

    const page = await read<{ messages?: MessageRef[]; nextPageToken?: string }>(
      "messages", auth.access_token, query, localSignal(context),
    );
    return { messages: page.messages ?? [], nextPageToken: continuation(page.nextPageToken) };
  },
});

export const listHistoryPage = createAction({
  auth,
  name: "list_history_page",
  displayName: "List an incremental history page",
  description: "Read one page of changes scoped to a Gmail label.",
  props: {
    ...paging,
    startHistoryId: Property.ShortText({ displayName: "Starting history ID", required: true }),
  },
  async run(context): Promise<HistoryPage> {
    const { auth, propsValue } = context;
    const query = pageQuery(propsValue.pageSize, propsValue.pageToken);
    query.set("labelId", labelId(propsValue.labelId));
    query.set("startHistoryId", historyId(propsValue.startHistoryId));

    const page = await read<{ history?: HistoryChange[]; nextPageToken?: string; historyId?: string }>(
      "history", auth.access_token, query, localSignal(context),
    );
    const changes = page.history ?? [];
    const nextPageToken = continuation(page.nextPageToken);
    if (nextPageToken !== null) return { changes, nextPageToken, checkpoint: null };
    return { changes, nextPageToken: null, checkpoint: historyId(page.historyId) };
  },
});

export const getLabeledMessage = createAction({
  auth,
  name: "get_labeled_message",
  displayName: "Read a labeled message",
  description: "Read one message after checking its Gmail label.",
  props: {
    labelId: paging.labelId,
    messageId: Property.ShortText({ displayName: "Message ID", required: true }),
  },
  async run(context): Promise<GmailMessage | null> {
    const { labelId: selectedLabel, messageId } = context.propsValue;
    labelId(selectedLabel);
    if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) throw new Error("invalid_gmail_message_id");

    const route = `messages/${messageId}` as const;
    const token = context.auth.access_token;
    const signal = localSignal(context);
    try {
      const metadata = await read<Pick<GmailMessage, "id" | "labelIds">>(
        route, token, new URLSearchParams({ format: "minimal" }), signal,
      );
      if (metadata.id !== messageId || (!Array.isArray(metadata.labelIds) || !metadata.labelIds.includes(selectedLabel))) return null;

      const message = await read<GmailMessage>(
        route, token, new URLSearchParams({ format: "full" }), signal,
      );
      return message.id === messageId && Array.isArray(message.labelIds) && message.labelIds.includes(selectedLabel) ? message : null;
    } catch (error) {
      if (error instanceof Error && error.message === "gmail_http_404") return null;
      throw error;
    }
  },
});

export const gmailReadOnly = createPiece({
  displayName: "Gmail (read only)",
  auth,
  logoUrl: "",
  authors: [],
  actions: [getHistoryAnchor, listBackfillPage, listHistoryPage, getLabeledMessage],
  triggers: [],
});
