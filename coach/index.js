const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { trace, metrics, SpanStatusCode } = require('@opentelemetry/api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

const tracer = trace.getTracer('chess-coach-tracer', '1.0.0');
const meter = metrics.getMeter('chess-coach-meter', '1.0.0');

const llmCallCounter = meter.createCounter('coach_llm_calls_total', {
  description: 'Total LLM API calls made by coach agent',
});
const llmTokenCounter = meter.createCounter('coach_llm_tokens_total', {
  description: 'Total tokens consumed by LLM calls',
});
const llmDurationHistogram = meter.createHistogram('coach_llm_duration_ms', {
  description: 'Duration of LLM API calls',
  unit: 'ms',
});

// Groq (free) — uses OpenAI-compatible API
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = 'llama-3.3-70b-versatile';

const COACH_SYSTEM_PROMPT = `You are an expert chess coach analyzing an AI engine's decision. Given the engine's analysis data, provide a concise 1-3 sentence explanation of why the chosen move is strong.

Focus on:
- Tactical or strategic justification
- Why alternatives were inferior
- Key patterns (pins, forks, pawn structure, king safety, etc.)

Be specific and educational. Use standard chess notation.`;

function buildAnalysisPrompt(data) {
  const { fen, bestMove, evalScore, candidateMoves } = data;
  const evalPawns = (evalScore / 100).toFixed(2);
  const moveList = candidateMoves && candidateMoves.length > 0
    ? candidateMoves.join(', ')
    : 'none provided';

  return `Position (FEN): ${fen}
Engine's chosen move: ${bestMove}
Evaluation: ${evalScore} centipawns (${evalPawns} pawns, ${evalScore >= 0 ? 'White' : 'Black'} advantage)
Top candidate moves considered: ${moveList}

Explain why ${bestMove} is the engine's choice in this position.`;
}

app.post('/api/explain', async (req, res) => {
  const { fen, bestMove, evalScore, candidateMoves, traceId } = req.body;

  if (!fen || !bestMove) {
    return res.status(400).json({ error: 'fen and bestMove are required' });
  }

  return tracer.startActiveSpan('llm.generate_explanation', async (llmSpan) => {
    const startTime = Date.now();

    try {
      llmSpan.setAttribute('llm.model', MODEL);
      llmSpan.setAttribute('llm.provider', 'groq');
      llmSpan.setAttribute('llm.system_prompt_length', COACH_SYSTEM_PROMPT.length);
      llmSpan.setAttribute('chess.fen', fen);
      llmSpan.setAttribute('chess.best_move', bestMove);
      llmSpan.setAttribute('chess.eval_score', evalScore);
      if (traceId) llmSpan.setAttribute('chess.parent_trace_id', traceId);

      const userMessage = buildAnalysisPrompt({ fen, bestMove, evalScore, candidateMoves });
      llmSpan.setAttribute('llm.input_message_length', userMessage.length);

      const completion = await groq.chat.completions.create({
        model: MODEL,
        max_tokens: 256,
        messages: [
          { role: 'system', content: COACH_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      });

      const explanation = completion.choices[0].message.content;
      const inputTokens = completion.usage?.prompt_tokens || 0;
      const outputTokens = completion.usage?.completion_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const latencyMs = Date.now() - startTime;

      // Groq is free — cost is $0
      const costUsd = 0;

      llmSpan.setAttribute('llm.output', explanation);
      llmSpan.setAttribute('llm.input_tokens', inputTokens);
      llmSpan.setAttribute('llm.output_tokens', outputTokens);
      llmSpan.setAttribute('llm.total_tokens', totalTokens);
      llmSpan.setAttribute('llm.cost_usd', costUsd);
      llmSpan.setAttribute('llm.latency_ms', latencyMs);

      llmCallCounter.add(1, { model: MODEL, provider: 'groq' });
      llmTokenCounter.add(totalTokens, { model: MODEL, type: 'total' });
      llmDurationHistogram.record(latencyMs, { model: MODEL });

      res.json({
        explanation,
        tokensUsed: totalTokens,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs,
        model: MODEL,
        provider: 'groq (free)',
      });
    } catch (err) {
      llmSpan.recordException(err);
      llmSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      console.error('[Coach] LLM error:', err.message);
      res.status(500).json({ error: err.message });
    } finally {
      llmSpan.end();
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'chess-coach-agent',
    provider: 'groq (free)',
    model: MODEL,
    hasApiKey: !!process.env.GROQ_API_KEY,
  });
});

app.listen(PORT, () => {
  console.log(`[Coach Agent] Running on port ${PORT}`);
  console.log(`[Coach Agent] Provider: Groq (${MODEL})`);
  console.log(`[Coach Agent] API key: ${process.env.GROQ_API_KEY ? 'configured' : 'MISSING'}`);
});
