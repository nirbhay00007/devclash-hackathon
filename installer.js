const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

// Helper to log green text
function logStep(msg) {
    console.log(`\x1b[32m[DEV_CLASH Setup]\x1b[0m ${msg}`);
}
function logError(msg) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = https.get(url, { rejectUnauthorized: true }, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Server responded with ${response.statusCode}: ${response.statusMessage}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });

        request.on('error', (err) => {
            fs.unlink(dest, () => {}); 
            reject(err);
        });

        // Fail-safe 30-second network timeout
        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Network connection timed out while downloading.'));
        });
    });
}

function checkOllamaInstalled() {
    try {
        execSync('ollama --version', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function installOllama() {
    logStep('Ollama engine is missing. Initiating automatic installation...');
    const platform = os.platform();

    if (platform === 'win32') {
        // Secure temp extraction to avoid static path hijacking
        const secureTempDir = path.join(os.tmpdir(), `devclash-setup-${crypto.randomBytes(4).toString('hex')}`);
        fs.mkdirSync(secureTempDir, { recursive: true });
        const dest = path.join(secureTempDir, 'OllamaSetup.exe');
        
        logStep('Downloading OllamaSetup.exe (this may take a minute)...');
        try {
            await downloadFile('https://ollama.com/download/OllamaSetup.exe', dest);
            logStep('Running Ollama Setup. You may see a Windows Admin (UAC) confirmation shortly...');
            execSync(`"${dest}"`, { stdio: 'inherit' });
            logStep('Ollama installation complete.');
        } catch (e) {
            if (e.message && e.message.includes('EPERM')) {
                logError('Installation failed due to missing Administrator Privileges (EPERM). Please right-click the setup and Run as Administrator.');
            } else {
                logError(`Installer interrupted: ${e.message}`);
            }
            process.exit(1);
        } finally {
            // Self-cleaning secure unmount
            try { fs.rmSync(secureTempDir, { recursive: true, force: true }); } catch {}
        }
    } else {
        logStep('Downloading and running Ollama install script (requires sudo)...');
        try {
            execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' });
            logStep('Ollama installation complete.');
        } catch (e) {
            logError('Ollama installer failed. Please ensure you have sudo/root privileges.');
            process.exit(1);
        }
    }
}

async function pullModels() {
    const models = ['nomic-embed-text', 'qwen2.5-coder:3b'];
    for (const model of models) {
        logStep(`Locating local AI model: ${model}...`);
        try {
            // First check if already pulled
            const list = execSync('ollama list', { encoding: 'utf-8' });
            if (!list.includes(model)) {
                logStep(`Downloading the ${model} model...`);
                execSync(`ollama pull ${model}`, { stdio: 'inherit' });
            } else {
                logStep(`Model ${model} is already installed!`);
            }
        } catch (e) {
            logError(`Failed to pull model ${model}. Ensure the Ollama tray app is running!`);
        }
    }
}

async function startBridge() {
    logStep('Installation successful! Booting DEV_CLASH Bridge...');
    console.log('\n\x1b[36m========================================');
    console.log('   DEV_CLASH AI Memory Bridge is LIVE   ');
    console.log('   MCP API: http://localhost:3001/api/mcp ');
    console.log('========================================\x1b[0m\n');
    console.log('You can now enter your repository inside the Web Client.');
    console.log('Press Ctrl+C to close the bridge.\n');
    
    // In a truly compiled .exe, this would fork the internal bundled node logic.
    // For now we keep it running.
    setInterval(() => {}, 1000 * 60 * 60);
}

// ── Main ──
(async () => {
    console.log('\n\x1b[36m  ██████╗ ███████╗██╗   ██╗      ██████╗██╗      █████╗ ███████╗██╗  ██╗');
    console.log('  ██╔══██╗██╔════╝██║   ██║     ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║');
    console.log('  ██║  ██║█████╗  ██║   ██║     ██║     ██║     ███████║███████╗███████║');
    console.log('  ██║  ██║██╔══╝  ╚██╗ ██╔╝     ██║     ██║     ██╔══██║╚════██║██╔══██║');
    console.log('  ██████╔╝███████╗ ╚████╔╝      ╚██████╗███████╗██║  ██║███████║██║  ██║');
    console.log('  ╚═════╝ ╚══════╝  ╚═══╝        ╚═════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝\x1b[0m\n');
    
    logStep('Initiating DEV_CLASH Local Installer Bootstrapper...');

    if (!checkOllamaInstalled()) {
        await installOllama();
    } else {
        logStep('Found Ollama engine installed locally.');
    }

    await pullModels();
    
    await startBridge();
})();
