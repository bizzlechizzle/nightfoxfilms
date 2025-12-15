"""
Verb Patterns for Timeline-Relevant Date Extraction

Defines timeline-relevant verbs categorized by their semantic meaning.
Dates WITHOUT these verbs are NOT timeline events (just mentions).

VERB CATEGORIES:
- build_date: Construction/creation verbs
- opening: Opening/inauguration verbs
- closure: Closing/shutdown verbs
- demolition: Destruction/tear-down verbs
- renovation: Repair/renovation verbs
- event: Notable events/incidents
- visit: Visits/explorations
- publication: Publication/documentation dates
- ownership: Transfer/acquisition verbs

@version 1.0
"""

from typing import Dict, List, Set


# =============================================================================
# VERB CATEGORY DEFINITIONS
# =============================================================================

VERB_CATEGORIES: Dict[str, Dict[str, any]] = {
    "build_date": {
        "description": "Construction/creation of buildings or structures",
        "verbs": [
            "build", "built", "construct", "constructed", "erect", "erected",
            "establish", "established", "found", "founded", "create", "created",
            "complete", "completed", "finish", "finished", "assemble", "assembled",
            "develop", "developed", "manufacture", "manufactured"
        ],
        "lemmas": [
            "build", "construct", "erect", "establish", "found", "create",
            "complete", "finish", "assemble", "develop", "manufacture"
        ],
        "weight": 1.0,
        "timeline_relevant": True,
    },
    "opening": {
        "description": "Opening/inauguration of facilities",
        "verbs": [
            "open", "opened", "launch", "launched", "inaugurate", "inaugurated",
            "debut", "debuted", "begin", "began", "begun", "start", "started",
            "commence", "commenced", "introduce", "introduced", "unveil", "unveiled"
        ],
        "lemmas": [
            "open", "launch", "inaugurate", "debut", "begin", "start",
            "commence", "introduce", "unveil"
        ],
        "weight": 0.95,
        "timeline_relevant": True,
    },
    "closure": {
        "description": "Closing/shutdown of operations",
        "verbs": [
            "close", "closed", "shut", "shutdown", "cease", "ceased",
            "discontinue", "discontinued", "terminate", "terminated",
            "end", "ended", "stop", "stopped", "halt", "halted",
            "suspend", "suspended", "abandon", "abandoned", "vacate", "vacated"
        ],
        "lemmas": [
            "close", "shut", "cease", "discontinue", "terminate",
            "end", "stop", "halt", "suspend", "abandon", "vacate"
        ],
        "weight": 0.95,
        "timeline_relevant": True,
    },
    "demolition": {
        "description": "Destruction/tear-down of structures",
        "verbs": [
            "demolish", "demolished", "destroy", "destroyed", "raze", "razed",
            "tear", "tore", "torn", "dismantle", "dismantled", "collapse", "collapsed",
            "burn", "burned", "burnt", "implode", "imploded", "level", "leveled"
        ],
        "lemmas": [
            "demolish", "destroy", "raze", "tear", "dismantle", "collapse",
            "burn", "implode", "level"
        ],
        "weight": 1.0,
        "timeline_relevant": True,
    },
    "renovation": {
        "description": "Repair/renovation/restoration",
        "verbs": [
            "renovate", "renovated", "restore", "restored", "repair", "repaired",
            "rebuild", "rebuilt", "remodel", "remodeled", "refurbish", "refurbished",
            "modernize", "modernized", "upgrade", "upgraded", "expand", "expanded",
            "convert", "converted", "repurpose", "repurposed"
        ],
        "lemmas": [
            "renovate", "restore", "repair", "rebuild", "remodel", "refurbish",
            "modernize", "upgrade", "expand", "convert", "repurpose"
        ],
        "weight": 0.85,
        "timeline_relevant": True,
    },
    "event": {
        "description": "Notable events/incidents",
        "verbs": [
            "occur", "occurred", "happen", "happened", "fire", "fired",
            "explode", "exploded", "flood", "flooded", "strike", "struck",
            "damage", "damaged", "injure", "injured", "kill", "killed"
        ],
        "lemmas": [
            "occur", "happen", "fire", "explode", "flood", "strike",
            "damage", "injure", "kill"
        ],
        "weight": 0.9,
        "timeline_relevant": True,
    },
    "visit": {
        "description": "Visits/explorations (often for urbex context)",
        "verbs": [
            "visit", "visited", "explore", "explored", "tour", "toured",
            "photograph", "photographed", "document", "documented",
            "investigate", "investigated"
        ],
        "lemmas": [
            "visit", "explore", "tour", "photograph", "document", "investigate"
        ],
        "weight": 0.6,
        "timeline_relevant": True,
    },
    "publication": {
        "description": "Publication/documentation dates",
        "verbs": [
            "publish", "published", "report", "reported", "announce", "announced",
            "write", "wrote", "written", "post", "posted", "document", "documented"
        ],
        "lemmas": [
            "publish", "report", "announce", "write", "post", "document"
        ],
        "weight": 0.5,
        "timeline_relevant": True,
    },
    "ownership": {
        "description": "Transfer/acquisition of ownership",
        "verbs": [
            "acquire", "acquired", "purchase", "purchased", "buy", "bought",
            "sell", "sold", "transfer", "transferred", "donate", "donated",
            "inherit", "inherited", "own", "owned", "lease", "leased"
        ],
        "lemmas": [
            "acquire", "purchase", "buy", "sell", "transfer", "donate",
            "inherit", "own", "lease"
        ],
        "weight": 0.8,
        "timeline_relevant": True,
    },
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_all_verbs() -> Set[str]:
    """Get all timeline-relevant verbs as a flat set."""
    verbs = set()
    for category in VERB_CATEGORIES.values():
        verbs.update(category["verbs"])
    return verbs


def get_all_lemmas() -> Set[str]:
    """Get all verb lemmas as a flat set."""
    lemmas = set()
    for category in VERB_CATEGORIES.values():
        lemmas.update(category["lemmas"])
    return lemmas


def get_category_for_verb(verb: str) -> str | None:
    """Get the category for a given verb or lemma."""
    verb_lower = verb.lower()
    for category_name, category_data in VERB_CATEGORIES.items():
        if verb_lower in category_data["verbs"] or verb_lower in category_data["lemmas"]:
            return category_name
    return None


def get_category_for_lemma(lemma: str) -> str | None:
    """Get the category for a given lemma."""
    lemma_lower = lemma.lower()
    for category_name, category_data in VERB_CATEGORIES.items():
        if lemma_lower in category_data["lemmas"]:
            return category_name
    return None


def get_weight_for_category(category: str) -> float:
    """Get the weight/importance for a category."""
    if category in VERB_CATEGORIES:
        return VERB_CATEGORIES[category]["weight"]
    return 0.0


def is_timeline_relevant_lemma(lemma: str) -> bool:
    """Check if a lemma indicates timeline relevancy."""
    return lemma.lower() in get_all_lemmas()


def get_categories_summary() -> List[Dict]:
    """Get summary of all categories for API response."""
    return [
        {
            "category": name,
            "description": data["description"],
            "verbs": data["verbs"],
            "weight": data["weight"],
        }
        for name, data in VERB_CATEGORIES.items()
    ]


# =============================================================================
# PRECOMPILED SETS FOR PERFORMANCE
# =============================================================================

ALL_VERBS = get_all_verbs()
ALL_LEMMAS = get_all_lemmas()
