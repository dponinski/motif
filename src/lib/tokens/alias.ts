// A token that is another token is written `var(--other)`, and nothing else: a variable with a fallback, or a calc(), is a value of its
// own. These two say what a value names, and how one is written; the rest of the handling of aliases is where the tokens are.

// `var(--x)` and nothing else (no fallback): what it names, or null.
export const aliasTarget = (value: string): string | null => /^var\(\s*--([\w-]+)\s*\)$/.exec(value.trim())?.[1] ?? null;

export const varRef = (name: string) => `var(--${name})`;
