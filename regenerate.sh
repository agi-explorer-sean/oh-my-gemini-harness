#!/bin/bash
# export GEMINI_API_KEY=your-key-here  # set this in your environment or .env

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

for d in examples/*/; do
    dir_name="${d%/}"
    base="${dir_name#examples/}"
    if [ "$base" == "lib" ]; then
        continue
    fi
    echo "Running $base..."

    (
        prompt=$(cat "$dir_name/stdin.txt")
        gemini -m gemini-3.1-pro-preview -p "$prompt" \
          | perl -pe 's/\x1b\[[0-9;]*[a-zA-Z]//g' \
          | perl -pe 's/^MCP issues detected\. Run \/mcp list for status\.//' \
          | grep -v -E "^(Loading extension|Error during discovery|Failed to compile schema|type must be JSONType|YOLO mode is enabled|Expanding hook command|Hook execution|Created execution plan|\[ExtensionManager\]|MCP issues detected)" \
          > "$dir_name/stdout.txt"
        echo "Finished $base"
    ) &
    
    # Simple rate limiting/parallel batching
    while [ $(jobs | wc -l) -ge 4 ]; do
        sleep 1
    done
done

wait
echo "All regenerations complete."
