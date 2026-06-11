import type { AgentAction, FailureClass } from "@halo/types";
import { optionalEnv } from "@halo/shared";

export interface LlmDecisionInput {
  failureClass: FailureClass;
  failureReason: string;
  currentTipLamports: number;
  recommendedTipLamports: number;
  leaderSlotsAway: number;
  attempt: number;
  maxAttempts: number;
  failureAgentNote: string;
  tipAgentNote: string;
  timingAgentNote: string;
}

export interface LlmDecisionOutput {
  reasoning: string;
  action: AgentAction;
  tipLamports: number;
  shouldRetry: boolean;
  waitForLeader: boolean;
}

function heuristicDecision(input: LlmDecisionInput): LlmDecisionOutput {
  const shouldRetry = input.attempt < input.maxAttempts;

  if (!shouldRetry) {
    return {
      reasoning: "Maximum retry attempts reached; aborting to avoid runaway spend.",
      action: "ABORT",
      tipLamports: input.recommendedTipLamports,
      shouldRetry: false,
      waitForLeader: false,
    };
  }

  if (input.failureClass === "BLOCKHASH_EXPIRED") {
    return {
      reasoning: `${input.failureReason} Refresh blockhash and resubmit with adjusted tip (${input.recommendedTipLamports} lamports).`,
      action: "REFRESH_BLOCKHASH_AND_RETRY",
      tipLamports: input.recommendedTipLamports,
      shouldRetry: true,
      waitForLeader: input.leaderSlotsAway > 2,
    };
  }

  if (input.failureClass === "TIP_TOO_LOW" || input.failureClass === "BUNDLE_REJECTED") {
    return {
      reasoning: `${input.failureReason} Increase tip to ${input.recommendedTipLamports} lamports and retry on next Jito leader.`,
      action: "INCREASE_TIP_AND_RETRY",
      tipLamports: input.recommendedTipLamports,
      shouldRetry: true,
      waitForLeader: true,
    };
  }

  if (input.failureClass === "LEADER_SKIPPED") {
    return {
      reasoning: `${input.failureReason} Wait for the next Jito leader window, refresh blockhash if needed, then retry.`,
      action: "WAIT_FOR_LEADER_AND_RETRY",
      tipLamports: input.recommendedTipLamports,
      shouldRetry: true,
      waitForLeader: true,
    };
  }

  return {
    reasoning: `Synthesized agent signals: ${input.failureAgentNote} | ${input.tipAgentNote} | ${input.timingAgentNote}`,
    action: "REFRESH_BLOCKHASH_AND_RETRY",
    tipLamports: input.recommendedTipLamports,
    shouldRetry: true,
    waitForLeader: input.leaderSlotsAway > 2,
  };
}

export async function synthesizeDecision(input: LlmDecisionInput): Promise<LlmDecisionOutput> {
  const apiKey = optionalEnv("OPENAI_API_KEY");

  if (!apiKey) {
    return heuristicDecision(input);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: optionalEnv("OPENAI_MODEL", "gpt-4o-mini"),
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are HALO's execution orchestrator. Return JSON with keys: reasoning, action, tipLamports, shouldRetry, waitForLeader. action must be one of REFRESH_BLOCKHASH_AND_RETRY, INCREASE_TIP_AND_RETRY, WAIT_FOR_LEADER_AND_RETRY, ABORT.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty content");
    }

    const parsed = JSON.parse(content) as LlmDecisionOutput;
    return {
      reasoning: parsed.reasoning,
      action: parsed.action,
      tipLamports: Number(parsed.tipLamports),
      shouldRetry: Boolean(parsed.shouldRetry),
      waitForLeader: Boolean(parsed.waitForLeader),
    };
  } catch (error) {
    console.warn("LLM synthesis failed, using heuristic decision:", error);
    return heuristicDecision(input);
  }
}
