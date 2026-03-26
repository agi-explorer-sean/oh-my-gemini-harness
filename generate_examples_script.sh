#!/bin/bash
# export GEMINI_API_KEY=your-key-here  # set this in your environment or .env

commands=(
  "atlas:/atlas explain what you can do"
  "explore:/explore explain what you can do"
  "hephaestus:/hephaestus explain what you can do"
  "init-deep:/init-deep"
  "librarian:/librarian explain what you can do"
  "looker:/looker explain what you can do"
  "metis:/metis explain what you can do"
  "momus:/momus explain what you can do"
  "oracle:/oracle explain what you can do"
  "parallel-exec:/parallel-exec explain what you can do"
  "prometheus:/prometheus explain what you can do"
  "ralph-loop:/ralph-loop explain what you can do"
  "refactor:/refactor explain what you can do"
  "remove-deadcode:/remove-deadcode explain what you can do"
  "sisyphus:/sisyphus explain what you can do"
  "start-work:/start-work explain what you can do"
  "ulw-loop:/ulw-loop explain what you can do"
)

pids=()

for item in "${commands[@]}"; do
  name="${item%%:*}"
  prompt="${item#*:}"
  
  mkdir -p "examples/$name"
  echo -n "$prompt" > "examples/$name/stdin.txt"
  
  echo "Running $name..."
  
  (
    gemini -m gemini-3.1-pro-preview -p "$prompt" \
      | perl -pe 's/\x1b\[[0-9;]*[a-zA-Z]//g' \
      | perl -pe 's/^MCP issues detected\. Run \/mcp list for status\.//' \
      | grep -v -E "^(Loading extension|Error during discovery|Failed to compile schema|type must be JSONType|YOLO mode is enabled|Expanding hook command|Hook execution|Created execution plan|\[ExtensionManager\]|MCP issues detected)" \
      > "examples/$name/stdout.txt"
    echo "Finished $name"
  ) &
  
  pids+=($!)
  
  if [[ ${#pids[@]} -ge 3 ]]; then
    wait -n
    new_pids=()
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        new_pids+=("$pid")
      fi
    done
    pids=("${new_pids[@]}")
  fi
done

wait
echo "All done!"