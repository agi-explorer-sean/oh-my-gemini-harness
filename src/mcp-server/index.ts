import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {PluginInput} from '@opencode-ai/plugin';
import {createOpencodeClient} from '@opencode-ai/sdk';
import * as path from 'node:path';
import {OhMyGeminiPlugin} from '../index';
import {log} from '../shared/logger';

async function createServer() {
  const server = new McpServer({
    name: 'omg-harness',
    version: '0.1.0',
  });

  const directory = process.cwd();
  const serverUrl = process.env.GOOGLE_GEMINI_BASE_URL
    ? new URL(process.env.GOOGLE_GEMINI_BASE_URL)
    : new URL('http://localhost:4097');

  log('[mcp-server] Starting with server URL:', serverUrl.toString());

  const client = createOpencodeClient({
    baseUrl: serverUrl.toString(),
    directory,
  } as any);

  const mockCtx: PluginInput = {
    directory,
    worktree: directory,
    serverUrl,
    client: client as any,
    project: {
      name: path.basename(directory),
    } as any,
    $: (() => {}) as any,
    // Session creation is unavailable in MCP mode - Gemini CLI doesn't
    // expose the /session endpoint that the OpenCode SDK expects.
    isMcpMode: true,
  } as any;

  const plugin = await OhMyGeminiPlugin(mockCtx);

  const allTools: Record<string, any> = {
    ...plugin.tool,
  };

  const mcpSessionID = `mcp-${Math.random().toString(36).substring(2, 10)}`;

  for (const [name, toolDef] of Object.entries(allTools)) {
    if (!toolDef || !toolDef.execute) continue;

    server.tool(
      name,
      toolDef.description || name,
      toolDef.args || {},
      async (args: any): Promise<any> => {
        const context = {
          sessionID: mcpSessionID,
          messageID: 'mcp-message',
          agent: 'mcp',
          directory,
          worktree: directory,
          abort: new AbortController().signal,
          metadata: () => {},
          ask: async () => {},
        };

        try {
          const result = await toolDef.execute(args, context as any);
          return {
            content: [{type: 'text', text: result}],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: err instanceof Error ? err.message : String(err),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

export async function startMcpServer() {
  // Sub-agents spawned by parallel_exec/delegate_task don't need oh-my-gemini
  // tools. Start a minimal empty MCP server to satisfy the protocol handshake
  // without loading the full plugin (BackgroundManager, hooks, skill loaders).
  // This eliminates N heavy Bun processes from the process tree during parallel
  // execution (e.g., 20 sub-agents = 20 avoided plugin initializations).
  if (process.env.OMG_PARENT_AGENT) {
    log(
      '[mcp-server] Sub-agent detected (OMG_PARENT_AGENT), starting minimal server',
    );
    const server = new McpServer({
      name: 'omg-harness',
      version: '0.1.0',
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
