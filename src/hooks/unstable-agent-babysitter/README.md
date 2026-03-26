# unstable-agent-babysitter

Monitors and reminds the user about potentially hung background tasks from
unstable models.

## File Comparisons

### index.ts

-   **Source**:
    `third_party/oh-my-opencode/src/hooks/unstable-agent-babysitter/index.ts`
-   **Modifications**:
    -   Updated imports to point to local `features/background-agent` and
        `features/claude-code-session-state`.
    -   Operating on Gemini-specific model identification logic.
