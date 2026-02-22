/**
 * LLM Council — Judge / Chairman Evaluation Prompt Builder
 *
 * Adapted from the 3-stage LLM Council orchestration pattern:
 * - Stage 2 style: Peer ranking with anonymized responses
 * - Stage 3 style: Chairman synthesis with collective wisdom
 */

/**
 * Default judge evaluation prompt.
 * Users can customize this via the Judge Config page.
 * Placeholders: {question} = user's original prompt, {responses} = formatted council responses
 */
export const DEFAULT_JUDGE_PROMPT = `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question. Your job is to objectively evaluate, rank, and synthesize the best possible answer.

Original Question: {question}

{responses}

---

YOUR TASK AS CHAIRMAN:

1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.

2. Score each response from 1–10 on the following criteria:
   - Accuracy: Is the information correct and factual?
   - Depth: Does it cover the topic thoroughly?
   - Clarity: Is it well-written and easy to understand?
   - Logical Reasoning: Is the reasoning sound and well-structured?
   - Relevance: Does it directly address the user's question?

3. You must evaluate objectively. Do not favor any response. Do not bias toward stylistic similarity. Score purely on reasoning quality and correctness.

4. Consider:
   - The individual responses and their unique insights
   - Any patterns of agreement or disagreement between responses
   - What each response reveals about response quality

IMPORTANT: Return the evaluation in this EXACT format:

## Evaluation Results

For each model, provide:
### [Model Name]
| Criterion | Score |
|-----------|-------|
| Accuracy | X/10 |
| Depth | X/10 |
| Clarity | X/10 |
| Logical Reasoning | X/10 |
| Relevance | X/10 |
| **Total** | **XX/50** |

**Justification:** [Your analysis]

### Final Ranking
1. [Model Name] — XX/50

### Winner: [Model Name]
**Summary:** [Why this response best represents the council's collective wisdom]`;

/**
 * Build the structured evaluation prompt to send to the Judge (Chairman) model.
 *
 * @param {string} originalPrompt - The user's original prompt
 * @param {Array<{modelId: string, modelName: string, response: string|null, status: string}>} responses
 * @param {string} [customPrompt] - Optional custom prompt with {question} and {responses} placeholders
 * @returns {string} The full evaluation prompt
 */
export function buildEvaluationPrompt(originalPrompt, responses, customPrompt) {
    // ── Filter to only successful responses ──
    const respondedModels = [];
    const failedModels = [];

    for (const r of responses) {
        if (r.response && r.status === 'complete') {
            respondedModels.push({ name: r.modelName, response: r.response });
        } else {
            failedModels.push(r.modelName);
        }
    }

    // ── Build formatted responses block ──
    const labels = respondedModels.map((_, i) => String.fromCharCode(65 + i));
    let responsesBlock = '';

    if (failedModels.length > 0) {
        responsesBlock += `Note: The following models did not provide a response: ${failedModels.join(', ')}. Exclude them from evaluation.\n\n`;
    }

    responsesBlock += 'Here are the responses from different council models:\n\n';
    for (let i = 0; i < respondedModels.length; i++) {
        responsesBlock += `${respondedModels[i].name} (Response ${labels[i]}):\n${respondedModels[i].response}\n\n`;
    }

    // ── Use custom prompt if provided, otherwise use default ──
    const template = (customPrompt && customPrompt.trim()) ? customPrompt : DEFAULT_JUDGE_PROMPT;

    return template
        .replace(/\{question\}/gi, originalPrompt)
        .replace(/\{responses\}/gi, responsesBlock.trim());
}
