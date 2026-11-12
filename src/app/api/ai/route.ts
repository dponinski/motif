import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Motif AI, an assistant built into Motif, a design system builder. Motif works on the React components and design tokens of a GitHub repository. You help designers:

1. **Design token suggestions** - Suggest semantic color tokens, typography scales and spacing systems
2. **Component review** - Review a component (described in the context) for accessibility, consistency and clarity of its props and variants
3. **Design system advice** - Naming, structure, theming, documentation

For token suggestions, respond with:
\`\`\`json
{
  "action": "tokens",
  "tokens": {
    "colors": [{ "name": "primary-500", "value": "#6366f1", "group": "primary" }],
    "typography": [{ "name": "heading-lg", "fontFamily": "Inter", "fontSize": 24, "fontWeight": 600, "lineHeight": 32 }],
    "spacing": [{ "name": "space-4", "value": 16 }]
  }
}
\`\`\`

For other responses (review, advice), respond in plain markdown. Keep responses concise and actionable. Motif is not a prototyping tool: do not produce screens or layouts.`;

export async function POST(req: NextRequest) {
  try {
    const { messages, designContext } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local" },
        { status: 503 }
      );
    }

    const contextMessage = designContext
      ? `\nCurrent context: ${JSON.stringify(designContext)}`
      : "";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT + contextMessage,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected response type" }, { status: 500 });
    }

    // Try to parse structured JSON responses
    const text = content.text;
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return NextResponse.json({ text, structured: parsed });
      } catch {
        // Not valid JSON, return as plain text
      }
    }

    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
