#!/usr/bin/env python3
"""
Screenshot Tool Integration Test

This script tests all components of the screenshot tool to verify
the implementation is working correctly.

Usage:
    cd packages/desktop/python
    source venv/bin/activate
    python test_screenshot_tool.py
"""

import os
import sys
import json
import time
import tempfile
import subprocess
import requests
from pathlib import Path

# Test configuration
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
SERVER_URL = f"http://{SERVER_HOST}:{SERVER_PORT}"
TIMEOUT = 30


def print_result(test_name: str, passed: bool, message: str = ""):
    """Print test result with formatting."""
    status = "PASS" if passed else "FAIL"
    color = "\033[92m" if passed else "\033[91m"
    reset = "\033[0m"
    print(f"  [{color}{status}{reset}] {test_name}")
    if message:
        print(f"        {message}")


def test_imports():
    """Test that all modules can be imported."""
    print("\n1. Testing imports...")

    try:
        from screenshot_tool.pipeline import (
            ScreenshotPipeline,
            SceneDetector,
            QualityFilter,
            FaceDetector,
            ContentTagger,
            SmartCropper,
            FaceClusterer,
            get_device,
        )
        print_result("Pipeline modules", True)
    except ImportError as e:
        print_result("Pipeline modules", False, str(e))
        return False

    try:
        from screenshot_tool.server import app
        print_result("Server module", True)
    except ImportError as e:
        print_result("Server module", False, str(e))
        return False

    return True


def test_device_detection():
    """Test device detection (CPU/CUDA/MPS)."""
    print("\n2. Testing device detection...")

    from screenshot_tool.pipeline import get_device
    device = get_device()

    valid_devices = ['cpu', 'cuda', 'mps']
    passed = device in valid_devices
    print_result("Device detection", passed, f"Detected: {device}")

    return passed


def test_quality_filter():
    """Test quality filter with a synthetic image."""
    print("\n3. Testing quality filter...")

    import numpy as np
    import cv2
    from screenshot_tool.pipeline import QualityFilter

    # Create a sharp test image
    sharp_image = np.zeros((100, 100, 3), dtype=np.uint8)
    cv2.rectangle(sharp_image, (10, 10), (90, 90), (255, 255, 255), 2)
    cv2.line(sharp_image, (0, 0), (100, 100), (128, 128, 128), 1)

    # Create a blurry test image
    blurry_image = cv2.GaussianBlur(sharp_image, (21, 21), 0)

    qf = QualityFilter()
    sharp_score = qf.compute_sharpness(sharp_image)
    blurry_score = qf.compute_sharpness(blurry_image)

    passed = sharp_score > blurry_score
    print_result("Sharpness comparison", passed,
                f"Sharp={sharp_score:.2f}, Blurry={blurry_score:.2f}")

    return passed


def test_server_startup():
    """Test that the server can start and respond to health checks."""
    print("\n4. Testing server startup...")

    # Start server in background
    python_path = sys.executable
    server_proc = subprocess.Popen(
        [python_path, "-m", "screenshot_tool.server",
         "--host", SERVER_HOST, "--port", str(SERVER_PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(Path(__file__).parent),
    )

    # Wait for server to start
    time.sleep(3)

    try:
        # Test health endpoint
        response = requests.get(f"{SERVER_URL}/health", timeout=5)
        health = response.json()

        passed = response.status_code == 200 and health.get("status") == "healthy"
        print_result("Health endpoint", passed,
                    f"Status: {health.get('status')}, Device: {health.get('device')}")

        return passed, server_proc

    except Exception as e:
        print_result("Health endpoint", False, str(e))
        server_proc.terminate()
        return False, None


def test_quality_endpoint(server_proc):
    """Test the quality scoring endpoint."""
    print("\n5. Testing quality endpoint...")

    import numpy as np
    import cv2

    # Create a test image
    test_image = np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8)

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        cv2.imwrite(f.name, test_image)
        temp_path = f.name

    try:
        response = requests.post(
            f"{SERVER_URL}/quality-score",
            json={"image_path": temp_path},
            timeout=10,
        )
        result = response.json()

        passed = result.get("success", False)
        print_result("Quality scoring", passed,
                    f"Sharpness: {result.get('sharpness', 'N/A')}")

        return passed

    except Exception as e:
        print_result("Quality scoring", False, str(e))
        return False

    finally:
        os.unlink(temp_path)


def test_crops_endpoint(server_proc):
    """Test the smart cropping endpoint."""
    print("\n6. Testing smart cropping endpoint...")

    import numpy as np
    import cv2

    # Create a larger test image
    test_image = np.zeros((1920, 1080, 3), dtype=np.uint8)
    cv2.rectangle(test_image, (400, 300), (700, 600), (255, 255, 255), -1)

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        cv2.imwrite(f.name, test_image)
        temp_path = f.name

    try:
        response = requests.post(
            f"{SERVER_URL}/generate-crops",
            json={"image_path": temp_path},
            timeout=30,
        )
        result = response.json()

        passed = result.get("success", False) and "crops" in result
        crops = result.get("crops", {})
        print_result("Smart cropping", passed,
                    f"Generated {len(crops)} crop variants")

        if crops:
            for name, crop in crops.items():
                print(f"        - {name}: {crop.get('width')}x{crop.get('height')}")

        return passed

    except Exception as e:
        print_result("Smart cropping", False, str(e))
        return False

    finally:
        os.unlink(temp_path)


def cleanup_server(server_proc):
    """Cleanup server process."""
    if server_proc:
        server_proc.terminate()
        server_proc.wait(timeout=5)


def main():
    """Run all tests."""
    print("=" * 60)
    print("Screenshot Tool Integration Test")
    print("=" * 60)

    all_passed = True
    server_proc = None

    try:
        # Test 1: Imports
        if not test_imports():
            all_passed = False
            print("\nCritical: Import tests failed. Stopping.")
            return 1

        # Test 2: Device detection
        if not test_device_detection():
            all_passed = False

        # Test 3: Quality filter
        if not test_quality_filter():
            all_passed = False

        # Test 4: Server startup
        passed, server_proc = test_server_startup()
        if not passed:
            all_passed = False
            print("\nCritical: Server failed to start. Stopping.")
            return 1

        # Test 5: Quality endpoint
        if not test_quality_endpoint(server_proc):
            all_passed = False

        # Test 6: Crops endpoint
        if not test_crops_endpoint(server_proc):
            all_passed = False

    finally:
        cleanup_server(server_proc)

    # Summary
    print("\n" + "=" * 60)
    if all_passed:
        print("\033[92mAll tests passed!\033[0m")
        print("The screenshot tool is ready for use.")
        return 0
    else:
        print("\033[91mSome tests failed.\033[0m")
        print("Please review the output above and fix any issues.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
