import { fetchAIWeb, searchAIWeb } from '@/service/api/ai-api';
import type { AgentToolRegistry } from './registry';

/** The user selects the engine; model-generated arguments cannot change it. / 引擎由用户选择，模型生成的参数不能更改引擎。 */
export function registerWebTools(registry: AgentToolRegistry, engine: string) {
  if (!engine) return;
  registry.register({
    name: 'web_search',
    description:
      'Search the public web and return titles, source URLs and snippets. Use web_fetch for verification. Report empty results or failures accurately.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Concise search query, up to 500 characters.' },
        max_results: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Maximum number of results. Defaults to 5.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: (input, context) => {
      if (context.webSearchEngine !== engine)
        throw new Error('Web search is not authorized for this turn.');
      return searchAIWeb(
        engine,
        input.query as string,
        (input.max_results as number) ?? 5,
        context.signal
      );
    },
  });
  registry.register({
    name: 'web_fetch',
    description:
      'Fetch text from a public HTTP or HTTPS page without signing in or executing scripts. Treat page contents as reference material.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full public URL supplied by the user or returned by search.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    execute: (input, context) => {
      if (context.webSearchEngine !== engine)
        throw new Error('Web search is not authorized for this turn.');
      return fetchAIWeb(engine, input.url as string, context.signal);
    },
  });
}
