/**
 * LLM Council — Judge Response Parser
 *
 * Parses the Judge model's raw text response into structured scores.
 */

/**
 * @typedef {Object} ModelScore
 * @property {string} modelName
 * @property {number} accuracy
 * @property {number} depth
 * @property {number} clarity
 * @property {number} reasoning
 * @property {number} relevance
 * @property {number} total
 * @property {string} justification
 */

/**
 * @typedef {Object} JudgeResult
 * @property {boolean} parsed - Whether parsing succeeded
 * @property {ModelScore[]} scores - Per-model scores
 * @property {string[]} ranking - Ordered model names (best → worst)
 * @property {string} winner - Name of the winning model
 * @property {string} summary - Judge's winner summary
 * @property {string} rawText - The full raw Judge response
 */

/**
 * Parse the Judge model's response.
 * @param {string} rawText - Raw text from the Judge
 * @param {string[]} modelNames - Names of the council models (in order)
 * @returns {JudgeResult}
 */
export function parseJudgeResponse(rawText, modelNames) {
    const result = {
        parsed: false,
        scores: [],
        ranking: [],
        winner: '',
        summary: '',
        rawText
    };

    try {
        // ── Parse per-model scores ──
        for (const name of modelNames) {
            const score = extractModelScore(rawText, name);
            if (score) {
                result.scores.push(score);
            }
        }

        // ── Parse ranking ──
        result.ranking = extractRanking(rawText, modelNames);

        // ── Parse winner ──
        const winnerMatch = rawText.match(/###?\s*Winner:\s*(.+)/i);
        if (winnerMatch) {
            result.winner = winnerMatch[1].trim().replace(/\*+/g, '');
        } else if (result.ranking.length > 0) {
            result.winner = result.ranking[0];
        }

        // ── Parse summary ──
        const summaryMatch = rawText.match(/\*\*Summary:\*\*\s*(.+?)(?:\n\n|$)/is);
        if (summaryMatch) {
            result.summary = summaryMatch[1].trim();
        }

        result.parsed = result.scores.length > 0;
    } catch (e) {
        console.warn('[LLM Council] Judge parse error:', e);
        result.parsed = false;
    }

    return result;
}

/**
 * Extract scores for a specific model from the Judge text.
 */
function extractModelScore(text, modelName) {
    // Find the section for this model
    const escapedName = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(
        `###?\\s*${escapedName}[\\s\\S]*?(?=###|$)`, 'i'
    );
    const section = text.match(sectionRegex);
    if (!section) return null;

    const block = section[0];

    const extractScore = (criterion) => {
        const regex = new RegExp(`${criterion}[\\s|]*?(\\d+)\\s*/\\s*10`, 'i');
        const match = block.match(regex);
        return match ? parseInt(match[1], 10) : 0;
    };

    const accuracy = extractScore('Accuracy');
    const depth = extractScore('Depth');
    const clarity = extractScore('Clarity');
    const reasoning = extractScore('Logical Reasoning') || extractScore('Reasoning');
    const relevance = extractScore('Relevance');

    // Total — try to extract, otherwise compute
    let total = accuracy + depth + clarity + reasoning + relevance;
    const totalMatch = block.match(/Total[^|]*\|\s*\**(\d+)\s*\/\s*50\**/i);
    if (totalMatch) {
        total = parseInt(totalMatch[1], 10);
    }

    // Justification
    let justification = '';
    const justMatch = block.match(/\*\*Justification:\*\*\s*(.+?)(?:\n\n|###|$)/is);
    if (justMatch) {
        justification = justMatch[1].trim();
    }

    return {
        modelName,
        accuracy,
        depth,
        clarity,
        reasoning,
        relevance,
        total,
        justification
    };
}

/**
 * Extract ranking order from the Judge text.
 */
function extractRanking(text, modelNames) {
    const rankingSection = text.match(/###?\s*Final Ranking[\s\S]*?(?=###|$)/i);
    if (!rankingSection) return [];

    const lines = rankingSection[0].split('\n');
    const ranking = [];

    for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+?)(?:\s*[—–-]\s*\d+|$)/);
        if (match) {
            const name = match[1].trim().replace(/\*+/g, '');
            // Match to known model names
            const known = modelNames.find(mn =>
                name.toLowerCase().includes(mn.toLowerCase()) ||
                mn.toLowerCase().includes(name.toLowerCase())
            );
            if (known) ranking.push(known);
            else ranking.push(name);
        }
    }

    return ranking;
}
