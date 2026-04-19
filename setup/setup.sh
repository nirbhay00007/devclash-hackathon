#!/usr/bin/env bash
set -e

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo -e "${CYAN} ██████╗ ███████╗██╗   ██╗     ██████╗██╗      █████╗ ███████╗██╗  ██╗${NC}"
echo -e "${CYAN} ██╔══██╗██╔════╝██║   ██║    ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║${NC}"
echo -e "${CYAN} ██║  ██║█████╗  ██║   ██║    ██║     ██║     ███████║███████╗███████║${NC}"
echo -e "${CYAN} ██║  ██║██╔══╝  ╚██╗ ██╔╝    ██║     ██║     ██╔══██║╚════██║██╔══██║${NC}"
echo -e "${CYAN} ██████╔╝███████╗ ╚████╔╝     ╚██████╗███████╗██║  ██║███████║██║  ██║${NC}"
echo -e "${CYAN} ╚═════╝ ╚══════╝  ╚═══╝       ╚═════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝${NC}"
echo ""
echo " AI Codebase Navigator — One-Click Local Setup (Mac/Linux)"
echo " ============================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/.."

# ─── Step 1: Node.js ─────────────────────────────────────────────────────────
echo "[1/6] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "  ${RED}❌ Node.js not found.${NC}"
    echo "  Install from https://nodejs.org (LTS) and re-run."
    exit 1
fi
echo -e "  ${GREEN}✅ Node.js $(node -v) found.${NC}"

# ─── Step 2: Ollama ──────────────────────────────────────────────────────────
echo ""
echo "[2/6] Checking Ollama..."
if ! command -v ollama &> /dev/null; then
    echo -e "  ${YELLOW}⚠️  Ollama not found. Installing...${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew install ollama 2>/dev/null || curl -fsSL https://ollama.com/install.sh | sh
    else
        # Linux
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    echo -e "  ${GREEN}✅ Ollama installed.${NC}"
else
    echo -e "  ${GREEN}✅ Ollama $(ollama -v) already installed.${NC}"
fi

# ─── Step 3: Start Ollama service ────────────────────────────────────────────
echo ""
echo "[3/6] Starting Ollama service..."
if ! pgrep -x "ollama" > /dev/null; then
    ollama serve &>/dev/null &
    sleep 2
fi
echo -e "  ${GREEN}✅ Ollama service running.${NC}"

# ─── Step 4: Pull models ─────────────────────────────────────────────────────
echo ""
echo "[4/6] Pulling AI models (may take a few minutes on first run)..."

echo ""
echo "  📥 qwen2.5-coder:3b  (code summarization — 1.9 GB)..."
ollama pull qwen2.5-coder:3b
echo -e "  ${GREEN}✅ qwen2.5-coder:3b ready.${NC}"

echo ""
echo "  📥 nomic-embed-text  (semantic embeddings — 274 MB)..."
ollama pull nomic-embed-text
echo -e "  ${GREEN}✅ nomic-embed-text ready.${NC}"

# ─── Step 5: npm install ─────────────────────────────────────────────────────
echo ""
echo "[5/6] Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --silent
echo -e "  ${GREEN}✅ Dependencies installed.${NC}"

# ─── Step 6: .env ────────────────────────────────────────────────────────────
echo ""
echo "[6/6] Configuring environment..."
if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "  ${GREEN}✅ Created .env from .env.example${NC}"
    echo -e "  ${CYAN}ℹ️  (Optional) Add GEMINI_API_KEY to .env for architectural summaries.${NC}"
else
    echo -e "  ${GREEN}✅ .env already configured.${NC}"
fi

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}  ╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}  ║         ✅  DEV_CLASH Setup Complete!                     ║${NC}"
echo -e "${GREEN}  ║                                                           ║${NC}"
echo -e "${GREEN}  ║  Start the backend:   npm start                           ║${NC}"
echo -e "${GREEN}  ║  API running at:      http://localhost:3001               ║${NC}"
echo -e "${GREEN}  ║                                                           ║${NC}"
echo -e "${GREEN}  ║  Connect Claude Desktop:                                  ║${NC}"
echo -e "${GREEN}  ║    See setup/CLAUDE_INTEGRATION.md for instructions       ║${NC}"
echo -e "${GREEN}  ╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

read -p "Start the backend now? (y/n): " START_NOW
if [[ "$START_NOW" == "y" || "$START_NOW" == "Y" ]]; then
    npm start
fi
