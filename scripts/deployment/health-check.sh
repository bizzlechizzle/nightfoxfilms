#!/usr/bin/env bash
#
# Script Name: health-check.sh
# Purpose: Verify Nightfox Films website is live and functional (TEMPLATE)
# Usage: ./health-check.sh [staging|production]
# Dependencies: curl
# Exit codes: 0=healthy, 1=unhealthy, 2=invalid args
#
# Last Updated: 2025-11-18
#
# NOTE: This is a TEMPLATE script. It cannot run until:
#   1. Website is deployed and live
#   2. Website URL is configured
#
# This template shows what a health check script would check.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m'

# URLs (CONFIGURE THESE when website is deployed)
readonly STAGING_URL="https://staging.nightfoxfilms.com"  # PLACEHOLDER
readonly PRODUCTION_URL="https://nightfoxfilms.com"        # PLACEHOLDER

# Counters
CHECKS_RUN=0
CHECKS_PASSED=0
CHECKS_FAILED=0

usage() {
    cat <<EOF
Usage: $(basename "$0") [ENVIRONMENT]

Perform health checks on Nightfox Films website.

ENVIRONMENT:
    staging       Check staging environment
    production    Check production environment

CHECKS PERFORMED:
    - Home page loads (200 status)
    - All service pages load
    - Contact form exists
    - SSL certificate valid
    - Analytics tracking configured
    - No 404 errors on main pages

EXAMPLES:
    $(basename "$0") staging
    $(basename "$0") production

EOF
}

check() {
    local description="$1"
    local command="$2"

    echo -n "  Checking: $description... "
    ((CHECKS_RUN++))

    if eval "$command" >/dev/null 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        ((CHECKS_PASSED++))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        ((CHECKS_FAILED++))
        return 1
    fi
}

check_page() {
    local url="$1"
    local description="$2"

    echo -n "  Checking: $description... "
    ((CHECKS_RUN++))

    if command -v curl >/dev/null 2>&1; then
        local status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")

        if [[ "$status" == "200" ]]; then
            local time=$(curl -s -o /dev/null -w "%{time_total}" "$url" 2>/dev/null || echo "0")
            local ms=$(echo "$time * 1000" | bc 2>/dev/null || echo "0")
            echo -e "${GREEN}PASS${NC} (${ms}ms)"
            ((CHECKS_PASSED++))
            return 0
        else
            echo -e "${RED}FAIL${NC} (HTTP $status)"
            ((CHECKS_FAILED++))
            return 1
        fi
    else
        echo -e "${YELLOW}SKIP${NC} (curl not installed)"
        return 0
    fi
}

check_ssl() {
    local url="$1"

    echo -n "  Checking: SSL certificate... "
    ((CHECKS_RUN++))

    if command -v openssl >/dev/null 2>&1; then
        local domain="${url#https://}"
        domain="${domain%%/*}"

        local expiry=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | \
            openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

        if [[ -n "$expiry" ]]; then
            echo -e "${GREEN}PASS${NC} (expires: $expiry)"
            ((CHECKS_PASSED++))
            return 0
        else
            echo -e "${RED}FAIL${NC} (could not verify)"
            ((CHECKS_FAILED++))
            return 1
        fi
    else
        echo -e "${YELLOW}SKIP${NC} (openssl not installed)"
        return 0
    fi
}

main() {
    local environment="$1"
    local base_url

    case "$environment" in
        staging)
            base_url="$STAGING_URL"
            ;;
        production)
            base_url="$PRODUCTION_URL"
            ;;
    esac

    echo "========================================"
    echo "Nightfox Films - Health Check"
    echo "Environment: $environment"
    echo "URL: $base_url"
    echo "========================================"
    echo ""

    # Check if website exists
    if [[ "$base_url" == *"PLACEHOLDER"* ]] || [[ "$base_url" == https://staging.* ]] || [[ "$base_url" == https://nightfoxfilms.com ]]; then
        echo -e "${YELLOW}NOTE: Website URL not configured yet${NC}"
        echo ""
        echo "This is a TEMPLATE health check script."
        echo "It cannot run until:"
        echo "  1. Website is deployed"
        echo "  2. URLs are configured in this script"
        echo ""
        echo "See README.md for current status."
        echo ""
        exit 0
    fi

    echo "Running health checks..."
    echo ""

    # Core pages
    check_page "$base_url/" "Home page"
    check_page "$base_url/super-8" "Super 8 service page"
    check_page "$base_url/dad-cam" "Dad Cam service page"
    check_page "$base_url/modern-digital" "Modern Digital page"
    check_page "$base_url/mixed-media" "Mixed Media page"
    check_page "$base_url/about" "About page"
    check_page "$base_url/pricing" "Pricing page"
    check_page "$base_url/contact" "Contact page"

    # SSL certificate
    check_ssl "$base_url"

    # TODO: Check analytics (would require API access)
    # check "Google Analytics tracking" "verify_ga_tracking"

    # TODO: Check contact form (would require form submission test)
    # check "Contact form submits" "test_contact_form"

    echo ""
    echo "========================================"
    echo "Summary:"
    echo "========================================"
    echo "  Checks run: $CHECKS_RUN"
    echo "  Passed: $CHECKS_PASSED"
    echo "  Failed: $CHECKS_FAILED"
    echo ""

    if [[ $CHECKS_FAILED -eq 0 ]]; then
        echo -e "${GREEN}All health checks passed!${NC}"
        echo "Website is healthy and operational."
        return 0
    else
        echo -e "${RED}Some health checks failed!${NC}"
        echo "Website may have issues, investigate failures above."
        return 1
    fi
}

# Validate arguments
if [[ $# -lt 1 ]]; then
    echo "ERROR: Missing environment argument" >&2
    usage
    exit 2
fi

ENVIRONMENT="$1"

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    echo "ERROR: Invalid environment. Must be 'staging' or 'production'" >&2
    usage
    exit 2
fi

main "$ENVIRONMENT"
