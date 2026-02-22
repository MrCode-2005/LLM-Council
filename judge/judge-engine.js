/**
 * LLM Council — Judge Evaluation Prompt Builder
 */

/**
 * Build the structured evaluation prompt to send to the Judge model.
 *
 * @param {string} originalPrompt - The user's original prompt
 * @param {Array<{modelId: string, modelName: string, response: string|null, status: string}>} responses
 * @returns {string} The full evaluation prompt
 */
export function buildEvaluationPrompt(originalPrompt, responses) {
    const parts = [];

    // ── Original Prompt ──
    parts.push(`Original Prompt:\n${originalPrompt}`);
    parts.push('');

    // ── Council Responses ──
    let modelIndex = 1;
    const respondedModels = [];
    const failedModels = [];

    for (const r of responses) {
        if (r.response && r.status === 'complete') {
            parts.push(`Council Model ${modelIndex} (${r.modelName}) Response:\n${r.response}`);
            parts.push('');
            respondedModels.push({ index: modelIndex, name: r.modelName });
        } else {
            failedModels.push(r.modelName);
        }
        modelIndex++;
    }

    // ── Note failed models ──
    if (failedModels.length > 0) {
        parts.push(`Note: The following models did not provide a response: ${failedModels.join(', ')}. Exclude them from ranking.`);
        parts.push('');
    }

    // ── Evaluation Instructions ──
    parts.push('---');
    parts.push('');
    parts.push('INSTRUCTIONS:');
    parts.push('');
    parts.push('You are an objective evaluator. You must evaluate each council model\'s response independently.');
    parts.push('');
    parts.push('You must evaluate objectively. Do not favor any model. Do not bias toward stylistic similarity. Score purely on reasoning quality and correctness.');
    parts.push('');
    parts.push('Score each response from 1–10 on the following criteria:');
    parts.push('- Accuracy');
    parts.push('- Depth');
    parts.push('- Clarity');
    parts.push('- Logical Reasoning');
    parts.push('- Relevance');
    parts.push('');
    parts.push('For each model, provide:');
    parts.push('1. Individual scores for each criterion');
    parts.push('2. A total weighted score (sum of all 5 criteria, max 50)');
    parts.push('3. A brief justification paragraph');
    parts.push('');
    parts.push('Then provide:');
    parts.push('- A final ranking from best to worst');
    parts.push('- A summary paragraph explaining the winner\'s strengths');
    parts.push('');

    // ── Desired output format ──
    parts.push('Return the evaluation in this EXACT format:');
    parts.push('');
    parts.push('## Evaluation Results');
    parts.push('');

    for (const m of respondedModels) {
        parts.push(`### ${m.name}`);
        parts.push('| Criterion | Score |');
        parts.push('|-----------|-------|');
        parts.push('| Accuracy | X/10 |');
        parts.push('| Depth | X/10 |');
        parts.push('| Clarity | X/10 |');
        parts.push('| Logical Reasoning | X/10 |');
        parts.push('| Relevance | X/10 |');
        parts.push('| **Total** | **XX/50** |');
        parts.push('');
        parts.push('**Justification:** [Your analysis here]');
        parts.push('');
    }

    parts.push('### Final Ranking');
    for (let i = 0; i < respondedModels.length; i++) {
        parts.push(`${i + 1}. [Model Name] — XX/50`);
    }
    parts.push('');
    parts.push('### Winner: [Model Name]');
    parts.push('**Summary:** [Why this model won]');

    return parts.join('\n');
}
