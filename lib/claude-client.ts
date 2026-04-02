import Anthropic from "@anthropic-ai/sdk";

export function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en el entorno.");
  return new Anthropic({ apiKey });
}
