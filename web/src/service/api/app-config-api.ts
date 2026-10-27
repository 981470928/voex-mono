import axios from 'axios';

interface PublicConfig {
  pexelsKey?: string;
}

let request: Promise<string> | undefined;

/**
 * Read runtime settings from the API so the prebuilt frontend does not need to
 * be rebuilt when the deployment fills voex.config.json.
 */
export function getPexelsKey(): Promise<string> {
  if (!request) {
    request = axios
      .get<PublicConfig>('/api/public/config', { timeout: 10000 })
      .then(({ data }) => (typeof data.pexelsKey === 'string' ? data.pexelsKey.trim() : ''))
      .catch((error: unknown) => {
        request = undefined;
        throw error;
      });
  }
  return request;
}
