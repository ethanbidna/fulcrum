const REDIRECT_ORIGIN = 'https://secrets.activepieces.com';
const MAX_CODE_LENGTH = 8192;

export function acceptsOAuthReply(event, popup) {
  return popup != null && event.origin === REDIRECT_ORIGIN && event.source === popup
    && typeof event.data?.code === 'string' && event.data.code.length > 0 && event.data.code.length <= MAX_CODE_LENGTH;
}
