#!/usr/bin/env python3
"""
spaCy Extraction Service

A FastAPI service that provides fast, offline NER extraction using spaCy and dateparser.
This service is started by the Electron app and communicates over HTTP.

Key Features:
- Pre-filters false positives BEFORE dateparser (critical for accuracy)
- Uses en_core_web_lg for best NER accuracy
- Extracts: dates, people, organizations, locations
- Runs completely offline

Install requirements:
    pip install spacy dateparser fastapi uvicorn
    python -m spacy download en_core_web_lg

Run standalone:
    python main.py --port 8234

@version 1.0
"""

import argparse
import re
import sys
import time
from datetime import datetime
from typing import Any, Optional

import dateparser
import dateparser.search  # Explicit import needed for search_dates
import spacy
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Import preprocessing modules
from verb_patterns import find_verbs_in_text, get_verb_category, get_all_categories
from preprocessor import preprocess_text, build_llm_context

# =============================================================================
# MODELS
# =============================================================================

class ExtractionRequest(BaseModel):
    text: str
    articleDate: Optional[str] = None
    extractTypes: list[str] = ["dates", "people", "organizations", "locations"]

class ExtractedDate(BaseModel):
    rawText: str
    parsedDate: Optional[str]
    precision: str
    category: str
    confidence: float
    context: str
    isApproximate: bool

class ExtractedPerson(BaseModel):
    name: str
    role: str
    mentions: list[str]
    confidence: float

class ExtractedOrganization(BaseModel):
    name: str
    type: str
    mentions: list[str]
    confidence: float

class ExtractedLocation(BaseModel):
    name: str
    type: str
    confidence: float

class MaskedPattern(BaseModel):
    original: str
    reason: str
    position: int

class ExtractionResponse(BaseModel):
    dates: list[ExtractedDate]
    people: list[ExtractedPerson]
    organizations: list[ExtractedOrganization]
    locations: list[ExtractedLocation]
    maskedPatterns: list[MaskedPattern]
    processingTimeMs: float

class HealthResponse(BaseModel):
    status: str
    model: str
    version: str


# =============================================================================
# PREPROCESSING MODELS
# =============================================================================

class PreprocessRequest(BaseModel):
    text: str
    articleDate: Optional[str] = None
    maxSentences: int = 20


class VerbMatch(BaseModel):
    text: str
    category: str
    position: int


class EntityMatch(BaseModel):
    text: str
    type: str
    start: int
    end: int


class PreprocessedSentence(BaseModel):
    text: str
    relevancy: str
    relevancy_type: Optional[str]
    verbs: list[VerbMatch]
    entities: list[EntityMatch]
    confidence: float
    has_date: bool
    has_person: bool
    has_org: bool


class ProfileCandidate(BaseModel):
    name: str
    normalized_name: str
    contexts: list[str]
    implied_role: Optional[str] = None
    implied_type: Optional[str] = None
    implied_relationship: Optional[str] = None
    all_roles: Optional[list[str]] = None
    all_types: Optional[list[str]] = None
    all_relationships: Optional[list[str]] = None
    mention_count: int


class DocumentStats(BaseModel):
    total_sentences: int
    timeline_relevant: int
    profile_relevant: int
    total_people: int
    total_organizations: int


class PreprocessResponse(BaseModel):
    document_stats: DocumentStats
    sentences: list[PreprocessedSentence]
    timeline_candidates: list[PreprocessedSentence]
    profile_candidates: dict
    llm_context: str
    article_date: Optional[str]
    processing_time_ms: float


# =============================================================================
# FALSE POSITIVE PATTERNS (CRITICAL)
# =============================================================================

