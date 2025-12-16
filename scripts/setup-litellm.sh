#!/bin/bash
#
# Setup LiteLLM for Nightfox Films
#
# Creates a Python virtual environment with LiteLLM installed.
# This venv is detected automatically by the app.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/litellm-venv"

echo "==================================="
echo "Nightfox Films - LiteLLM Setup"
echo "==================================="
echo ""

# Check Python version
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3.9+."
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | cut -d' ' -f2)
echo "Found Python: $PYTHON_VERSION"

# Check if venv already exists
if [ -d "$VENV_DIR" ]; then
    echo ""
    echo "Virtual environment already exists at:"
    echo "  $VENV_DIR"
    echo ""
    read -p "Recreate it? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Removing existing venv..."
        rm -rf "$VENV_DIR"
    else
        echo "Keeping existing venv. Checking LiteLLM..."
        source "$VENV_DIR/bin/activate"
        if python -c "import litellm" 2>/dev/null; then
            echo "LiteLLM is already installed."
            LITELLM_VERSION=$(python -c "import litellm; print(getattr(litellm, '__version__', 'installed'))" 2>/dev/null || echo "installed")
            echo "Version: $LITELLM_VERSION"
            echo ""
            echo "Setup complete. LiteLLM is ready to use."
            exit 0
        else
            echo "LiteLLM not found in venv. Installing..."
        fi
    fi
fi

# Create virtual environment
echo ""
echo "Creating virtual environment..."
$PYTHON_CMD -m venv "$VENV_DIR"

# Activate venv
source "$VENV_DIR/bin/activate"

# Upgrade pip
echo ""
echo "Upgrading pip..."
pip install --upgrade pip --quiet

# Install LiteLLM
echo ""
echo "Installing LiteLLM..."
pip install litellm --quiet

# Verify installation
echo ""
echo "Verifying installation..."
if python -c "import litellm" 2>/dev/null; then
    # Try to get version (may not be available in all versions)
    LITELLM_VERSION=$(python -c "import litellm; print(getattr(litellm, '__version__', 'installed'))" 2>/dev/null || echo "installed")
    echo "LiteLLM installed successfully!"
    echo "Version: $LITELLM_VERSION"
else
    echo "Error: LiteLLM installation failed."
    exit 1
fi

# Show venv location
echo ""
echo "==================================="
echo "Setup Complete"
echo "==================================="
echo ""
echo "Virtual environment: $VENV_DIR"
echo "Python: $VENV_DIR/bin/python"
echo "LiteLLM: $VENV_DIR/bin/litellm"
echo ""
echo "The Nightfox app will automatically detect and use this venv."
echo ""
