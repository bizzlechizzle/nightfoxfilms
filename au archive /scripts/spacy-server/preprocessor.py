"""
spaCy Preprocessing Service

Pre-filters and analyzes text BEFORE sending to LLMs.
Uses spaCy for NER, sentence segmentation, and verb detection.

KEY PHILOSOPHY:
- Dates WITHOUT timeline verbs are NOT timeline events
- Pre-filter sentences to only those with temporal relevance
- Extract profile candidates (people/organizations) for deduplication
- Return structured data for LLM prompts

@version 1.0
"""

import re
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime

import spacy
from spacy.tokens import Doc, Span, Token

from verb_patterns import (
    get_category_for_lemma,
    is_timeline_relevant_lemma,
    get_weight_for_category,
    ALL_LEMMAS,
)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class VerbMatch:
    """A matched verb with its category."""
    text: str
    lemma: str
    category: str
    position: int


@dataclass
class EntityMatch:
    """A named entity found by spaCy."""
    text: str
    label: str
    start: int
    end: int


@dataclass
class DateReference:
    """A date reference found in text."""
    text: str
    normalized_date: Optional[str]
    precision: str  # exact, month, year, decade, approximate


@dataclass
class SentenceRelevancy:
    """Relevancy assessment for a sentence."""
    is_timeline_relevant: bool
    score: float
    reasons: List[str]


@dataclass
class PreprocessedSentence:
    """A preprocessed sentence with all extracted data."""
    text: str
    index: int
    entities: List[EntityMatch]
    verbs: List[VerbMatch]
    relevancy: SentenceRelevancy
    date_refs: List[DateReference]


@dataclass
class ProfileCandidate:
    """A candidate for person/company profile."""
    name: str
    normalized_name: str
    mentions: int
    roles: List[str]  # For people
    types: List[str]  # For organizations
    sentences: List[int]  # Sentence indices where mentioned


@dataclass
class ProfileCandidates:
    """Collection of profile candidates."""
    people: List[ProfileCandidate]
    organizations: List[ProfileCandidate]


@dataclass
class DocumentStats:
    """Statistics about the preprocessed document."""
    total_sentences: int
    total_words: int
    timeline_relevant_sentences: int
    entity_counts: Dict[str, int]
    verb_counts: Dict[str, int]


@dataclass
class PreprocessingResult:
    """Complete preprocessing result."""
    sentences: List[PreprocessedSentence]
    profile_candidates: ProfileCandidates
    document_stats: DocumentStats


# =============================================================================
# PREPROCESSOR CLASS
# =============================================================================

