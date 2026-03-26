# builtin-skills

This feature provides a set of pre-defined skills for agents.

## File Sources

### Re-exported from oh-my-opencode

-   `index.ts`: Re-exported.
-   `types.ts`: Re-exported.
-   `skills/dev-browser.ts`
-   `skills/frontend-ui-ux.ts`
-   `skills/git-master.ts`
-   `skills/playwright.ts`

### Adapted from [claude-skills](https://github.com/Jeffallan/claude-skills)

-   `skills/typescript-programmer.ts`
-   `skills/python-programmer.ts`
-   `skills/rust-programmer.ts`
-   `skills/prompt-engineer.ts`
-   `skills/java-programmer.ts`
-   `skills/python-debugger.ts`

### Adapted from [awesome-agent-skills](https://github.com/kodustech/awesome-agent-skills)

-   `skills/data-scientist.ts`
-   `skills/github-issue-triage.ts`
-   `skills/github-pr-triage.ts`

### Local Files (Modified for Gemini)

-   `skills.ts`:
    -   **Modified**: Integrated a significantly larger library of skills
        compared to the vendor default, including various language-specific
        "Programmer" roles and "Triage" skills.
-   `skills.test.ts`: Local tests verifying the expanded skill registry.
-   `skills/plan-visualizer.ts`: Plan visualization skill.
-   `skills/golang-tui-programmer.ts`: Go TUI development skill.
-   `skills/svelte-programmer.ts`: Svelte development skill.
-   `skills/index.ts`: Skill registry exports.

### Markdown-based Skills (SKILL.md)

-   `agent-browser/SKILL.md`: Agent browser automation skill.
-   `dev-browser/SKILL.md`: Developer browser skill (with references).
-   `frontend-ui-ux/SKILL.md`: Frontend UI/UX skill.
-   `git-master/SKILL.md`: Git operations skill.

### Support

-   `scripts/gh_fetch.py`: GitHub data fetching helper for triage skills.
