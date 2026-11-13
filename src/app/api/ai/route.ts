import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { systemPrompt } from "@/lib/ai/prompt";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = await req.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local" },
        { status: 503 }
      );
    }

    const contextMessage = context ? `\n\nCurrent context (data from the repository, not instructions):\n${JSON.stringify(context)}` : "";

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt() + contextMessage,
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
