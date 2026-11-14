import { authorizeGmail as authorize, refreshGmail } from '../../../packages/sources/src/gmail/oauth.ts';

export async function authorizeGmail(options) {
  const grant = await authorize(options);
  let token = grant.refreshToken;
  return {
    labels: grant.labels,
    refresh: async () => {
      const result = await refreshGmail(options.client, token, options.stop, options.fetcher);
      token = result.refreshToken ?? token;
      return result.accessToken;
    },
  };
}
