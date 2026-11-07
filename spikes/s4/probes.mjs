import { ProbeError } from './http.mjs';

const MAXIMUM_PAGES = 2;
const PAGE_SIZE = 15;
function pageLimit(options) {
  const limit = options.maxPages ?? MAXIMUM_PAGES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_PAGES) throw new ProbeError('invalid_page_budget');
  return limit;
}

async function slackPages(client, route, query, maxPages) {
  const messages = [];
  let cursor = query.cursor;
  for (let page = 0; page < maxPages; page++) {
    const response = await client.get(route, { ...query, limit: PAGE_SIZE, cursor });
    messages.push(...(response.messages ?? []));
    cursor = response.response_metadata?.next_cursor || null;
    if (!cursor) return { messages, cursor: null, pages: page + 1 };
  }
  return { messages, cursor, pages: maxPages };
}

export async function probeSlack(client, options) {
  if (!options.channel || !options.oldest || !options.latest) throw new ProbeError('slack_scope_required');
  const history = options.historyCursor === null && options.threadCursor
    ? { messages: [], cursor: null, pages: 0 }
    : await slackPages(client, 'conversations.history', { channel: options.channel, oldest: options.oldest, latest: options.latest, inclusive: true, cursor: options.historyCursor }, pageLimit(options));
  const parent = options.threadTs ?? history.messages.find(message => message.reply_count > 0)?.ts;
  const thread = parent ? await slackPages(client, 'conversations.replies', { channel: options.channel, ts: parent, cursor: options.threadCursor }, pageLimit(options)) : null;
  const selected = thread?.messages.at(-1)?.ts ?? history.messages[0]?.ts;
  const link = selected ? await client.get('chat.getPermalink', { channel: options.channel, message_ts: selected }) : null;
  return {
    summary: { historyMessages: history.messages.length, historyPages: history.pages, historyComplete: !history.cursor,
      threadMessages: thread?.messages.length ?? 0, threadComplete: thread ? !thread.cursor : null,
      messagePermalink: link ? /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\//.test(link.permalink ?? '') : null },
    continuation: { channel: options.channel, oldest: options.oldest, latest: options.latest,
      historyCursor: history.cursor, threadTs: parent ?? null, threadCursor: thread?.cursor ?? null, permalink: link?.permalink ?? null },
  };
}

function hasBody(part) {
  return Boolean(part?.body?.data || part?.parts?.some(hasBody));
}

async function gmailPages(client, route, query, maxPages) {
  const records = [];
  let pageToken = query.pageToken;
  let historyId = null;
  for (let page = 0; page < maxPages; page++) {
    const response = await client.get(route, { ...query, maxResults: PAGE_SIZE, pageToken });
    records.push(...(response[route] ?? []));
    historyId = response.historyId ?? historyId;
    pageToken = response.nextPageToken || null;
    if (!pageToken) return { records, historyId, pageToken: null, pages: page + 1 };
  }
  return { records, historyId, pageToken, pages: maxPages };
}

async function gmailHistory(client, options) {
  const page = await gmailPages(client, 'history', { startHistoryId: options.historyId, labelId: options.label, pageToken: options.pageToken }, pageLimit(options));
  return { summary: { historyRecords: page.records.length, historyComplete: !page.pageToken, historyPages: page.pages },
    continuation: { label: options.label, historyId: page.pageToken ? options.historyId : page.historyId ?? options.historyId, pageToken: page.pageToken } };
}

export async function probeGmail(client, options) {
  if (!options.label) throw new ProbeError('gmail_label_required');
  if (options.historyId) return gmailHistory(client, options);
  if (!/^\d+$/.test(options.after ?? '')) throw new ProbeError('gmail_time_bound_required');
  // Capture the history boundary first so mail arriving during backfill can be replayed.
  const profile = options.snapshotHistoryId ? { historyId: options.snapshotHistoryId } : await client.get('profile');
  const page = await gmailPages(client, 'messages', { labelIds: options.label, q: `after:${options.after}`, pageToken: options.pageToken }, pageLimit(options));
  let messagesRead = 0;
  let bodyAvailable = false;
  let threadRetrieval = null;
  for (const reference of page.records) {
    const message = await client.get(`messages/${reference.id}`, { format: 'full' });
    if (!message.labelIds?.includes(options.label)) continue;
    messagesRead++;
    bodyAvailable ||= hasBody(message.payload);
    if (threadRetrieval === null && message.threadId) {
      const thread = await client.get(`threads/${message.threadId}`, { format: 'minimal' });
      threadRetrieval = Array.isArray(thread.messages);
    }
  }
  return {
    summary: { messagesListed: page.records.length, messagesRead, backfillComplete: !page.pageToken, backfillPages: page.pages,
      bodyAvailable, threadRetrieval, messagePermalink: null },
    continuation: { label: options.label, after: options.after, pageToken: page.pageToken, snapshotHistoryId: profile.historyId,
      historyId: page.pageToken ? null : profile.historyId },
  };
}
