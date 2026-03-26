# hooks

This directory contains lifecycle hooks that intercept messages and tool
executions.

## File Sources

### Local Implementation (Gemini Specific)

These hooks are unique to Gemini or contain substantial platform-specific
overrides: - `agent-usage-reminder/`: Reminds users to use specialized agents
instead of direct search tools. - `anthropic-context-window-limit-recovery/`:
Specialized recovery for Anthropic token limit errors, including aggressive
truncation of tool outputs. - `atlas/`: Orchestration logic for the Atlas agent,
handling Boulder state continuation and verification reminders. -
`auto-slash-command/`: Automatically expands slash commands (e.g., `/commit`)
into their template instructions. - `auto-update-checker/`: Periodically checks
for plugin updates and performs background installations. -
`category-skill-reminder/`: Encourages the use of category-based delegation for
better task routing. - `claude-code-hooks/`: Bridge for running original Claude
Code hooks within the Gemini environment. - `comment-checker/`: Prevents agents
from committing/writing code with "AI comments" (e.g., `// ... existing code
...`). - `directory-agents-injector/`: Dynamically injects `AGENTS.md` context
from subdirectories. - `directory-readme-injector/`: Dynamically injects
`README.md` context from subdirectories. - `edit-error-recovery/`: Detects
common Edit tool failures and provides corrective instructions. -
`interactive-bash-session/`: Tracks and cleans up interactive tmux sessions
spawned by subagents. - `keyword-detector/`: Triggers special modes (Ultrawork,
Search, Analyze) based on user prompt keywords. - `non-interactive-env/`:
Injects non-interactive environment variables into bash commands to prevent
hangs. - `proactive-edit-fixer/`: Corrects minor whitespace/indentation
discrepancies in Edit tool calls before execution. - `prometheus-md-only/`:
Enforces read-only constraints for the Prometheus planning agent. -
`ralph-loop/`: Implements self-referential development loops. -
`rules-injector/`: Injects instructions from rule files (`.md`, `.mdc`) based on
the files being modified. - `session-recovery/`: Orchestrates recovery from
various LLM errors (thinking order, tool results missing). -
`task-resume-info/`: Appends continuation instructions to background task
output. - `unstable-agent-babysitter/`: Monitors and reminds the user about
potentially hung background tasks from unstable models. -
`session-notification.ts`: Platform-native desktop notifications for session
idle states. - `index.ts`: Central registry for all hooks.
