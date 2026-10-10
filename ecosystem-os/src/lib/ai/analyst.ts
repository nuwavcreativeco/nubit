import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { ANALYST_SYSTEM, companyContext } from './prompt';
import { runTool, toolSchemas, type ToolContext } from './tools';

export type AnalystEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'done'; model: string; engine: 'claude' | 'local' }
  | { type: 'error'; message: string };

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

const MODEL = process.env.ANALYST_MODEL ?? 'claude-opus-5-5';
const MAX_STEPS = 8;

/**
 * Tool-using analyst loop. The model can only see numbers by calling engine tools, so every figure
 * it reports traces back to the analytics engine. Prior turns are sent as plain text (append-only).
 */
export async function* runClaudeAnalyst(question: string, history: ChatTurn[], ctx: ToolContext, scenarioActive: boolean): AsyncGenerator<AnalystEvent> {
  const client = new Anthropic();
  const tools: Anthropic.Beta.BetaTool[] = toolSchemas().map((t) => ({ ...t, eager_input_streaming: true }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: companyContext(ctx.data, ctx.year, scenarioActive) + '\n\n' + (history[0]?.role === 'user' ? history[0].text : question) },
  ];
  const rest = history[0]?.role === 'user' ? [...history.slice(1), { role: 'user' as const, text: question }] : [];
  for (const t of rest) messages.push({ role: t.role, content: t.text });

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: 'text', text: ANALYST_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'medium' },
      tools,
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      // Forward text deltas as they arrive so the UI renders progressively.
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text };
      }
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) yield { type: 'error', message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.' };
      else if (err instanceof Anthropic.RateLimitError) yield { type: 'error', message: 'Rate limited by the Anthropic API — try again shortly.' };
      else if (err instanceof Anthropic.APIError) yield { type: 'error', message: `Anthropic API error ${err.status}: ${err.message}` };
      else yield { type: 'error', message: 'A tool input could not be parsed; please ask again.' };
      return;
    }

    if (message.stop_reason === 'refusal') {
      yield { type: 'error', message: 'The model declined this request.' };
      return;
    }
    if (message.stop_reason === 'end_turn') {
      yield { type: 'done', model: message.model, engine: 'claude' };
      return;
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content });
      continue;
    }
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!calls.length) {
      yield { type: 'done', model: message.model, engine: 'claude' };
      return;
    }
    if (message.stop_reason === 'max_tokens') {
      yield { type: 'error', message: 'The answer was cut off (max tokens). Try a narrower question.' };
      return;
    }

    messages.push({ role: 'assistant', content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      yield { type: 'tool', name: call.name, input: call.input };
      const res = runTool(call.name, call.input, ctx);
      yield { type: 'tool_result', name: call.name, ok: res.ok };
      results.push(
        res.ok
          ? { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(res.result) }
          : { type: 'tool_result', tool_use_id: call.id, is_error: true, content: res.error },
      );
    }
    messages.push({ role: 'user', content: results });
  }
  yield { type: 'error', message: 'Stopped after too many tool calls.' };
}
