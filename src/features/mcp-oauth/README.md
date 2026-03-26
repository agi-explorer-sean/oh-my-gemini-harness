# mcp-oauth

This feature provides OAuth 2.0 support for MCP servers.

## File Sources

### Re-exported from oh-my-opencode

-   `callback-server.ts`: Re-exported.
-   `dcr.ts`: Re-exported.
-   `discovery.ts`: Re-exported.
-   `resource-indicator.ts`: Re-exported.
-   `schema.ts`: Re-exported.
-   `step-up.ts`: Re-exported.

### Local Files (Modified for Gemini)

-   **provider.ts**:

    -   **Change**: Updated `clientName` to `oh-my-gemini` and removed the
        duplicate export of `startCallbackServer`.
    -   **Difference**: The vendor version exports `startCallbackServer` from
        both `callback-server.ts` and `provider.ts`, leading to ambiguity in the
        barrel export.
    -   **Issues Solved**: Resolves TypeScript error TS2308 (ambiguous export)
        during builds, ensuring the build system can clearly resolve the
        callback server entry point.

-   **storage.ts**:

    -   **Modified**: Replaced `getOpenCodeConfigDir` with `getGeminiConfigDir`.

-   **index.ts**:

    -   **Modified**: Acts as the local barrel export, ensuring local
        modifications in `provider.ts` and `storage.ts` take precedence over
        vendor re-exports.

-   ***.test.ts**: Localized tests.

Note: `login.ts` and `logout.ts` CLI commands are located in `src/cli/mcp-oauth/`.
