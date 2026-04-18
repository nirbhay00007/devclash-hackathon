const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

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
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirect specifically for Ollama downloads
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // Delete the file async
            reject(err);
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
        const dest = path.join(os.tmpdir(), 'OllamaSetup.exe');
        logStep('Downloading OllamaSetup.exe (this may take a minute)...');
        await downloadFile('https://ollama.com/download/OllamaSetup.exe', dest);
        logStep('Running Ollama Setup. You may see a Windows Admin confirmation shortly...');
        try {
            // Run silently if possible, but standard execute works.
            execSync(`"${dest}"`, { stdio: 'inherit' });
            logStep('Ollama installation complete.');
        } catch (e) {
            logError('Ollama installer exited or was cancelled.');
            process.exit(1);
        }
    } else {
        logStep('Downloading and running Ollama install script (requires sudo)...');
        try {
            execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' });
            logStep('Ollama installation complete.');
        } catch (e) {
            logError('Ollama installer failed.');
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
