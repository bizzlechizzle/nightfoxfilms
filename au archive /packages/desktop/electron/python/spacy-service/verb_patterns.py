"""
Verb Patterns for Timeline Relevancy Detection

Maps verbs to timeline categories for date extraction preprocessing.
Used by preprocessor.py to identify timeline-relevant sentences.

@version 1.0
"""

from typing import Optional

# =============================================================================
# TIMELINE VERB PATTERNS
# =============================================================================

TIMELINE_VERBS: dict[str, list[str]] = {
    'build_date': [
        'built', 'constructed', 'erected', 'established', 'founded',
        'completed', 'created', 'designed', 'developed', 'made',
        'dating from', 'dates from', 'originated', 'commissioned',
        'broke ground', 'laid foundation', 'incorporated'
    ],
    'opening': [
        'opened', 'inaugurated', 'launched', 'began operations',
        'started operations', 'commenced', 'debuted', 'premiered',
        'ribbon cutting', 'grand opening', 'dedicated', 'unveiled',
        'doors opened', 'welcomed first'
    ],
    'closure': [
        'closed', 'shut down', 'shuttered', 'abandoned', 'ceased operations',
        'stopped operations', 'went out of business', 'liquidated',
        'bankrupt', 'foreclosed', 'vacated', 'left empty', 'discontinued',
        'ended operations', 'wound down', 'went dark'
    ],
    'demolition': [
        'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed',
        'knocked down', 'leveled', 'wrecked', 'dismantled', 'imploded',
        'pulled down', 'brought down', 'cleared', 'removed'
    ],
    'renovation': [
        'renovated', 'restored', 'refurbished', 'rebuilt', 'expanded',
        'remodeled', 'upgraded', 'modernized', 'repaired', 'improved',
        'converted', 'transformed', 'repurposed', 'rehabilitated',
        'updated', 'overhauled'
    ],
    'event': [
        'burned', 'flooded', 'collapsed', 'exploded', 'damaged',
        'fire', 'explosion', 'accident', 'incident', 'disaster',
        'struck', 'hit', 'destroyed by', 'ravaged', 'devastated',
        'contaminated', 'condemned'
    ],
    'visit': [
        'visited', 'explored', 'photographed', 'toured', 'documented',
        'discovered', 'found', 'stumbled upon', 'came across', 'surveyed',
        'inspected', 'investigated', 'entered'
    ],
    'publication': [
        'published', 'posted', 'wrote', 'updated', 'reported',
        'documented', 'recorded', 'noted', 'mentioned', 'featured',
        'appeared in', 'covered by'
    ],
    'ownership': [
        'sold', 'purchased', 'bought', 'acquired', 'transferred',
        'donated', 'inherited', 'foreclosed', 'auctioned', 'taken over'
    ]
}

# Build flattened lookup for quick access
ALL_TIMELINE_VERBS: dict[str, str] = {}
for category, verbs in TIMELINE_VERBS.items():
    for verb in verbs:
        ALL_TIMELINE_VERBS[verb.lower()] = category


def get_verb_category(verb: str) -> Optional[str]:
    """
    Get the timeline category for a verb.

    Args:
        verb: The verb to look up

    Returns:
        Category name or None if not a timeline verb
    """
    return ALL_TIMELINE_VERBS.get(verb.lower())


def find_verbs_in_text(text: str) -> list[dict]:
    """
    Find all timeline verbs in text with positions.

    Args:
        text: Text to search

    Returns:
        List of verb matches with text, category, and position
    """
    text_lower = text.lower()
    found = []

    # Sort verbs by length (longest first) to match multi-word verbs first
    sorted_verbs = sorted(ALL_TIMELINE_VERBS.keys(), key=len, reverse=True)

    # Track positions already matched to avoid overlapping
    matched_positions = set()

    for verb in sorted_verbs:
        pos = 0
        while True:
            pos = text_lower.find(verb, pos)
            if pos == -1:
                break

            # Check if this position range is already matched
            verb_range = set(range(pos, pos + len(verb)))
            if verb_range & matched_positions:
                pos += 1
                continue

            # Check word boundary
            before_ok = pos == 0 or not text_lower[pos - 1].isalnum()
            end_pos = pos + len(verb)
            after_ok = end_pos >= len(text_lower) or not text_lower[end_pos].isalnum()

            if before_ok and after_ok:
                found.append({
                    'text': verb,
                    'category': ALL_TIMELINE_VERBS[verb],
                    'position': pos
                })
                matched_positions.update(verb_range)

            pos += 1

    return sorted(found, key=lambda x: x['position'])


def get_all_verbs_for_category(category: str) -> list[str]:
    """
    Get all verbs for a specific category.

    Args:
        category: Category name (e.g., 'build_date', 'closure')

    Returns:
        List of verbs for that category
    """
    return TIMELINE_VERBS.get(category, [])


def get_all_categories() -> list[str]:
    """Get list of all verb categories."""
    return list(TIMELINE_VERBS.keys())


# =============================================================================
# RELEVANCY SCORING
# =============================================================================

def calculate_verb_relevancy(verbs: list[dict], has_date: bool) -> tuple[str, float]:
    """
    Calculate relevancy based on verbs and presence of date.

    Args:
        verbs: List of verb matches from find_verbs_in_text
        has_date: Whether a date entity was found in the same context

    Returns:
        Tuple of (relevancy_type, confidence)
    """
    if not verbs:
        return ('context', 0.3)

    # Get most relevant verb (highest priority category)
    CATEGORY_PRIORITY = {
        'build_date': 1,
        'demolition': 2,
        'closure': 3,
        'opening': 4,
        'event': 5,
        'renovation': 6,
        'ownership': 7,
        'visit': 8,
        'publication': 9
    }

    best_verb = min(verbs, key=lambda v: CATEGORY_PRIORITY.get(v['category'], 100))
    category = best_verb['category']

    # Calculate confidence
    if has_date:
        # High confidence timeline event
        confidence = 0.95 if category in ('build_date', 'demolition', 'closure', 'opening') else 0.85
        relevancy = 'timeline'
    else:
        # Possible timeline event, needs date from LLM
        confidence = 0.7 if category in ('build_date', 'demolition', 'closure', 'opening') else 0.5
        relevancy = 'timeline_possible'

    return (relevancy, confidence)
