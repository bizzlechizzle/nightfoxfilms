#!/bin/bash
#
# Start RAM++ Image Tagging Server
#
# Usage:
#   ./start.sh              # Start on default port 8765
#   ./start.sh --port 9000  # Start on custom port
#   RAM_DEVICE=cpu ./start.sh  # Force CPU mode
#
# Environment variables:
#   RAM_PORT    - Server port (default: 8765)
#   RAM_HOST    - Server host (default: 0.0.0.0)
#   RAM_DEVICE  - Device: cuda, mps, or cpu (auto-detected)
#   RAM_MODEL   - Model name (default: ram_plus_swin_large_14m)
#

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found"
    exit 1
fi

# Check if virtual env exists, create if not
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt

    # Install RAM++ from git
    echo "Installing recognize-anything..."
    pip install git+https://github.com/xinyu1205/recognize-anything.git
else
    source venv/bin/activate
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --port)
            export RAM_PORT="$2"
            shift 2
            ;;
        --host)
            export RAM_HOST="$2"
            shift 2
            ;;
        --device)
            export RAM_DEVICE="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Start server
echo "Starting RAM++ server..."
echo "  Port: ${RAM_PORT:-8765}"
echo "  Host: ${RAM_HOST:-0.0.0.0}"
echo "  Device: ${RAM_DEVICE:-auto}"

python ram_api_server.py
