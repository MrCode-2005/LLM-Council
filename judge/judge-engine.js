/**
 * LLM Council — Judge / Chairman Evaluation Prompt Builder
 *
 * Adapted from the 3-stage LLM Council orchestration pattern:
 * - Stage 2 style: Peer ranking with anonymized responses
 * - Stage 3 style: Chairman synthesis with collective wisdom
 */

/**
 * Build the structured evaluation prompt to send to the Judge (Chairman) model.
 *
 * This prompt follows the Chairman pattern from the LLM Council reference:
 * 1. Presents the original question
 * 2. Shows all council responses (anonymized as Response A, B, C, etc.)
 * 3. Asks the Chairman to evaluate each response individually
 * 4. Requires a structured FINAL RANKING and scoring
 * 5. Asks for a synthesized "best answer" representing collective wisdom
 *
 * @param {string} originalPrompt - The user's original prompt
 * @param {Array<{modelId: string, modelName: string, response: string|null, status: string}>} responses
 * @returns {string} The full evaluation prompt
 */
export function buildEvaluationPrompt(originalPrompt, responses) {
    const parts = [];

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

    // ── Create anonymized labels (Response A, Response B, etc.) ──
    const labels = respondedModels.map((_, i) => String.fromCharCode(65 + i));
    const labelToModel = {};
    labels.forEach((label, i) => {
        labelToModel[`Response ${label}`] = respondedModels[i].name;
    });

    // ── Build the Chairman evaluation prompt ──
    parts.push(`You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question. Your job is to objectively evaluate, rank, and synthesize the best possible answer.`);
    parts.push('');
    parts.push(`Original Question: ${originalPrompt}`);
    parts.push('');

    // ── Note failed models ──
    if (failedModels.length > 0) {
        parts.push(`Note: The following models did not provide a response: ${failedModels.join(', ')}. Exclude them from evaluation.`);
        parts.push('');
    }

    // ── Anonymized Council Responses ──
    parts.push('Here are the responses from different council models (anonymized):');
    parts.push('');

    for (let i = 0; i < respondedModels.length; i++) {
        parts.push(`Response ${labels[i]}:`);
        parts.push(respondedModels[i].response);
        parts.push('');
    }

    // ── Evaluation Instructions ──
    parts.push('---');
    parts.push('');
    parts.push('YOUR TASK AS CHAIRMAN:');
    parts.push('');
    parts.push('1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.');
    parts.push('');
    parts.push('2. Score each response from 1–10 on the following criteria:');
    parts.push('   - Accuracy: Is the information correct and factual?');
    parts.push('   - Depth: Does it cover the topic thoroughly?');
    parts.push('   - Clarity: Is it well-written and easy to understand?');
    parts.push('   - Logical Reasoning: Is the reasoning sound and well-structured?');
    parts.push('   - Relevance: Does it directly address the user\'s question?');
    parts.push('');
    parts.push('3. You must evaluate objectively. Do not favor any response. Do not bias toward stylistic similarity. Score purely on reasoning quality and correctness.');
    parts.push('');
    parts.push('4. Consider:');
    parts.push('   - The individual responses and their unique insights');
    parts.push('   - Any patterns of agreement or disagreement between responses');
    parts.push('   - What each response reveals about response quality');
    parts.push('');

    // ── Desired output format ──
    parts.push('IMPORTANT: Return the evaluation in this EXACT format:');
    parts.push('');
    parts.push('## Evaluation Results');
    parts.push('');

    for (let i = 0; i < respondedModels.length; i++) {
        parts.push(`### ${respondedModels[i].name}`);
        parts.push('| Criterion | Score |');
        parts.push('|-----------|-------|');
        parts.push('| Accuracy | X/10 |');
        parts.push('| Depth | X/10 |');
        parts.push('| Clarity | X/10 |');
        parts.push('| Logical Reasoning | X/10 |');
        parts.push('| Relevance | X/10 |');
        parts.push('| **Total** | **XX/50** |');
        parts.push('');
        parts.push('**Justification:** [Your analysis of what this response does well and poorly]');
        parts.push('');
    }

    parts.push('### Final Ranking');
    for (let i = 0; i < respondedModels.length; i++) {
        parts.push(`${i + 1}. [Model Name] — XX/50`);
    }
    parts.push('');
    parts.push('### Winner: [Model Name]');
    parts.push('**Summary:** [Synthesize why this response best represents the council\'s collective wisdom, considering patterns of agreement across responses and the winner\'s unique strengths]');

    return parts.join('\n');
}