class SpacyPreprocessor:
    """spaCy-based text preprocessor for timeline extraction."""

    def __init__(self, model_name: str = "en_core_web_sm"):
        """Initialize with spaCy model."""
        self.nlp = spacy.load(model_name)

        # Date patterns for extraction
        self.date_patterns = [
            # Full dates: January 15, 1920 or 01/15/1920
            (r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b', 'exact'),
            (r'\b\d{1,2}/\d{1,2}/\d{4}\b', 'exact'),
            (r'\b\d{4}-\d{2}-\d{2}\b', 'exact'),
            # Month + Year: January 1920
            (r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b', 'month'),
            # Year only: 1920, in 1920
            (r'\b(?:in\s+)?(?:19|20)\d{2}\b', 'year'),
            # Decades: 1920s, the 1920s
            (r'\b(?:the\s+)?(?:19|20)\d{2}s\b', 'decade'),
            # Approximate: early 1900s, mid-century
            (r'\b(?:early|mid|late)\s+(?:19|20)\d{2}s?\b', 'approximate'),
            (r'\b(?:early|mid|late)[-\s]century\b', 'approximate'),
        ]

    def preprocess(
        self,
        text: str,
        article_date: Optional[str] = None,
        max_sentences: int = 100,
    ) -> PreprocessingResult:
        """
        Preprocess text for LLM extraction.

        Args:
            text: Raw text to preprocess
            article_date: Optional date of the article/source (ISO format)
            max_sentences: Maximum sentences to process

        Returns:
            PreprocessingResult with sentences, profiles, and stats
        """
        # Parse with spaCy
        doc = self.nlp(text)

        # Process sentences
        sentences: List[PreprocessedSentence] = []
        entity_counts: Dict[str, int] = {}
        verb_counts: Dict[str, int] = {}

        # Track profile candidates
        people_map: Dict[str, ProfileCandidate] = {}
        org_map: Dict[str, ProfileCandidate] = {}

        for idx, sent in enumerate(doc.sents):
            if idx >= max_sentences:
                break

            # Extract entities
            entities = self._extract_entities(sent)
            for ent in entities:
                entity_counts[ent.label] = entity_counts.get(ent.label, 0) + 1

                # Track profile candidates
                if ent.label == "PERSON":
                    self._track_person(people_map, ent, idx, sent)
                elif ent.label in ("ORG", "FAC"):
                    self._track_org(org_map, ent, idx, sent)

            # Extract verbs
            verbs = self._extract_verbs(sent)
            for verb in verbs:
                verb_counts[verb.category] = verb_counts.get(verb.category, 0) + 1

            # Extract date references
            date_refs = self._extract_dates(sent.text)

            # Calculate relevancy
            relevancy = self._calculate_relevancy(entities, verbs, date_refs)

            sentences.append(PreprocessedSentence(
                text=sent.text.strip(),
                index=idx,
                entities=entities,
                verbs=verbs,
                relevancy=relevancy,
                date_refs=date_refs,
            ))

        # Build profile candidates
        profile_candidates = ProfileCandidates(
            people=list(people_map.values()),
            organizations=list(org_map.values()),
        )

        # Calculate stats
        timeline_relevant = sum(1 for s in sentences if s.relevancy.is_timeline_relevant)
        document_stats = DocumentStats(
            total_sentences=len(sentences),
            total_words=len(doc),
            timeline_relevant_sentences=timeline_relevant,
            entity_counts=entity_counts,
            verb_counts=verb_counts,
        )

        return PreprocessingResult(
            sentences=sentences,
            profile_candidates=profile_candidates,
            document_stats=document_stats,
        )

    def _extract_entities(self, sent: Span) -> List[EntityMatch]:
        """Extract named entities from a sentence."""
        entities = []
        for ent in sent.ents:
            entities.append(EntityMatch(
                text=ent.text,
                label=ent.label_,
                start=ent.start_char - sent.start_char,
                end=ent.end_char - sent.start_char,
            ))
        return entities

    def _extract_verbs(self, sent: Span) -> List[VerbMatch]:
        """Extract timeline-relevant verbs from a sentence."""
        verbs = []
        for token in sent:
            if token.pos_ == "VERB":
                lemma = token.lemma_.lower()
                category = get_category_for_lemma(lemma)
                if category:
                    verbs.append(VerbMatch(
                        text=token.text,
                        lemma=lemma,
                        category=category,
                        position=token.i - sent.start,
                    ))
        return verbs

    def _extract_dates(self, text: str) -> List[DateReference]:
        """Extract date references using patterns."""
        date_refs = []
        for pattern, precision in self.date_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                normalized = self._normalize_date(match.group(), precision)
                date_refs.append(DateReference(
                    text=match.group(),
                    normalized_date=normalized,
                    precision=precision,
                ))
        return date_refs

    def _normalize_date(self, date_text: str, precision: str) -> Optional[str]:
        """Normalize a date string to ISO format where possible."""
        date_text = date_text.strip().lower()

        # Remove common prefixes
        date_text = re.sub(r'^(?:in|the)\s+', '', date_text)

        if precision == 'year':
            match = re.search(r'(\d{4})', date_text)
            if match:
                return match.group(1)
        elif precision == 'decade':
            match = re.search(r'(\d{4})s', date_text)
            if match:
                return match.group(1)
        elif precision == 'month':
            # Try to parse month + year
            months = {
                'january': '01', 'february': '02', 'march': '03', 'april': '04',
                'may': '05', 'june': '06', 'july': '07', 'august': '08',
                'september': '09', 'october': '10', 'november': '11', 'december': '12'
            }
            for month_name, month_num in months.items():
                if month_name in date_text:
                    year_match = re.search(r'(\d{4})', date_text)
                    if year_match:
                        return f"{year_match.group(1)}-{month_num}"
        elif precision == 'exact':
            # Try multiple formats
            months = {
                'january': '01', 'february': '02', 'march': '03', 'april': '04',
                'may': '05', 'june': '06', 'july': '07', 'august': '08',
                'september': '09', 'october': '10', 'november': '11', 'december': '12'
            }
            for month_name, month_num in months.items():
                if month_name in date_text:
                    day_match = re.search(r'(\d{1,2})', date_text)
                    year_match = re.search(r'(\d{4})', date_text)
                    if day_match and year_match:
                        day = day_match.group(1).zfill(2)
                        return f"{year_match.group(1)}-{month_num}-{day}"

            # Try numeric formats
            match = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_text)
            if match:
                return f"{match.group(3)}-{match.group(1).zfill(2)}-{match.group(2).zfill(2)}"

            match = re.match(r'(\d{4})-(\d{2})-(\d{2})', date_text)
            if match:
                return date_text

        return None

    def _calculate_relevancy(
        self,
        entities: List[EntityMatch],
        verbs: List[VerbMatch],
        date_refs: List[DateReference],
    ) -> SentenceRelevancy:
        """Calculate timeline relevancy for a sentence."""
        reasons = []
        score = 0.0

        # Key rule: Must have both DATE and VERB to be timeline-relevant
        has_date = len(date_refs) > 0
        has_verb = len(verbs) > 0

        if has_date and has_verb:
            # Core timeline relevancy
            score = 0.7
            reasons.append("Has date + timeline verb")

            # Boost for high-weight categories
            for verb in verbs:
                weight = get_weight_for_category(verb.category)
                if weight >= 0.9:
                    score += 0.1
                    reasons.append(f"High-weight verb: {verb.category}")

            # Boost for exact dates
            for date_ref in date_refs:
                if date_ref.precision == 'exact':
                    score += 0.1
                    reasons.append("Exact date precision")
                    break
        elif has_date:
            score = 0.2
            reasons.append("Has date but no timeline verb")
        elif has_verb:
            score = 0.3
            reasons.append("Has timeline verb but no date")

        # Cap score
        score = min(score, 1.0)

        return SentenceRelevancy(
            is_timeline_relevant=has_date and has_verb,
            score=score,
            reasons=reasons,
        )

    def _track_person(
        self,
        people_map: Dict[str, ProfileCandidate],
        entity: EntityMatch,
        sentence_idx: int,
        sent: Span,
    ) -> None:
        """Track a person entity for profile extraction."""
        normalized = self._normalize_name(entity.text)

        if normalized in people_map:
            people_map[normalized].mentions += 1
            if sentence_idx not in people_map[normalized].sentences:
                people_map[normalized].sentences.append(sentence_idx)
        else:
            # Try to detect role from context
            roles = self._detect_person_roles(entity.text, sent.text)
            people_map[normalized] = ProfileCandidate(
                name=entity.text,
                normalized_name=normalized,
                mentions=1,
                roles=roles,
                types=[],
                sentences=[sentence_idx],
            )

    def _track_org(
        self,
        org_map: Dict[str, ProfileCandidate],
        entity: EntityMatch,
        sentence_idx: int,
        sent: Span,
    ) -> None:
        """Track an organization entity for profile extraction."""
        normalized = self._normalize_org_name(entity.text)

        if normalized in org_map:
            org_map[normalized].mentions += 1
            if sentence_idx not in org_map[normalized].sentences:
                org_map[normalized].sentences.append(sentence_idx)
        else:
            types = self._detect_org_types(entity.text, sent.text)
            org_map[normalized] = ProfileCandidate(
                name=entity.text,
                normalized_name=normalized,
                mentions=1,
                roles=[],
                types=types,
                sentences=[sentence_idx],
            )

    def _normalize_name(self, name: str) -> str:
        """Normalize a person's name for deduplication."""
        # Remove titles
        name = re.sub(r'^(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Rev\.?)\s+', '', name, flags=re.IGNORECASE)
        # Remove suffixes
        name = re.sub(r',?\s+(?:Jr\.?|Sr\.?|III?|IV|Esq\.?)$', '', name, flags=re.IGNORECASE)
        # Handle "Last, First" format
        if ',' in name:
            parts = name.split(',', 1)
            if len(parts) == 2:
                name = f"{parts[1].strip()} {parts[0].strip()}"
        # Collapse whitespace
        name = ' '.join(name.split())
        return name.strip()

    def _normalize_org_name(self, name: str) -> str:
        """Normalize an organization name for deduplication."""
        # Remove common suffixes
        name = re.sub(r',?\s+(?:Inc\.?|LLC|Corp\.?|Ltd\.?|Co\.?)$', '', name, flags=re.IGNORECASE)
        # Remove "The" prefix
        name = re.sub(r'^The\s+', '', name, flags=re.IGNORECASE)
        # Collapse whitespace
        name = ' '.join(name.split())
        return name.strip()

    def _detect_person_roles(self, name: str, context: str) -> List[str]:
        """Detect roles for a person from context."""
        roles = []
        context_lower = context.lower()

        role_patterns = {
            'owner': r'(?:own(?:er|ed)|proprietor)',
            'architect': r'(?:architect|design(?:er|ed))',
            'developer': r'(?:develop(?:er|ed)|build(?:er)?)',
            'founder': r'(?:found(?:er|ed)|establish(?:ed)?)',
            'employee': r'(?:work(?:er|ed)|employ(?:ee|ed))',
            'visitor': r'(?:visit(?:or|ed)|explor(?:er|ed))',
        }

        for role, pattern in role_patterns.items():
            if re.search(pattern, context_lower):
                roles.append(role)

        return roles

    def _detect_org_types(self, name: str, context: str) -> List[str]:
        """Detect types for an organization from context."""
        types = []
        combined = f"{name} {context}".lower()

        type_patterns = {
            'company': r'(?:company|corporation|corp|inc|llc|business)',
            'government': r'(?:government|city|county|state|federal|department)',
            'school': r'(?:school|university|college|academy|institute)',
            'hospital': r'(?:hospital|medical|clinic|healthcare)',
            'church': r'(?:church|cathedral|chapel|temple|synagogue|mosque)',
            'nonprofit': r'(?:foundation|nonprofit|charity|association)',
            'military': r'(?:military|army|navy|air force|base|fort)',
        }

        for org_type, pattern in type_patterns.items():
            if re.search(pattern, combined):
                types.append(org_type)

        return types if types else ['unknown']

    def to_dict(self, result: PreprocessingResult) -> Dict[str, Any]:
        """Convert result to JSON-serializable dict."""
        return {
            "sentences": [
                {
                    "text": s.text,
                    "index": s.index,
                    "entities": [asdict(e) for e in s.entities],
                    "verbs": [asdict(v) for v in s.verbs],
                    "relevancy": asdict(s.relevancy),
                    "date_refs": [asdict(d) for d in s.date_refs],
                }
                for s in result.sentences
            ],
            "profile_candidates": {
                "people": [asdict(p) for p in result.profile_candidates.people],
                "organizations": [asdict(o) for o in result.profile_candidates.organizations],
            },
            "document_stats": asdict(result.document_stats),
        }


# =============================================================================
# SINGLETON
# =============================================================================

_preprocessor: Optional[SpacyPreprocessor] = None


def get_preprocessor(model_name: str = "en_core_web_sm") -> SpacyPreprocessor:
    """Get singleton preprocessor instance."""
    global _preprocessor
    if _preprocessor is None:
        _preprocessor = SpacyPreprocessor(model_name)
    return _preprocessor