FALSE_POSITIVE_PATTERNS = [
    # Numeric ranges (THE problem case: "110 to 130 employees")
    (r'\b(\d{1,3})\s+to\s+(\d{1,3})\b', 'numeric_range'),

    # Dashed ranges with unit context
    (r'\b\d{1,3}\s*-\s*\d{1,3}(?=\s*(?:employees?|workers?|people|persons?|staff|members?|units?|rooms?|beds?|floors?|stories))', 'range_with_unit'),

    # Formatted numbers with commas
    (r'\b\d{1,3}(?:,\d{3})+\b', 'formatted_number'),

    # Measurements - distance
    (r'\b\d+(?:\.\d+)?\s*(?:feet|foot|ft|meters?|m|inches?|in|yards?|yd|miles?|mi|km|kilometers?)\b', 'measurement_distance'),

    # Measurements - weight
    (r'\b\d+(?:\.\d+)?\s*(?:pounds?|lbs?|ounces?|oz|kilograms?|kg|grams?|g|tons?)\b', 'measurement_weight'),

    # Measurements - area
    (r'\b\d+(?:\.\d+)?\s*(?:acres?|hectares?|ha|sqft|sq\s*ft|square\s*feet|square\s*meters?|sq\s*m)\b', 'measurement_area'),

    # Counts - people
    (r'\b\d+\s*(?:employees?|workers?|people|persons?|staff|members?|residents?|students?|patients?|visitors?)\b', 'count_people'),

    # Counts - objects
    (r'\b\d+\s*(?:units?|rooms?|beds?|floors?|stories|buildings?|houses?|apartments?|cars?|vehicles?)\b', 'count_objects'),

    # Currency - dollar sign
    (r'\$\s*[\d,]+(?:\.\d{2})?', 'currency_dollar'),

    # Currency - words
    (r'\b\d+(?:,\d{3})*\s*(?:dollars?|cents?|bucks?|USD|EUR|GBP)\b', 'currency_word'),

    # Times (without date context)
    (r'\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?(?!\s*(?:on|,)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}))', 'time'),

    # Time ranges
    (r'\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?\s*(?:to|-)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM|a\.m\.|p\.m\.)?', 'time_range'),

    # Phone numbers
    (r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b', 'phone_number'),
    (r'\(\d{3}\)\s*\d{3}[-.\s]?\d{4}', 'phone_number'),

    # Route/Highway numbers
    (r'\b(?:route|rt|rte|hwy|highway|interstate|i-|us-|sr-|state\s+route)\s*#?\s*\d+\b', 'route_number'),

    # Building identifiers
    (r'\b(?:room|rm|building|bldg|suite|ste|apt|apartment|unit|floor|fl|lot|parcel)\s*#?\s*\d+\b', 'building_id'),

    # Percentages
    (r'\b\d+(?:\.\d+)?\s*%', 'percentage'),

    # Hashtags
    (r'#\d+\b', 'hashtag'),

    # Coordinates (high precision decimals)
    (r'-?\d{1,3}\.\d{4,}', 'coordinate'),

    # Age references
    (r'\b\d+\s*(?:years?\s+old|year-old|-year-old|yo)\b', 'age'),

    # Version numbers
    (r'\bv(?:ersion)?\s*\d+(?:\.\d+)*\b', 'version'),

    # Model numbers (alphanumeric)
    (r'\b[A-Z]{1,3}-?\d{3,}\b', 'model_number'),

    # ZIP codes (9-digit)
    (r'\b\d{5}-\d{4}\b', 'zipcode'),

    # Dimensions (LxWxH)
    (r'\b\d+\s*[xX×]\s*\d+(?:\s*[xX×]\s*\d+)?\b', 'dimensions'),
]

# =============================================================================
# CATEGORY KEYWORDS
# =============================================================================

CATEGORY_KEYWORDS = {
    'build_date': [
        'built', 'constructed', 'erected', 'established', 'founded', 'completed',
        'construction', 'dating from', 'dates from', 'dates back to', 'dating to',
    ],
    'opening': [
        'opened', 'inaugurated', 'began operations', 'first opened', 'doors opened',
        'grand opening', 'ribbon cutting', 'opening',
    ],
    'closure': [
        'closed', 'shut down', 'abandoned', 'ceased operations', 'shuttered',
        'went out of business', 'closed its doors', 'closure', 'closing',
    ],
    'demolition': [
        'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed', 'leveled',
        'demolition', 'wrecking',
    ],
    'visit': [
        'visited', 'explored', 'photographed', 'documented', 'recorded',
        'expedition', 'trip', 'tour',
    ],
    'publication': [
        'published', 'posted', 'written', 'updated', 'dated', 'article',
    ],
    'renovation': [
        'renovated', 'restored', 'refurbished', 'rebuilt', 'remodeled',
    ],
    'event': [
        'fire', 'flood', 'accident', 'incident', 'disaster', 'explosion',
    ],
}

# =============================================================================
# SERVICE
# =============================================================================

app = FastAPI(title="spaCy Extraction Service")

# Load spaCy model at startup
print("Loading spaCy model en_core_web_lg...")
try:
    nlp = spacy.load("en_core_web_lg")
    print("spaCy model loaded successfully")
except OSError:
    print("ERROR: spaCy model not found. Run: python -m spacy download en_core_web_lg")
    sys.exit(1)

# Dateparser settings
DATEPARSER_SETTINGS = {
    'PREFER_DATES_FROM': 'past',
    'STRICT_PARSING': False,
    'PREFER_DAY_OF_MONTH': 'first',
    'RETURN_AS_TIMEZONE_AWARE': False,
}

def prefilter_text(text: str) -> tuple[str, list[dict]]:
    """
    Mask false positive patterns before date extraction.

    This is CRITICAL for accuracy. By replacing patterns like "110 to 130"
    with mask characters, dateparser never sees them.

    Returns:
        masked_text: Text with false positives replaced by █ characters
        masks: List of what was masked (for debugging/logging)
    """
    masks = []
    all_matches = []

    # Collect all matches first
    for pattern, reason in FALSE_POSITIVE_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            all_matches.append({
                'match': match,
                'reason': reason,
            })

    # Sort by position
    all_matches.sort(key=lambda x: x['match'].start())

    # Remove overlapping matches (keep first)
    non_overlapping = []
    last_end = -1
    for item in all_matches:
        if item['match'].start() >= last_end:
            non_overlapping.append(item)
            last_end = item['match'].end()

    # Apply masks (in reverse to preserve positions)
    masked = text
    for item in reversed(non_overlapping):
        match = item['match']
        original = match.group()
        placeholder = '█' * len(original)

        masks.append({
            'original': original,
            'reason': item['reason'],
            'position': match.start(),
        })

        masked = masked[:match.start()] + placeholder + masked[match.end():]

    # Reverse masks to be in correct order
    masks.reverse()

    return masked, masks

def extract_sentence(text: str, position: int) -> str:
    """Extract the sentence containing a position."""
    # Find sentence boundaries
    terminators = re.compile(r'[.!?]\s+|[\n\r]{2,}')

    sentence_start = 0
    for match in terminators.finditer(text):
        if match.end() <= position:
            sentence_start = match.end()
        else:
            break

    # Find sentence end
    match = terminators.search(text, position)
    sentence_end = match.start() + 1 if match else len(text)

    sentence = text[sentence_start:sentence_end].strip()

    # Truncate if too long
    if len(sentence) > 500:
        relative = position - sentence_start
        if relative < 250:
            sentence = sentence[:500] + '...'
        else:
            sentence = '...' + sentence[-500:]

    return sentence

def detect_category(text: str, date_position: int) -> tuple[str, float]:
    """Detect the category of a date based on surrounding keywords."""
    text_lower = text.lower()

    # Check each category's keywords
    best_category = 'unknown'
    best_score = 0.0

    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            # Find all occurrences of the keyword
            idx = text_lower.find(keyword.lower())
            while idx != -1:
                distance = abs(idx - date_position)

                # Score based on proximity
                if distance <= 10:
                    score = 1.0
                elif distance <= 30:
                    score = 0.8
                elif distance <= 100:
                    score = 0.5
                else:
                    score = 0.2

                if score > best_score:
                    best_score = score
                    best_category = category

                # Find next occurrence
                idx = text_lower.find(keyword.lower(), idx + 1)

    return best_category, min(best_score, 1.0)

def extract_dates(text: str, masked_text: str, article_date: Optional[str] = None) -> list[ExtractedDate]:
    """Extract dates using dateparser with pre-filtering."""
    dates = []

    # Use the masked text for searching
    found_dates = dateparser.search.search_dates(
        masked_text,
        settings=DATEPARSER_SETTINGS,
        languages=['en']
    )

    if not found_dates:
        return dates

    for raw_text, parsed_date in found_dates:
        # Skip if it's a masked pattern
        if '█' in raw_text:
            continue

        # Find position in original text
        position = text.lower().find(raw_text.lower())
        if position == -1:
            continue

        # Validate year is reasonable
        year = parsed_date.year
        if year < 1800 or year > datetime.now().year + 5:
            continue

        # Determine precision
        has_day = parsed_date.day != 1 or re.search(r'\b\d{1,2}(?:st|nd|rd|th)?\b', raw_text)
        has_month = parsed_date.month != 1 or re.search(
            r'\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b',
            raw_text.lower()
        )

        if has_day and has_month:
            precision = 'exact'
            date_str = parsed_date.strftime('%Y-%m-%d')
        elif has_month:
            precision = 'month'
            date_str = parsed_date.strftime('%Y-%m')
        else:
            precision = 'year'
            date_str = str(year)

        # Check for approximate indicators
        is_approximate = bool(re.search(
            r'\b(circa|c\.|ca\.|around|about|approximately|roughly|late|early|mid)\b',
            raw_text.lower()
        ))
        if is_approximate:
            precision = 'approximate'

        # Get context sentence
        context = extract_sentence(text, position)

        # Detect category
        category, cat_confidence = detect_category(text, position)

        # Calculate confidence
        confidence = 0.5
        if precision == 'exact':
            confidence = 0.95
        elif precision == 'month':
            confidence = 0.85
        elif precision == 'year':
            confidence = 0.7

        # Boost for strong category match
        if cat_confidence > 0.7:
            confidence = min(1.0, confidence + 0.1)

        # Penalty for approximate
        if is_approximate:
            confidence = max(0.1, confidence - 0.1)

        dates.append(ExtractedDate(
            rawText=raw_text,
            parsedDate=date_str,
            precision=precision,
            category=category,
            confidence=round(confidence, 2),
            context=context,
            isApproximate=is_approximate,
        ))

    return dates

def extract_people(doc) -> list[ExtractedPerson]:
    """Extract people using spaCy NER."""
    people = []
    seen_names = set()

    for ent in doc.ents:
        if ent.label_ == 'PERSON':
            name = ent.text.strip()
            name_lower = name.lower()

            if name_lower in seen_names or len(name) < 2:
                continue

            seen_names.add(name_lower)

            # Try to determine role from context
            context = doc[max(0, ent.start - 10):min(len(doc), ent.end + 10)].text.lower()
            role = 'unknown'

            if any(w in context for w in ['built', 'founded', 'established']):
                role = 'founder'
            elif any(w in context for w in ['owned', 'owner', 'purchased']):
                role = 'owner'
            elif any(w in context for w in ['designed', 'architect']):
                role = 'architect'
            elif any(w in context for w in ['worked', 'employee']):
                role = 'employee'

            people.append(ExtractedPerson(
                name=name,
                role=role,
                mentions=[name],
                confidence=0.8 if role != 'unknown' else 0.6,
            ))

    return people

def extract_organizations(doc) -> list[ExtractedOrganization]:
    """Extract organizations using spaCy NER."""
    orgs = []
    seen_orgs = set()

    for ent in doc.ents:
        if ent.label_ == 'ORG':
            name = ent.text.strip()
            name_lower = name.lower()

            if name_lower in seen_orgs or len(name) < 2:
                continue

            seen_orgs.add(name_lower)

            # Try to determine type from context
            context = doc[max(0, ent.start - 10):min(len(doc), ent.end + 10)].text.lower()
            org_type = 'unknown'

            if any(w in context for w in ['company', 'corporation', 'inc', 'llc', 'factory', 'mill']):
                org_type = 'company'
            elif any(w in context for w in ['school', 'university', 'college', 'academy']):
                org_type = 'school'
            elif any(w in context for w in ['hospital', 'clinic', 'medical']):
                org_type = 'hospital'
            elif any(w in context for w in ['church', 'parish', 'cathedral']):
                org_type = 'church'
            elif any(w in context for w in ['government', 'city', 'county', 'state', 'federal']):
                org_type = 'government'

            orgs.append(ExtractedOrganization(
                name=name,
                type=org_type,
                mentions=[name],
                confidence=0.8 if org_type != 'unknown' else 0.6,
            ))

    return orgs

def extract_locations(doc) -> list[ExtractedLocation]:
    """Extract location references using spaCy NER."""
    locs = []
    seen_locs = set()

    for ent in doc.ents:
        if ent.label_ in ('GPE', 'LOC', 'FAC'):
            name = ent.text.strip()
            name_lower = name.lower()

            if name_lower in seen_locs or len(name) < 2:
                continue

            seen_locs.add(name_lower)

            # Determine type
            if ent.label_ == 'GPE':
                loc_type = 'city'  # Could be city, state, country
            elif ent.label_ == 'FAC':
                loc_type = 'landmark'
            else:
                loc_type = 'region'

            locs.append(ExtractedLocation(
                name=name,
                type=loc_type,
                confidence=0.75,
            ))

    return locs

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy",
        model="en_core_web_lg",
        version=spacy.__version__,
    )

