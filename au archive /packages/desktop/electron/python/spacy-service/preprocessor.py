"""
Preprocessor for LLM Input

Uses spaCy for NER and sentence segmentation, combined with verb detection
to create structured context packages for LLM extraction.

Key Features:
- Sentence-level relevancy classification
- Verb detection with category mapping
- Entity extraction with type inference
- Profile candidate identification
- Context building for LLM prompts

@version 1.0
"""

import re
from typing import Optional

import spacy

from verb_patterns import find_verbs_in_text, calculate_verb_relevancy

# =============================================================================
# ROLE/TYPE INFERENCE KEYWORDS
# =============================================================================

PERSON_ROLE_KEYWORDS: dict[str, list[str]] = {
    'founder': ['founded', 'founder', 'established by', 'started by', 'created by'],
    'owner': ['owned', 'owner', 'proprietor', 'purchased by', 'bought by'],
    'architect': ['designed', 'architect', 'designed by', 'architectural'],
    'developer': ['developed', 'developer', 'built by', 'constructed by'],
    'employee': ['worked', 'employee', 'worker', 'employed', 'staff'],
    'photographer': ['photographed', 'photographer', 'photo by', 'photos by'],
    'visitor': ['visited', 'explored', 'toured', 'explorer'],
    'historian': ['historian', 'researcher', 'documented', 'chronicled']
}

ORG_TYPE_KEYWORDS: dict[str, list[str]] = {
    'company': ['company', 'corporation', 'corp', 'inc', 'llc', 'factory', 'plant', 'mill', 'manufacturing'],
    'hospital': ['hospital', 'medical', 'clinic', 'health', 'sanatorium', 'asylum', 'infirmary'],
    'school': ['school', 'university', 'college', 'academy', 'institute', 'education'],
    'church': ['church', 'cathedral', 'chapel', 'temple', 'synagogue', 'parish', 'religious'],
    'government': ['department', 'agency', 'bureau', 'city of', 'state of', 'county', 'municipal'],
    'military': ['army', 'navy', 'air force', 'military', 'base', 'fort', 'arsenal'],
    'nonprofit': ['foundation', 'charity', 'nonprofit', 'association', 'society']
}

COMPANY_RELATIONSHIP_KEYWORDS: dict[str, list[str]] = {
    'owner': ['owned', 'owner', 'proprietor'],
    'operator': ['operated', 'ran', 'managed', 'operated by'],
    'builder': ['built', 'constructed', 'erected'],
    'tenant': ['leased', 'rented', 'tenant', 'occupied'],
    'demolisher': ['demolished', 'razed', 'torn down']
}


def preprocess_text(
    text: str,
    nlp,
    article_date: Optional[str] = None
) -> dict:
    """
    Preprocess text for LLM extraction.

    Creates a structured context package with:
    - Sentence-level analysis
    - Entity extraction
    - Verb detection
    - Relevancy classification

    Args:
        text: Raw text to preprocess
        nlp: Loaded spaCy model
        article_date: Optional article date for context

    Returns:
        Structured preprocessing result
    """
    doc = nlp(text)

    sentences = []
    timeline_candidates = []
    profile_candidates = {'people': [], 'organizations': []}

    # Track seen entities for deduplication
    seen_people = {}
    seen_orgs = {}

    for sent in doc.sents:
        sent_text = sent.text.strip()
        if not sent_text or len(sent_text) < 10:
            continue

        # Get entities in this sentence
        entities = []
        has_date = False
        has_person = False
        has_org = False

        for ent in doc.ents:
            if ent.start_char >= sent.start_char and ent.end_char <= sent.end_char:
                entity_data = {
                    'text': ent.text,
                    'type': ent.label_,
                    'start': ent.start_char - sent.start_char,
                    'end': ent.end_char - sent.start_char
                }
                entities.append(entity_data)

                if ent.label_ == 'DATE':
                    has_date = True
                elif ent.label_ == 'PERSON':
                    has_person = True
                    _track_person(seen_people, ent.text, sent_text)
                elif ent.label_ == 'ORG':
                    has_org = True
                    _track_org(seen_orgs, ent.text, sent_text)

        # Find verbs in sentence
        verbs = find_verbs_in_text(sent_text)

        # Calculate relevancy
        relevancy, confidence = calculate_verb_relevancy(verbs, has_date)

        # Override for profile-only sentences
        if relevancy == 'context' and (has_person or has_org):
            relevancy = 'profile'
            confidence = 0.75

        sentence_data = {
            'text': sent_text,
            'relevancy': relevancy,
            'relevancy_type': verbs[0]['category'] if verbs else None,
            'verbs': verbs,
            'entities': entities,
            'confidence': round(confidence, 2),
            'has_date': has_date,
            'has_person': has_person,
            'has_org': has_org
        }
        sentences.append(sentence_data)

        # Track timeline candidates
        if relevancy in ('timeline', 'timeline_possible'):
            timeline_candidates.append(sentence_data)

    # Build profile candidates from tracked entities
    profile_candidates['people'] = _build_people_profiles(seen_people)
    profile_candidates['organizations'] = _build_org_profiles(seen_orgs)

    # Calculate stats
    stats = {
        'total_sentences': len(sentences),
        'timeline_relevant': len([s for s in sentences if s['relevancy'] in ('timeline', 'timeline_possible')]),
        'profile_relevant': len([s for s in sentences if s['relevancy'] == 'profile']),
        'total_people': len(profile_candidates['people']),
        'total_organizations': len(profile_candidates['organizations'])
    }

    return {
        'document_stats': stats,
        'sentences': sentences,
        'timeline_candidates': timeline_candidates,
        'profile_candidates': profile_candidates,
        'article_date': article_date
    }


