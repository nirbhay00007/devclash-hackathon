import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Sweeps the git history of a target repository line-by-line 
 * and counts how many times each file has been modified in its lifetime.
 * 
 * High churn = High engineering effort / bugs = Architectural hotspot.
 */
export function countGitChurn(repoPath: string): Record<string, number> {
    const churnMap: Record<string, number> = {};

    // Ensure it's actually a git repository before we try to extract
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
        console.warn(`[gitAnalyzer] Directory is not a git repository: ${repoPath}. Skipping churn analysis.`);
        return churnMap;
    }

    try {
        console.log(`[gitAnalyzer] Extracting commit history for churn metrics in: ${repoPath}`);
        
        // This command prints every file modified in every commit (one file per line)
        const stdout = execSync('git log --name-only --format=""', {
            cwd: repoPath,
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024 * 50 // Up to 50MB of text output buffer for big repos
        });

        // Split by lines, drop empty lines, normalize slashes
        const lines = stdout.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
                // We resolve it to an absolute path so it perfectly matches our GraphStore Node IDs
                const absolutePath = path.resolve(repoPath, trimmed).replace(/\\/g, '/');
                churnMap[absolutePath] = (churnMap[absolutePath] || 0) + 1;
            }
        }

        const filesCount = Object.keys(churnMap).length;
        console.log(`[gitAnalyzer] Git history parsed safely. Got churn data for ${filesCount} files.`);
        
        return churnMap;
    } catch (e: any) {
        console.error('[gitAnalyzer] Failed to calculate git churn:', e.message);
        return churnMap;
    }
}