@app.post("/extract", response_model=ExtractionResponse)
async def extract(request: ExtractionRequest):
    """Main extraction endpoint."""
    start_time = time.time()

    text = request.text
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    # Step 1: Pre-filter false positives
    masked_text, masked_patterns = prefilter_text(text)

    # Step 2: Process with spaCy
    doc = nlp(text)

    # Step 3: Extract based on requested types
    dates = []
    people = []
    organizations = []
    locations = []

    if 'dates' in request.extractTypes:
        dates = extract_dates(text, masked_text, request.articleDate)

    if 'people' in request.extractTypes:
        people = extract_people(doc)

    if 'organizations' in request.extractTypes:
        organizations = extract_organizations(doc)

    if 'locations' in request.extractTypes:
        locations = extract_locations(doc)

    processing_time = (time.time() - start_time) * 1000

    return ExtractionResponse(
        dates=dates,
        people=people,
        organizations=organizations,
        locations=locations,
        maskedPatterns=[MaskedPattern(**p) for p in masked_patterns],
        processingTimeMs=round(processing_time, 2),
    )

@app.post("/preprocess", response_model=PreprocessResponse)
async def preprocess(request: PreprocessRequest):
    """
    Preprocess text for LLM extraction.

    Performs intelligent preprocessing to create a structured context package:
    - Identifies timeline-relevant sentences (with verbs like built, closed, demolished)
    - Extracts named entities (people, organizations, locations, dates)
    - Classifies sentences by relevancy
    - Builds condensed context for LLM input

    This endpoint should be called BEFORE sending text to an LLM for extraction.
    """
    start_time = time.time()

    text = request.text
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    # Preprocess the text
    result = preprocess_text(text, nlp, request.articleDate)

    # Build LLM context string
    llm_context = build_llm_context(result, request.maxSentences)

    processing_time = (time.time() - start_time) * 1000

    return PreprocessResponse(
        document_stats=DocumentStats(**result['document_stats']),
        sentences=[PreprocessedSentence(
            text=s['text'],
            relevancy=s['relevancy'],
            relevancy_type=s.get('relevancy_type'),
            verbs=[VerbMatch(**v) for v in s['verbs']],
            entities=[EntityMatch(**e) for e in s['entities']],
            confidence=s['confidence'],
            has_date=s['has_date'],
            has_person=s['has_person'],
            has_org=s['has_org']
        ) for s in result['sentences']],
        timeline_candidates=[PreprocessedSentence(
            text=s['text'],
            relevancy=s['relevancy'],
            relevancy_type=s.get('relevancy_type'),
            verbs=[VerbMatch(**v) for v in s['verbs']],
            entities=[EntityMatch(**e) for e in s['entities']],
            confidence=s['confidence'],
            has_date=s['has_date'],
            has_person=s['has_person'],
            has_org=s['has_org']
        ) for s in result['timeline_candidates']],
        profile_candidates=result['profile_candidates'],
        llm_context=llm_context,
        article_date=result.get('article_date'),
        processing_time_ms=round(processing_time, 2)
    )


@app.get("/verb-categories")
async def verb_categories():
    """Get all available verb categories for timeline detection."""
    return {"categories": get_all_categories()}


@app.post("/shutdown")
async def shutdown():
    """Graceful shutdown endpoint."""
    import asyncio
    import signal

    asyncio.get_event_loop().call_later(0.5, lambda: signal.raise_signal(signal.SIGTERM))
    return {"status": "shutting down"}

def main():
    parser = argparse.ArgumentParser(description='spaCy Extraction Service')
    parser.add_argument('--port', type=int, default=8234, help='Port to run on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    args = parser.parse_args()

    print(f"Starting spaCy service on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()
