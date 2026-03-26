/**
 * MCP Configuration Loader
 *
 * Loads Claude Code .mcp.json format configurations from multiple scopes
 * and transforms them to Gemini SDK format
 */

export * from '../../../third_party/oh-my-opencode/src/features/claude-code-mcp-loader/index';
export {loadMcpConfigs as getMcpConfigs} from '../../../third_party/oh-my-opencode/src/features/claude-code-mcp-loader/loader';
