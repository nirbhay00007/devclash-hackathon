import { GoogleGenerativeAI } from '@google/generative-ai';
import ollama from 'ollama';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArchitectureAnalysis {
    explanation: string;         // Answer to the user's specific query
    subsystems: Subsystem[];     // Identified logical subsystems
    highRiskFiles: string[];     // Files with high change-risk / high coupling
    learningPath: string[];      // Ordered onboarding path for new devs
    recommendations: string[];   // Architectural improvement suggestions
}

export interface Subsystem {
    name: string;
    description: string;
    files: string[];
}

export interface GlobalRepoSummary {
    overallPurpose: string;        // One-paragraph executive summary
    techStack: string[];           // Frameworks + libraries detected
    architecturalStyle: string;    // e.g. "Layered MVC", "Event-driven microservices"
    coreSubsystems: Subsystem[];
    complexityHotspots: string[];  // Top N highest-complexity files
    entryPoints: string[];         // List of entry point files
    suggestedImprovements: string[];
    recommendedOnboardingPath: string[]; // Ordered list of 5-10 files a junior dev should read first
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getModel(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error('Missing GEMINI_API_KEY environment variable. Please provide an API key.');
    }
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { responseMimeType: 'application/json' },
    });
}

// ─── 1. Query-scoped Architectural Analysis ───────────────────────────────────

/**
 * Answers a specific user query using the semantic search sub-graph as context.
 * This is the "narrow-focus" Gemini call — fast, targeted.
 */
export async function askGeminiArchitect(
    subGraph: any,
    userQuery: string,
    apiKey?: string
): Promise<ArchitectureAnalysis> {
    console.log(`[Gemini] Starting synthesis for query: "${userQuery}"`);
    const model = getModel(apiKey);

    const prompt = `You are a Principal Software Architect performing a deep code review.
You have been given a filtered sub-graph of a repository (the files most semantically relevant to the user's query).

USER QUERY: "${userQuery}"

RELEVANT FILES & SUMMARIES:
${JSON.stringify(subGraph, null, 2)}

Return a JSON object with EXACTLY this structure:
{
  "explanation": "Detailed architectural explanation directly answering the query (be specific, reference file names)",
  "subsystems": [
    { "name": "SubsystemName", "description": "What this group does", "files": ["path/to/file.ts"] }
  ],
  "highRiskFiles": ["path/to/file.ts"],
  "learningPath": ["first-file.ts", "second-file.ts"],
  "recommendations": ["Specific recommendation 1", "Specific recommendation 2"]
}

Rules:
- Be specific — reference actual file paths from the context
- "highRiskFiles" = files with high coupling, God-class anti-patterns, or many inbound edges
- "learningPath" = ordered from simplest/foundational → most complex
- "recommendations" = concrete, actionable architectural improvements
- Return ONLY valid JSON`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log(`[Gemini] Received response text (${text.length} chars)`);
        return JSON.parse(text) as ArchitectureAnalysis;
    } catch (err: any) {
        console.error(`[Gemini] Error during content generation:`, err.message);
        console.log(`[Gemini] Falling back to local Ollama (qwen2.5-coder:3b)...`);
        
        try {
            const response = await ollama.chat({
                model: 'qwen2.5-coder:3b',
                messages: [{ role: 'user', content: prompt + "\n\nIMPORTANT: Return ONLY valid JSON. Keep the response compact." }],
                format: 'json',
            });
            const text = response.message.content;
            console.log(`[Ollama] Synthesis complete (${text.length} chars)`);
            return JSON.parse(text) as ArchitectureAnalysis;
        } catch (ollamaErr: any) {
            console.error(`[Ollama] Fallback failed:`, ollamaErr.message);
            throw err; // Re-throw the original Gemini error for diagnostic visibility
        }
    }
}

// ─── 2. Global Repository Summary ────────────────────────────────────────────

/**
 * Creates a holistic, repo-level architectural summary.
 * Called ONCE after the full ingestion pipeline completes.
 * This is the "wide-focus" Gemini call — rich, comprehensive.
 */
export async function generateGlobalRepoSummary(
    allFileSummaries: Array<{
        path: string;
        summary: string;
        complexity: string;
        patterns: string[];
        external_deps: string[];
        is_entry_point: boolean;
        key_exports: string[];
    }>
): Promise<GlobalRepoSummary> {
    const model = getModel();

    // Build a compact representation to avoid token overflow
    const compactContext = allFileSummaries.map(f => ({
        path: f.path,
        summary: f.summary,
        complexity: f.complexity,
        patterns: f.patterns,
        deps: f.external_deps,
        entry: f.is_entry_point,
    }));

    const prompt = `You are a Principal Software Architect performing a holistic codebase review.
Analyze ALL the file summaries below and generate a comprehensive architectural overview.

FILE SUMMARIES (${compactContext.length} files):
${JSON.stringify(compactContext, null, 2)}

Return a JSON object with EXACTLY this structure:
{
  "overallPurpose": "One paragraph describing what this codebase does and its primary goals",
  "techStack": ["Framework1", "Library2"],
  "architecturalStyle": "e.g. Layered Architecture / Event-Driven / Microservices / MVC",
  "coreSubsystems": [
    { "name": "SubsystemName", "description": "What this group does", "files": ["path/to/file.ts"] }
  ],
  "complexityHotspots": ["path/to/most/complex/file.ts"],
  "entryPoints": ["path/to/entry.ts"],
  "suggestedImprovements": ["Specific improvement 1", "Specific improvement 2"],
  "recommendedOnboardingPath": ["path/to/start.ts", "path/to/core.ts"]
}

Rules:
- Group files into 3-7 meaningful logical subsystems
- "complexityHotspots" = top 5 highest-complexity files that need the most attention
- "suggestedImprovements" = concrete, prioritized recommendations
- "recommendedOnboardingPath" = ordered chronological listing of 5-10 files a beginner should read to understand the system
- Return ONLY valid JSON`;

    try {
        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text()) as GlobalRepoSummary;
    } catch (err: any) {
        console.warn(`[Gemini] Global summary failed: ${err.message}. Trying Ollama fallback...`);
        try {
            const response = await ollama.chat({
                model: 'qwen2.5-coder:3b',
                messages: [{ role: 'user', content: prompt + "\n\nIMPORTANT: Return ONLY valid JSON." }],
                format: 'json',
            });
            const text = response.message.content;
            console.log(`[Ollama] Global summary complete (${text.length} chars)`);
            return JSON.parse(text) as GlobalRepoSummary;
        } catch (ollamaErr: any) {
            console.error(`[Ollama] Global summary fallback failed:`, ollamaErr.message);
            throw err;
        }
    }
}
