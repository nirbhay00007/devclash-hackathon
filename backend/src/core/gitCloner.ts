import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Clones a GitHub repository to a local temp directory.
 * Returns the absolute local path where the repo was cloned.
 *
 * Used by the Node.js ML pipeline to handle TS/JS repos given a GitHub URL,
 * without needing the Java backend.
 */
export function cloneRepoLocally(repoUrl: string): string {
    // Derive a clean repo name: "https://github.com/user/my-repo" → "my-repo"
    const repoSegment = repoUrl.replace(/\.git\s*$/, '').split('/').pop() ?? 'repo';
    const timestamp   = Date.now();
    const cloneDir    = path.join(process.cwd(), 'repos', `${repoSegment}_${timestamp}`);

    fs.mkdirSync(cloneDir, { recursive: true });

    console.log(`[gitCloner] Cloning ${repoUrl} → ${cloneDir}`);
    try {
        execSync(`git clone --depth 1 "${repoUrl}" "${cloneDir}"`, {
            stdio: 'inherit',
            timeout: 120_000,   // 2 minutes
        });
    } catch (err: any) {
        // Clean up on failure
        try { fs.rmSync(cloneDir, { recursive: true, force: true }); } catch {}
        throw new Error(`git clone failed for "${repoUrl}": ${err.message ?? err}`);
    }

    return cloneDir;
}