def _track_person(seen: dict, name: str, context: str):
    """Track a person entity with their contexts."""
    name_key = _normalize_name(name)

    if name_key not in seen:
        seen[name_key] = {
            'name': name,
            'contexts': [],
            'roles': set()
        }

    seen[name_key]['contexts'].append(context)

    # Infer role from context
    role = _infer_person_role(context, name)
    if role:
        seen[name_key]['roles'].add(role)


def _track_org(seen: dict, name: str, context: str):
    """Track an organization entity with their contexts."""
    name_key = _normalize_name(name)

    if name_key not in seen:
        seen[name_key] = {
            'name': name,
            'contexts': [],
            'types': set(),
            'relationships': set()
        }

    seen[name_key]['contexts'].append(context)

    # Infer type and relationship
    org_type = _infer_org_type(context, name)
    if org_type:
        seen[name_key]['types'].add(org_type)

    relationship = _infer_org_relationship(context)
    if relationship:
        seen[name_key]['relationships'].add(relationship)


def _normalize_name(name: str) -> str:
    """Normalize a name for deduplication."""
    # Remove titles
    name = re.sub(r'\b(mr|mrs|ms|dr|jr|sr|i{1,3}|iv|v)\b\.?', '', name, flags=re.IGNORECASE)
    # Remove middle initials
    name = re.sub(r'\b[a-z]\.\s*', '', name, flags=re.IGNORECASE)
    # Handle "Last, First" format
    if ',' in name:
        parts = name.split(',', 1)
        if len(parts) == 2:
            name = f"{parts[1].strip()} {parts[0].strip()}"
    # Collapse whitespace and lowercase
    name = ' '.join(name.lower().split())
    return name


def _infer_person_role(context: str, name: str) -> Optional[str]:
    """Infer a person's role from context."""
    context_lower = context.lower()

    for role, keywords in PERSON_ROLE_KEYWORDS.items():
        if any(kw in context_lower for kw in keywords):
            return role

    return None


def _infer_org_type(context: str, name: str) -> Optional[str]:
    """Infer an organization's type from context and name."""
    combined = f"{context} {name}".lower()

    for org_type, keywords in ORG_TYPE_KEYWORDS.items():
        if any(kw in combined for kw in keywords):
            return org_type

    return None


def _infer_org_relationship(context: str) -> Optional[str]:
    """Infer an organization's relationship to the location."""
    context_lower = context.lower()

    for relationship, keywords in COMPANY_RELATIONSHIP_KEYWORDS.items():
        if any(kw in context_lower for kw in keywords):
            return relationship

    return None


def _build_people_profiles(seen: dict) -> list[dict]:
    """Build profile candidates from tracked people."""
    profiles = []

    for name_key, data in seen.items():
        profiles.append({
            'name': data['name'],
            'normalized_name': name_key,
            'contexts': data['contexts'][:5],  # Limit contexts
            'implied_role': list(data['roles'])[0] if data['roles'] else None,
            'all_roles': list(data['roles']),
            'mention_count': len(data['contexts'])
        })

    # Sort by mention count (most mentioned first)
    profiles.sort(key=lambda p: p['mention_count'], reverse=True)

    return profiles


def _build_org_profiles(seen: dict) -> list[dict]:
    """Build profile candidates from tracked organizations."""
    profiles = []

    for name_key, data in seen.items():
        profiles.append({
            'name': data['name'],
            'normalized_name': name_key,
            'contexts': data['contexts'][:5],
            'implied_type': list(data['types'])[0] if data['types'] else None,
            'all_types': list(data['types']),
            'implied_relationship': list(data['relationships'])[0] if data['relationships'] else None,
            'all_relationships': list(data['relationships']),
            'mention_count': len(data['contexts'])
        })

    profiles.sort(key=lambda p: p['mention_count'], reverse=True)

    return profiles


def build_llm_context(preprocessing_result: dict, max_sentences: int = 20) -> str:
    """
    Build a condensed context string for LLM input.

    Prioritizes timeline-relevant sentences and includes profile context.

    Args:
        preprocessing_result: Output from preprocess_text
        max_sentences: Maximum sentences to include

    Returns:
        Formatted context string for LLM
    """
    lines = []

    # Add timeline candidates first
    timeline = preprocessing_result.get('timeline_candidates', [])
    for sent in timeline[:max_sentences // 2]:
        verb_info = ', '.join([f"{v['text']}({v['category']})" for v in sent['verbs']])
        lines.append(f"[TIMELINE: {verb_info}] {sent['text']}")

    # Add remaining relevant sentences
    remaining = max_sentences - len(lines)
    other_sentences = [
        s for s in preprocessing_result.get('sentences', [])
        if s['relevancy'] == 'profile' or (s['relevancy'] == 'context' and s['confidence'] > 0.5)
    ]

    for sent in other_sentences[:remaining]:
        lines.append(f"[CONTEXT] {sent['text']}")

    return '\n'.join(lines)
