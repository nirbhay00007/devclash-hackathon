#!/bin/bash
# ══════════════════════════════════════════════════════
#  DEV_CLASH — Full System Launcher (Linux / macOS)
#  Starts both microservices:
#    1. Java AST Backend   → http://localhost:8080
#    2. Node.js ML Backend → http://localhost:3001
# ══════════════════════════════════════════════════════

set -e

echo ""
echo "  DEV_CLASH — Full System Launcher"
echo ""

# 1. Java AST Backend (background)
echo "  [1/2] Starting Java AST Backend on port 8080..."
cd java-backend && ./mvnw spring-boot:run &
JAVA_PID=$!
cd ..

echo "  Waiting 8s for Java to bind port 8080..."
sleep 8

# 2. Node.js ML Backend (foreground so logs are visible)
echo "  [2/2] Starting Node.js ML Backend on port 3001..."
cd backend && npm start &
NODE_PID=$!
cd ..

echo ""
echo "  ✅ Both services are running."
echo "  Java AST Backend  → http://localhost:8080/repo/health  (PID $JAVA_PID)"
echo "  Node ML Backend   → http://localhost:3001/api/status   (PID $NODE_PID)"
echo ""
echo "  Press CTRL+C to stop both services."

# Keep alive and propagate SIGINT to child processes
trap "echo '  Shutting down...'; kill $JAVA_PID $NODE_PID 2>/dev/null; exit 0" INT
wait
