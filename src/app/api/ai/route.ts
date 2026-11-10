import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are Motif AI, an intelligent design assistant built into the Motif design canvas tool. You help designers:

1. **Generate UI layouts** — When asked to generate a component or layout, respond with a JSON structure describing canvas elements to place
2. **Design token suggestions** — Suggest semantic color tokens, typography scales, and spacing systems
3. **Design critique** — Analyze described designs for accessibility, consistency, and best practices
4. **Component architecture** — Recommend design system component structures

When generating canvas elements, format your response as:
\`\`\`json
{
  "action": "generate",
  "elements": [
    {
      "type": "frame" | "rectangle" | "ellipse" | "text",
      "name": "string",
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "fill": "#hexcolor",
      "cornerRadius": number,
      "content": "text content (for text elements)",
      "fontSize": number,
      "fontWeight": "normal" | "medium" | "semibold" | "bold",
      "children": [] // nested elements
    }
  ]
}
\`\`\`

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

For other responses (critique, advice), respond in plain markdown. Keep responses concise and actionable.

Current design tool context: Motif is a Figma-like design canvas focused on design systems. Users work with frames, shapes, text, and design tokens.`;

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
      ? `\nCurrent canvas context: ${JSON.stringify(designContext)}`
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
