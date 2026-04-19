@echo off
title DEV_CLASH — Local AI Setup
color 0A

echo.
echo  ██████╗ ███████╗██╗   ██╗     ██████╗██╗      █████╗ ███████╗██╗  ██╗
echo  ██╔══██╗██╔════╝██║   ██║    ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║
echo  ██║  ██║█████╗  ██║   ██║    ██║     ██║     ███████║███████╗███████║
echo  ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██║     ██║     ██╔══██║╚════██║██╔══██║
echo  ██████╔╝███████╗ ╚████╔╝     ╚██████╗███████╗██║  ██║███████║██║  ██║
echo  ╚═════╝ ╚══════╝  ╚═══╝       ╚═════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
echo.
echo  AI Codebase Navigator — One-Click Local Setup (Windows)
echo  =========================================================
echo.

:: ─── Step 1: Check for Node.js ───────────────────────────────────────────────
echo [1/6] Checking Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo  ❌ Node.js is NOT installed.
    echo  Please install it from https://nodejs.org (LTS version) and re-run this script.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  ✅ Node.js %NODE_VER% found.

:: ─── Step 2: Check / Install Ollama ─────────────────────────────────────────
echo.
echo [2/6] Checking Ollama...
ollama -v >nul 2>&1
if errorlevel 1 (
    echo  ⚠️  Ollama not found. Downloading installer...
    curl -Lo "%TEMP%\OllamaSetup.exe" "https://ollama.com/download/OllamaSetup.exe"
    if errorlevel 1 (
        echo  ❌ Download failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo  Installing Ollama silently...
    "%TEMP%\OllamaSetup.exe" /S
    timeout /t 5 /nobreak >nul
    echo  ✅ Ollama installed.
) else (
    for /f "tokens=*" %%i in ('ollama -v') do set OLLAMA_VER=%%i
    echo  ✅ Ollama %OLLAMA_VER% already installed.
)

:: ─── Step 3: Start Ollama service ────────────────────────────────────────────
echo.
echo [3/6] Starting Ollama service...
start /B "" ollama serve >nul 2>&1
timeout /t 3 /nobreak >nul
echo  ✅ Ollama service running.

:: ─── Step 4: Pull AI models ───────────────────────────────────────────────────
echo.
echo [4/6] Pulling AI models (this may take a few minutes on first run)...
echo.

echo  📥 Pulling qwen2.5-coder:3b  (code summarization — 1.9 GB)...
ollama pull qwen2.5-coder:3b
if errorlevel 1 (
    echo  ❌ Failed to pull qwen2.5-coder:3b
    pause
    exit /b 1
)
echo  ✅ qwen2.5-coder:3b ready.

echo.
echo  📥 Pulling nomic-embed-text  (vector embeddings — 274 MB)...
ollama pull nomic-embed-text
if errorlevel 1 (
    echo  ❌ Failed to pull nomic-embed-text
    pause
    exit /b 1
)
echo  ✅ nomic-embed-text ready.

:: ─── Step 5: Install Project Dependencies ─────────────────────────────────────
echo.
echo [5/6] Installing Node dependencies...

echo  📥 Installing Backend dependencies...
cd /d "%~dp0..\backend"
call npm install --silent --legacy-peer-deps
if errorlevel 1 (
    echo  ❌ Backend npm install failed.
    pause
    exit /b 1
)

echo.
echo  📥 Installing Frontend dependencies...
cd /d "%~dp0..\frontend_merged"
call npm install --silent
if errorlevel 1 (
    echo  ❌ Frontend npm install failed.
    pause
    exit /b 1
)

cd /d "%~dp0.."
echo  ✅ All dependencies installed.

:: ─── Step 6: Copy .env if not present ────────────────────────────────────────
echo.
echo [6/6] Configuring environment...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  ✅ Created .env from .env.example
        echo  ℹ️  (Optional) Add your GEMINI_API_KEY to .env for global architectural summaries.
    )
) else (
    echo  ✅ .env already configured.
)

:: ─── Done ─────────────────────────────────────────────────────────────────────
echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║         ✅  DEV_CLASH Setup Complete!                     ║
echo  ║                                                           ║
echo  ║  Start the backend:   npm start                           ║
echo  ║  API running at:      http://localhost:3001               ║
echo  ║                                                           ║
echo  ║  Connect Claude Desktop:                                  ║
echo  ║    See setup/CLAUDE_INTEGRATION.md for instructions       ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.
set /p START_NOW="Start the backend now? (y/n): "
if /i "%START_NOW%"=="y" (
    npm start
)
pause
