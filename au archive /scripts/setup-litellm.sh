#!/bin/bash
# =============================================================================
# LiteLLM Setup Script for AU Archive
# =============================================================================
#
# Creates a dedicated Python virtual environment with LiteLLM installed.
# This ensures the app doesn't depend on the user's system Python.
#
# Usage:
#   ./scripts/setup-litellm.sh              # Setup venv
#   ./scripts/setup-litellm.sh --check      # Check if installed
#   ./scripts/setup-litellm.sh --uninstall  # Remove venv
#
# Location: scripts/litellm-venv/
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/litellm-venv"
PYTHON_CMD=""
MIN_PYTHON_VERSION="3.9"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# Python Detection
# =============================================================================

find_python() {
    # Try python3 first, then python
    for cmd in python3 python; do
        if command -v "$cmd" &> /dev/null; then
            version=$($cmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
            if [[ -n "$version" ]]; then
                major=$(echo "$version" | cut -d. -f1)
                minor=$(echo "$version" | cut -d. -f2)
                if [[ "$major" -ge 3 && "$minor" -ge 9 ]]; then
                    PYTHON_CMD="$cmd"
                    log_info "Found Python $version at $(which $cmd)"
                    return 0
                fi
            fi
        fi
    done
    return 1
}

# =============================================================================
# Commands
# =============================================================================

check_installation() {
    if [[ -d "$VENV_DIR" && -f "$VENV_DIR/bin/python" ]]; then
        # Check if litellm is installed
        if "$VENV_DIR/bin/python" -c "import litellm" 2>/dev/null; then
            # Try to get version (attribute name varies by version)
            version=$("$VENV_DIR/bin/python" -c "import litellm; print(getattr(litellm, '__version__', getattr(litellm, 'version', 'unknown')))" 2>/dev/null || echo "installed")
            log_info "LiteLLM $version at $VENV_DIR"
            return 0
        else
            log_warn "Venv exists but LiteLLM not installed"
            return 1
        fi
    else
        log_info "LiteLLM not installed"
        return 1
    fi
}

install_litellm() {
    log_info "Setting up LiteLLM virtual environment..."

    # Find Python
    if ! find_python; then
        log_error "Python $MIN_PYTHON_VERSION+ required but not found"
        log_error "Install Python from https://www.python.org/downloads/"
        exit 1
    fi

    # Remove existing venv if present
    if [[ -d "$VENV_DIR" ]]; then
        log_info "Removing existing venv..."
        rm -rf "$VENV_DIR"
    fi

    # Create venv
    log_info "Creating virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"

    # Activate and install
    log_info "Installing LiteLLM and dependencies..."
    source "$VENV_DIR/bin/activate"

    # Upgrade pip first
    pip install --upgrade pip --quiet

    # Install LiteLLM with proxy extras
    pip install \
        "litellm[proxy]>=1.40.0" \
        "python-dotenv>=1.0.0" \
        "pyyaml>=6.0" \
        --quiet

    deactivate

    log_info "LiteLLM setup complete!"
    log_info "Venv location: $VENV_DIR"

    # Verify installation
    if check_installation; then
        return 0
    else
        log_error "Installation verification failed"
        return 1
    fi
}

uninstall_litellm() {
    if [[ -d "$VENV_DIR" ]]; then
        log_info "Removing LiteLLM virtual environment..."
        rm -rf "$VENV_DIR"
        log_info "Uninstall complete"
    else
        log_info "Nothing to uninstall"
    fi
}

# =============================================================================
# Main
# =============================================================================

case "${1:-}" in
    --check)
        check_installation
        ;;
    --uninstall)
        uninstall_litellm
        ;;
    --help|-h)
        echo "LiteLLM Setup Script for AU Archive"
        echo ""
        echo "Usage:"
        echo "  ./scripts/setup-litellm.sh              # Install LiteLLM"
        echo "  ./scripts/setup-litellm.sh --check      # Check installation"
        echo "  ./scripts/setup-litellm.sh --uninstall  # Remove installation"
        echo "  ./scripts/setup-litellm.sh --help       # Show this help"
        ;;
    *)
        install_litellm
        ;;
esac
