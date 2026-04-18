@echo off
REM ══════════════════════════════════════════════════════
REM  DEV_CLASH — Full System Launcher (Windows)
REM
REM  Starts both microservices in separate windows:
REM    1. Java AST Backend   → http://localhost:8080
REM    2. Node.js ML Backend → http://localhost:3001
REM ══════════════════════════════════════════════════════

echo.
echo  ██████╗ ███████╗██╗   ██╗      ██████╗██╗      █████╗ ███████╗██╗  ██╗
echo  ██╔══██╗██╔════╝██║   ██║     ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║
echo  ██║  ██║█████╗  ██║   ██║     ██║     ██║     ███████║███████╗███████║
echo  ██║  ██║██╔══╝  ╚██╗ ██╔╝     ██║     ██║     ██╔══██║╚════██║██╔══██║
echo  ██████╔╝███████╗ ╚████╔╝      ╚██████╗███████╗██║  ██║███████║██║  ██║
echo  ╚═════╝ ╚══════╝  ╚═══╝        ╚═════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
echo.
echo  Starting full system...
echo.

REM ── 1. Java AST Backend ──────────────────────────────────────────────────────
echo  [1/2] Starting Java AST Backend on port 8080...
start "DEV_CLASH - Java AST Backend" cmd /k "cd java-backend && mvnw.cmd spring-boot:run"

REM Wait briefly to allow Java to bind port before Node starts
timeout /t 5 /nobreak >nul

REM ── 2. Node.js ML Backend ────────────────────────────────────────────────────
echo  [2/2] Starting Node.js ML Backend on port 3001...
start "DEV_CLASH - Node ML Backend" cmd /k "cd backend && npm start"

echo.
echo  ✅ Both services launched in separate windows.
echo.
echo  Services:
echo    Java AST Backend  → http://localhost:8080/repo/health
echo    Node ML Backend   → http://localhost:3001/api/status
echo.
echo  Press any key to exit this launcher...
pause >nul
