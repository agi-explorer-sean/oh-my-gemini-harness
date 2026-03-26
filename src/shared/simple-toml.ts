/**
 * A very simple and limited TOML parser designed to handle command files
 * when running in environments without Bun.TOML support (like Node.js).
 *
 * Supports:
 * - single-line strings: key = "value"
 * - multi-line strings: key = """value"""
 * - booleans: key = true/false
 * - numbers: key = 123
 */
export function parseSimpleToml(content: string): Record<string, any> {
  const result: Record<string, any> = {};

  // 1. Extract multi-line strings
  // Look for key = """ ... """
  const multiLineRegex = /^(\w+)\s*=\s*"""([\s\S]*?)"""/gm;
  let match;
  let processedContent = content;

  while ((match = multiLineRegex.exec(content)) !== null) {
    const [fullMatch, key, value] = match;
    result[key] = value;
    // Remove from processed content so we don't match it again
    processedContent = processedContent.replace(
      fullMatch,
      `# PROCESSED MULTILINE ${key}`,
    );
  }

  // 2. Extract single-line strings
  // Look for key = "value"
  const singleLineRegex = /^(\w+)\s*=\s*"([^"]*)"/gm;
  while ((match = singleLineRegex.exec(processedContent)) !== null) {
    const [fullMatch, key, value] = match;
    result[key] = value;
    processedContent = processedContent.replace(
      fullMatch,
      `# PROCESSED SINGLELINE ${key}`,
    );
  }

  // 3. Extract other values (booleans, numbers, unquoted strings)
  const otherRegex = /^(\w+)\s*=\s*([^\n#]+)/gm;
  while ((match = otherRegex.exec(processedContent)) !== null) {
    const [fullMatch, key, value] = match;
    const trimmedValue = value.trim();

    if (trimmedValue === 'true') {
      result[key] = true;
    } else if (trimmedValue === 'false') {
      result[key] = false;
    } else if (!isNaN(Number(trimmedValue)) && trimmedValue !== '') {
      result[key] = Number(trimmedValue);
    } else {
      result[key] = trimmedValue;
    }
  }

  return result;
}

/**
 * Parses TOML content using Bun.TOML if available,
 * otherwise falls back to parseSimpleToml.
 */
export function parseToml(content: string): Record<string, any> {
  if (typeof (globalThis as any).Bun?.TOML?.parse === 'function') {
    try {
      return (globalThis as any).Bun.TOML.parse(content);
    } catch (err) {
      // If Bun's parser fails, try our simple one as a last resort
      return parseSimpleToml(content);
    }
  }
  return parseSimpleToml(content);
}
