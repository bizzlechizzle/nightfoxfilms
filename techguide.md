# Technical Guide - Nightfox Films Repository

**Last Updated:** 2025-11-18
**Version:** 1.0.0
**Repository Type:** Documentation/Strategy (NOT code repository)
**Purpose:** Complete technical reference for all files, dependencies, relationships, and rules

---

## TABLE OF CONTENTS

1. [Repository Overview](#repository-overview)
2. [File Structure](#file-structure)
3. [File Map with Dependencies](#file-map-with-dependencies)
4. [Core Documentation Files](#core-documentation-files)
5. [Strategy Documents](#strategy-documents)
6. [Website Content Files](#website-content-files)
7. [Client Systems](#client-systems)
8. [Marketing Materials](#marketing-materials)
9. [Archive Folders](#archive-folders)
10. [Scripts and Automation](#scripts-and-automation)
11. [Configuration Files](#configuration-files)
12. [Key Rules and Principles](#key-rules-and-principles)
13. [Workflows and Processes](#workflows-and-processes)
14. [Integration Map](#integration-map)

---

## REPOSITORY OVERVIEW

### What This Repository IS
- Comprehensive business strategy for Nightfox Films wedding videography business
- Complete website wireframes and copy for all major pages
- Marketing templates (email, Instagram, SEO)
- Client management systems (contracts, questionnaires, consultation scripts)
- Implementation guides and checklists

### What This Repository IS NOT
- NOT a code repository (no HTML, CSS, JavaScript, Python, etc.)
- NOT a deployable website (just documentation and content)
- NOT a build system (no package.json, Gemfile, requirements.txt)
- NOT automated (no CI/CD, deployment scripts, or launch automation)

### Current State
- **Total Files:** ~50+ markdown files, 1 config file
- **Lines of Documentation:** 10,000+ lines
- **Completeness:** Strategy 100%, Code 0%, Automation 0%
- **Quality:** Excellent documentation, needs technical infrastructure

---

## FILE STRUCTURE

```
/nightfoxfilms/
├── .git/                                    # Git version control
├── .DS_Store                                # macOS file (SHOULD BE GITIGNORED)
│
├── Core Documentation (NEW - 2025-11-18)
│   ├── README.md                            # Project overview (UPDATED)
│   ├── claude.md                            # Development principles and process
│   ├── techguide.md                         # This file - complete technical reference
│   ├── lilbits.md                           # Script documentation system
│   └── todo.md                              # Task tracking and gap analysis
│
├── Master Planning Documents (ROOT LEVEL)
│   ├── IMPLEMENTATION-SUMMARY.md            # Master implementation plan
│   ├── MASTER-IMPLEMENTATION-CHECKLIST.md   # 87-task checklist, 8-12 week timeline
│   ├── QUICK-START-ACTION-PLAN.md           # 8-week tactical launch plan
│   └── CRITICAL-MISSING-PIECES.md           # Gap analysis (NEEDS UPDATE)
│
├── Research & Strategy
│   ├── research-guide.md                    # 1,122 lines, competitive analysis, SEO keywords
│   ├── competitive-analysis.md              # Competitor breakdown, pricing comparison
│   ├── developer-guide.md                   # 2,562 lines, technical implementation (Next.js, React)
│   ├── rebrand.md                           # Brand strategy, voice/tone guidelines
│   └── seo-implementation-guide.md          # Complete SEO strategy, schema markup
│
├── Pricing & Packages
│   └── pricing-sheet-2025.md                # Complete pricing structure ($2,800-$6,400)
│
├── Content Templates
│   ├── archive-blog-structure.md            # How to structure archive/blog posts for SEO
│   ├── email-templates.md                   # 10 email response templates
│   ├── lead-nurture-email-sequence.md       # 5-email automated sequence
│   └── instagram-30-day-content-calendar.md # 30 days of Instagram content
│
├── Client Systems
│   ├── client-questionnaire-template.md     # Pre-wedding questionnaire
│   ├── consultation-call-script.md          # Sales call framework
│   └── contract-template-outline.md         # Service agreement template
│
├── wireframes/                              # Website page structures
│   ├── home-page-wireframe.md               # Home page structure, sections, CTAs
│   ├── super-8-page-wireframe.md            # Super 8 service page
│   ├── dad-cam-page-wireframe.md            # Dad Cam/VHS service page
│   ├── modern-digital-page-wireframe.md     # Modern digital service page
│   ├── mixed-media-page-wireframe.md        # Mixed media (all 3 formats) page
│   ├── about-page-wireframe.md              # About page structure
│   └── faq-page-wireframe-and-copy.md       # FAQ page with full copy
│
├── copy/                                    # Final website copy
│   ├── home-page-copy.md                    # Complete home page copy
│   ├── super-8-page-copy.md                 # Super 8 page copy (268 lines)
│   ├── dad-cam-page-copy.md                 # Dad Cam page copy
│   ├── modern-digital-page-copy.md          # Modern digital page copy
│   ├── mixed-media-page-copy.md             # Mixed media page copy
│   └── about-page-copy.md                   # About page copy
│
├── sample-archive-posts/                    # Example blog post templates
│   ├── sarah-mike-finger-lakes-super-8-wedding.md
│   └── emma-chris-rochester-dad-cam-wedding.md
│
├── blog-posts/                              # Educational content
│   └── super-8-vs-digital-wedding-video.md  # Comparison blog post
│
├── location-pages/                          # SEO-optimized location pages
│   └── buffalo-wedding-videographer.md      # Template for location landing pages
│
├── pages/                                   # Logseq notes (SHOULD BE ARCHIVED)
│   ├── Brand Guide.md                       # Original brand notes
│   ├── Dad Cam.md                           # Service planning notes
│   ├── Deliverables.md                      # Deliverable notes
│   ├── Home Page.md                         # Home page planning
│   ├── Nightfox Films.md                    # Business overview notes
│   ├── Packages.md                          # Package structure notes
│   ├── Research.md                          # Research tracking
│   ├── SEO.md                               # SEO notes
│   ├── Super 8.md                           # Service notes
│   ├── Website.md                           # Website planning
│   └── contents.md                          # Logseq index
│
└── logseq/                                  # Logseq configuration
    └── config.edn                           # Logseq app configuration (Clojure EDN format)
```

---

## FILE MAP WITH DEPENDENCIES

### Core Documentation Layer (NEW)
These files define how to work with this repository:

```
README.md
  ├── References: All major strategy docs
  └── Purpose: Entry point for understanding repository

claude.md
  ├── References: techguide.md, lilbits.md, user prompts
  ├── Purpose: Development principles and process
  └── Used by: AI assistants working on repository

techguide.md (THIS FILE)
  ├── References: Every file in repository
  ├── Purpose: Complete technical map and reference
  └── Used by: Developers, AI assistants, project managers

lilbits.md
  ├── References: Scripts in /scripts directory (when they exist)
  ├── Purpose: Document all modular scripts
  └── Used by: Developers running automation

todo.md
  ├── References: All gap analysis and improvement tasks
  ├── Purpose: Track technical debt and improvements
  └── Used by: Project tracking, sprint planning
```

### Master Planning Layer

```
IMPLEMENTATION-SUMMARY.md (MASTER DOCUMENT)
  ├── References:
  │     ├── competitive-analysis.md (pricing justification)
  │     ├── CRITICAL-MISSING-PIECES.md (gap analysis)
  │     ├── QUICK-START-ACTION-PLAN.md (tactical plan)
  │     └── MASTER-IMPLEMENTATION-CHECKLIST.md (task tracking)
  ├── Purpose: High-level strategy and ROI analysis
  └── Used by: Decision-making, budget planning

MASTER-IMPLEMENTATION-CHECKLIST.md
  ├── References:
  │     ├── All wireframes (for website build tasks)
  │     ├── All copy files (for content tasks)
  │     ├── email-templates.md (for email setup)
  │     ├── seo-implementation-guide.md (for SEO tasks)
  │     └── client-questionnaire-template.md (for client systems)
  ├── Purpose: 87-task checklist, 8-12 week timeline
  └── Used by: Project execution, progress tracking

QUICK-START-ACTION-PLAN.md
  ├── References: IMPLEMENTATION-SUMMARY.md
  ├── Purpose: Condensed 8-week tactical plan
  └── Used by: Quick execution without reading full strategy

CRITICAL-MISSING-PIECES.md
  ├── Status: NEEDS UPDATE (many items now completed)
  ├── References: All template files
  ├── Purpose: Gap analysis and WWYDD recommendations
  └── Used by: Identifying what to build next
```

### Research & Strategy Layer

```
research-guide.md (1,122 lines)
  ├── References:
  │     ├── competitive-analysis.md
  │     └── seo-implementation-guide.md
  ├── Contains:
  │     ├── Competitive analysis (15+ competitors)
  │     ├── Market research
  │     ├── SEO keyword research
  │     ├── Pricing benchmarks
  │     └── Market positioning
  ├── Purpose: Foundation for all strategic decisions
  └── Used by: Pricing decisions, SEO strategy, positioning

competitive-analysis.md
  ├── Referenced by: IMPLEMENTATION-SUMMARY.md, pricing-sheet-2025.md
  ├── Contains: Competitor breakdown, pricing comparison ($1,500-$5,000 range)
  ├── Purpose: Justify pricing and positioning
  └── Used by: Pricing strategy, competitive positioning

developer-guide.md (2,562 lines)
  ├── References:
  │     ├── All wireframes
  │     ├── All copy files
  │     └── seo-implementation-guide.md
  ├── Contains:
  │     ├── Technical stack recommendations (Next.js, React, Tailwind)
  │     ├── Component architecture
  │     ├── Deployment guide (Vercel)
  │     ├── Performance optimization
  │     └── Best practices
  ├── Purpose: Complete technical implementation guide
  └── Used by: Developers building the actual website

rebrand.md
  ├── References: Brand colors, voice/tone
  ├── Contains:
  │     ├── Brand positioning
  │     ├── Voice and tone guidelines
  │     ├── Brand personality
  │     └── Messaging framework
  ├── Purpose: Ensure brand consistency
  └── Used by: All copy writing, design decisions

seo-implementation-guide.md
  ├── Referenced by:
  │     ├── All copy files (meta descriptions, schema)
  │     ├── location-pages/*.md (local SEO)
  │     ├── blog-posts/*.md (content SEO)
  │     └── sample-archive-posts/*.md (archive SEO)
  ├── Contains:
  │     ├── Keyword research
  │     ├── On-page SEO checklist
  │     ├── Technical SEO (schema markup, sitemaps)
  │     ├── Local SEO strategy
  │     └── Backlink strategy
  ├── Purpose: Complete SEO implementation
  └── Used by: Website build, content creation
```

### Pricing & Packages

```
pricing-sheet-2025.md
  ├── References:
  │     ├── competitive-analysis.md (market pricing)
  │     └── research-guide.md (pricing strategy)
  ├── Used by:
  │     ├── All service page copy (pricing sections)
  │     ├── consultation-call-script.md (price presentation)
  │     ├── contract-template-outline.md (package details)
  │     └── email-templates.md (proposal emails)
  ├── Contains:
  │     ├── Super 8 Package: $2,800
  │     ├── Dad Cam Package: $2,400
  │     ├── Modern Digital Package: $2,800-$4,200
  │     ├── Mixed Media Packages: $4,800-$6,400
  │     ├── Add-ons and travel fees
  │     └── Package comparisons
  ├── Purpose: Single source of truth for pricing
  └── Status: Active, may need seasonal updates
```

### Website Content Layer

```
WIREFRAME → COPY → SEO FLOW:

wireframes/home-page-wireframe.md
  ├── Informs: copy/home-page-copy.md
  ├── Contains: Page structure, sections, CTAs, layout
  └── Used by: Developer building home page

copy/home-page-copy.md
  ├── References:
  │     ├── wireframes/home-page-wireframe.md (structure)
  │     ├── seo-implementation-guide.md (meta tags, keywords)
  │     └── pricing-sheet-2025.md (pricing mentions)
  ├── Contains: Complete home page copy, hero text, CTAs
  └── Used by: Website implementation

[SAME PATTERN FOR ALL SERVICE PAGES]

wireframes/super-8-page-wireframe.md
  └── Informs: copy/super-8-page-copy.md

wireframes/dad-cam-page-wireframe.md
  └── Informs: copy/dad-cam-page-copy.md

wireframes/modern-digital-page-wireframe.md
  └── Informs: copy/modern-digital-page-copy.md

wireframes/mixed-media-page-wireframe.md
  └── Informs: copy/mixed-media-page-copy.md

wireframes/about-page-wireframe.md
  └── Informs: copy/about-page-copy.md

wireframes/faq-page-wireframe-and-copy.md
  └── Contains: BOTH wireframe AND copy (all-in-one)
```

### Content Templates & Examples

```
archive-blog-structure.md
  ├── Used by:
  │     ├── sample-archive-posts/*.md (template)
  │     └── Future archive posts
  ├── Contains:
  │     ├── SEO structure for wedding archive posts
  │     ├── Required sections
  │     ├── Keyword placement
  │     ├── Internal linking strategy
  │     └── Vendor credit structure
  ├── Purpose: Standardize archive post format
  └── SEO Value: High (location + medium keywords)

sample-archive-posts/sarah-mike-finger-lakes-super-8-wedding.md
sample-archive-posts/emma-chris-rochester-dad-cam-wedding.md
  ├── References: archive-blog-structure.md (template)
  ├── Contains:
  │     ├── Couple story (2-3 paragraphs)
  │     ├── Package details
  │     ├── Venue name (local SEO)
  │     ├── Vendor credits (backlinks)
  │     ├── Testimonial quote
  │     └── CTA to book
  ├── Purpose: Example templates for real archive posts
  └── SEO Value: High (long-tail keywords)

blog-posts/super-8-vs-digital-wedding-video.md
  ├── References:
  │     ├── seo-implementation-guide.md (keyword optimization)
  │     └── Service page copy (internal links)
  ├── Purpose: Educational SEO content
  └── SEO Value: High (comparison keywords, decision-stage searches)

location-pages/buffalo-wedding-videographer.md
  ├── References:
  │     ├── seo-implementation-guide.md (local SEO)
  │     └── pricing-sheet-2025.md (travel fees)
  ├── Purpose: Template for location-specific landing pages
  ├── SEO Value: Very high (local + service keywords)
  └── Replicate for: Rochester, Syracuse, Finger Lakes, Adirondacks
```

### Client Systems Layer

```
CLIENT JOURNEY FLOW:

1. Inquiry → email-templates.md (Initial Response)
   ├── Template: "Thanks for reaching out"
   ├── Response time: Within 1 hour
   └── Next step: Book consultation

2. Consultation → consultation-call-script.md
   ├── References: pricing-sheet-2025.md (pricing presentation)
   ├── Contains:
   │     ├── Question framework
   │     ├── Value positioning
   │     ├── Objection handling
   │     └── Closing techniques
   └── Next step: Send proposal

3. Proposal → email-templates.md (Proposal Email)
   ├── References: pricing-sheet-2025.md (package details)
   └── Next step: Contract signing

4. Booking → contract-template-outline.md
   ├── References: pricing-sheet-2025.md (terms, pricing)
   ├── Contains:
   │     ├── Service agreement
   │     ├── Payment terms
   │     ├── Cancellation policy
   │     ├── Deliverables
   │     └── Copyright terms
   └── Next step: Send questionnaire

5. Pre-Wedding → client-questionnaire-template.md
   ├── Timing: Send 60 days before wedding
   ├── Contains:
   │     ├── 11 sections (Basics, Vision, Music, Must-Have Moments, etc.)
   │     ├── 50+ questions
   │     └── Song preferences, family dynamics, special requests
   └── Next step: Wedding day

6. Post-Wedding → email-templates.md (Thank You + Delivery)
   └── Next step: Request testimonial/review
```

### Marketing Materials Layer

```
email-templates.md
  ├── References:
  │     ├── pricing-sheet-2025.md (pricing mentions)
  │     ├── consultation-call-script.md (consultation invite)
  │     └── contract-template-outline.md (booking confirmation)
  ├── Contains: 10 templates
  │     ├── Initial inquiry response
  │     ├── Consultation follow-up
  │     ├── Proposal email
  │     ├── Booked confirmation
  │     ├── Price objection handling
  │     ├── "Not sure yet" nurture
  │     ├── Referral request
  │     └── Thank you email
  ├── Purpose: Fast, professional communication
  └── Impact: 50% of couples book first responder

lead-nurture-email-sequence.md
  ├── References:
  │     ├── email-templates.md (initial response)
  │     └── Service page copy (educational content)
  ├── Contains: 5-email sequence
  │     ├── Email 1 (Day 0): Thanks + next steps
  │     ├── Email 2 (Day 2): Why film matters (education)
  │     ├── Email 3 (Day 5): Real couple story (social proof)
  │     ├── Email 4 (Day 10): Objection handling (FAQ-style)
  │     └── Email 5 (Day 15): Urgency - limited availability
  ├── Purpose: Automated follow-up for inquiries
  └── Impact: 20-30% of inquiries convert through nurture

instagram-30-day-content-calendar.md
  ├── References:
  │     ├── sample-archive-posts/*.md (content ideas)
  │     └── Service page copy (key messages)
  ├── Contains:
  │     ├── 30 days of post ideas
  │     ├── Content mix (films, BTS, education, engagement)
  │     ├── Hashtag strategy (#super8wedding #rochesterwedding)
  │     ├── Optimal posting times
  │     └── Reels templates
  ├── Purpose: Consistent Instagram presence
  └── Impact: Instagram drives 40-60% of inquiries
```

---

## CORE DOCUMENTATION FILES

### README.md
- **Path:** `/nightfoxfilms/README.md`
- **Purpose:** Project overview and entry point
- **Status:** Updated 2025-11-18
- **References:** All major strategy documents
- **Used by:** Anyone first exploring repository
- **Key Sections:** What this is, file structure, how to use, next steps

### claude.md
- **Path:** `/nightfoxfilms/claude.md`
- **Purpose:** Development principles and standard operating procedures
- **Status:** Created 2025-11-18
- **Contains:** THE RULES (KISS, FAANG PE, BPL, BPA, NME, WWYDD, DRETW, LILBITS)
- **Contains:** Core Process (11-step development workflow)
- **References:** techguide.md, lilbits.md, user prompts
- **Used by:** AI assistants (Claude), developers
- **Importance:** CRITICAL - defines how all work is done

### techguide.md (THIS FILE)
- **Path:** `/nightfoxfilms/techguide.md`
- **Purpose:** Complete technical reference and file map
- **Status:** Created 2025-11-18
- **Contains:** Every file, all dependencies, all relationships
- **References:** Every file in repository
- **Used by:** Developers, AI assistants, project managers
- **Importance:** CRITICAL - master reference document

### lilbits.md
- **Path:** `/nightfoxfilms/lilbits.md`
- **Purpose:** Document all modular scripts
- **Status:** Created 2025-11-18 (no scripts yet)
- **Contains:** Script documentation (when scripts exist)
- **Used by:** Developers running automation
- **Importance:** HIGH - enforces LILBITS principle

### todo.md
- **Path:** `/nightfoxfilms/todo.md`
- **Purpose:** Track technical debt and improvements
- **Status:** Created 2025-11-18
- **Contains:** Gap analysis, task tracking, decision log
- **Used by:** Project planning, sprint tracking
- **Importance:** HIGH - roadmap for improvements

---

## KEY RULES AND PRINCIPLES

### From claude.md - THE RULES

**KISS = Keep It Simple, Stupid**
- Simplest solution wins
- One function = one purpose
- Readable beats clever

**FAANG PE = Enterprise Quality for Small Teams**
- Production-ready code
- Comprehensive error handling
- Automated testing
- Security-first mindset

**BPL = Bulletproof Long-Term**
- Build for 3-10 year reliability
- Minimize dependencies
- Design for maintainability

**BPA = Best Practices Always**
- Check official documentation
- Follow conventions (PEP 8, etc.)
- Use latest stable versions

**NME = No Emojis Ever**
- Professional communication
- No emojis in code, commits, docs

**WWYDD = What Would You Do Differently**
- Question assumptions
- Propose better alternatives
- Explain trade-offs

**DRETW = Don't Re-Invent The Wheel**
- Search GitHub first
- Use proven solutions
- Borrow code (with attribution)

**LILBITS = Little Bits**
- One script = one function
- Modular, composable, reusable
- Document in lilbits.md

### Repository-Specific Rules

**Documentation Standards:**
- All strategy docs must have "Last Updated" date
- Breaking changes require migration guide
- Internal links must be valid (validate with script)
- File names: lowercase-with-dashes.md

**Content Standards:**
- Copy must match wireframe structure
- Pricing must reference pricing-sheet-2025.md as source of truth
- SEO implementation must follow seo-implementation-guide.md
- All archive posts follow archive-blog-structure.md template

**Git Standards:**
- Conventional commits (feat:, fix:, docs:, etc.)
- No .DS_Store or OS cruft (use .gitignore)
- Branch naming: feature/description or fix/description
- Meaningful commit messages explaining WHY not WHAT

---

## WORKFLOWS AND PROCESSES

### Website Build Workflow

```
PHASE 1: Planning
1. Read IMPLEMENTATION-SUMMARY.md (understand strategy)
2. Read MASTER-IMPLEMENTATION-CHECKLIST.md (task list)
3. Review competitive-analysis.md (market positioning)

PHASE 2: Content Preparation
4. Review wireframes/*.md (structure for each page)
5. Review copy/*.md (content for each page)
6. Review pricing-sheet-2025.md (pricing to display)
7. Gather portfolio images/videos

PHASE 3: Technical Setup
8. Choose platform (Squarespace vs WordPress vs custom)
9. Read developer-guide.md (if custom build)
10. Set up hosting, domain, email
11. Install analytics (Google Analytics, Search Console)

PHASE 4: Page Build
12. Build pages using wireframes as structure
13. Add copy from copy/*.md files
14. Implement SEO (follow seo-implementation-guide.md)
15. Test on mobile and desktop

PHASE 5: Systems Setup
16. Implement contact forms
17. Set up email templates (email-templates.md)
18. Configure lead nurture sequence (lead-nurture-email-sequence.md)
19. Set up contract system (contract-template-outline.md)
20. Configure client questionnaire (client-questionnaire-template.md)

PHASE 6: Marketing Launch
21. Optimize Instagram (instagram-30-day-content-calendar.md)
22. Create initial archive posts (sample-archive-posts/*.md as templates)
23. Publish first blog post (blog-posts/*.md)
24. Set up location pages (location-pages/*.md)

PHASE 7: Testing & Launch
25. Test all forms, links, CTAs
26. Verify mobile responsiveness
27. Check page load speed
28. Verify analytics tracking
29. Launch website
30. Monitor and optimize
```

### Content Creation Workflow

```
FOR ARCHIVE POSTS:
1. Read archive-blog-structure.md (template)
2. Use sample-archive-posts/*.md as examples
3. Follow SEO guidelines from seo-implementation-guide.md
4. Include: couple story, vendor credits, testimonial, CTA
5. Optimize for keywords: [location] + [medium] + wedding

FOR BLOG POSTS:
1. Identify topic from research-guide.md keyword research
2. Review seo-implementation-guide.md for optimization
3. Write educational content
4. Internal links to service pages and pricing
5. Include CTA to book consultation

FOR LOCATION PAGES:
1. Use location-pages/buffalo-wedding-videographer.md as template
2. Research top venues in location
3. Include location-specific keywords
4. Reference pricing with travel fees (pricing-sheet-2025.md)
```

### Client Management Workflow

```
INQUIRY STAGE:
1. Receive inquiry via contact form
2. Respond within 1 hour using email-templates.md (inquiry template)
3. Send consultation booking link

CONSULTATION STAGE:
4. Use consultation-call-script.md framework
5. Reference pricing-sheet-2025.md for pricing presentation
6. Send proposal within 2 hours (email-templates.md proposal template)

BOOKING STAGE:
7. Send contract (contract-template-outline.md)
8. Collect deposit (50% upfront per pricing-sheet-2025.md)
9. Send booking confirmation (email-templates.md)
10. Add to lead nurture sequence if not booked (lead-nurture-email-sequence.md)

PRE-WEDDING STAGE:
11. Send client questionnaire 60 days before (client-questionnaire-template.md)
12. Review questionnaire responses
13. Confirm timeline and details 30 days before
14. Final check-in 7 days before

POST-WEDDING STAGE:
15. Send thank you email (email-templates.md)
16. Deliver film within promised timeline
17. Request testimonial and review
18. Ask for referrals
19. Create archive post (archive-blog-structure.md)
```

---

## INTEGRATION MAP

### How Files Work Together

**Example: Building the Super 8 Service Page**

```
INPUT FILES:
├── wireframes/super-8-page-wireframe.md (STRUCTURE)
│   └── Sections: Hero, Why Super 8, Package Details, FAQ, CTA
│
├── copy/super-8-page-copy.md (CONTENT)
│   └── All written copy for each section
│
├── pricing-sheet-2025.md (PRICING)
│   └── Super 8 Package: $2,800 + details
│
├── seo-implementation-guide.md (SEO)
│   ├── Meta title: "Super 8 Wedding Films | Nightfox Films | Rochester NY"
│   ├── Meta description: 140-160 characters
│   ├── H1 tag: "Super 8 Wedding Films in Rochester, NY"
│   ├── Schema markup: Service, LocalBusiness
│   └── Keywords: super 8 wedding film, analog wedding video
│
└── rebrand.md (VOICE/TONE)
    └── Ensure copy matches brand voice

PROCESS:
1. Developer reads wireframe (knows structure)
2. Developer adds copy from copy file
3. Developer integrates pricing from pricing-sheet
4. Developer implements SEO from SEO guide
5. Developer ensures tone matches brand guide

OUTPUT:
└── Live Super 8 service page on website
```

**Example: Client Books a Wedding**

```
STEP 1: Inquiry
├── Client fills out contact form on website
├── Form references email-templates.md (autoresponder)
└── Owner sends inquiry response within 1 hour (email-templates.md)

STEP 2: Consultation
├── Client books consultation via Calendly
├── Owner uses consultation-call-script.md during call
├── Owner references pricing-sheet-2025.md for package details
└── Owner sends proposal (email-templates.md) within 2 hours

STEP 3: Booking
├── Client signs contract (contract-template-outline.md)
├── Client pays 50% deposit (per pricing-sheet-2025.md terms)
├── Owner sends booking confirmation (email-templates.md)
└── Owner adds client to CRM/tracking system

STEP 4: Pre-Wedding
├── Owner sends questionnaire 60 days before (client-questionnaire-template.md)
├── Client fills out 50+ questions about wedding vision
├── Owner reviews responses and notes must-have moments
└── Owner confirms timeline 30 days before

STEP 5: Wedding Day
├── Owner films wedding using Super 8 equipment
└── [Process documented in film development workflow - not in this repo]

STEP 6: Post-Wedding
├── Owner delivers film within timeline (2-4 months)
├── Owner requests testimonial (email-templates.md)
├── Owner creates archive post (archive-blog-structure.md template)
├── Owner publishes to website (SEO-optimized per seo-implementation-guide.md)
└── Archive post drives new inquiries via Google search
```

---

## SCRIPTS AND AUTOMATION

### Current State: NO SCRIPTS EXIST

**Why:** This is a documentation repository, not a code repository.

**What SHOULD exist (Recommendations):**

#### Validation Scripts

**validate-markdown.sh**
- Purpose: Check all .md files for broken links
- Importance: High
- References: All .md files
- Output: List of broken internal/external links
- Documented in: lilbits.md (when created)

**check-todos.sh**
- Purpose: Extract all TODO items from markdown
- Importance: Medium
- References: All .md files
- Output: Consolidated todo list
- Documented in: lilbits.md (when created)

**validate-pricing.sh**
- Purpose: Ensure pricing consistency across all files
- Importance: High
- References: pricing-sheet-2025.md, all copy/*.md files
- Output: Report of pricing mentions and inconsistencies
- Documented in: lilbits.md (when created)

#### Content Scripts

**update-toc.sh**
- Purpose: Auto-generate table of contents for long docs
- Importance: Medium
- References: techguide.md, developer-guide.md, research-guide.md
- Output: Updated TOC sections
- Documented in: lilbits.md (when created)

**export-to-cms.sh**
- Purpose: Convert markdown to CMS format (if using headless CMS)
- Importance: High (if using headless CMS)
- References: All copy/*.md files
- Output: JSON/API calls to populate CMS
- Documented in: lilbits.md (when created)

#### Deployment Scripts (If Custom Website)

**deploy.sh**
- Purpose: Deploy website to hosting (Vercel, Netlify, etc.)
- Importance: Critical (if custom build)
- References: developer-guide.md (deployment section)
- Output: Live website
- Documented in: lilbits.md (when created)

**health-check.sh**
- Purpose: Verify website is live and functional
- Importance: High (if custom build)
- Tests:
  - All pages return 200 status
  - Contact form submits successfully
  - Analytics tracking works
  - SSL certificate valid
- Output: Health report
- Documented in: lilbits.md (when created)

#### Backup Scripts

**backup-docs.sh**
- Purpose: Backup all documentation to external location
- Importance: Medium
- References: All .md files
- Output: Timestamped backup archive
- Documented in: lilbits.md (when created)

---

## CONFIGURATION FILES

### Existing Config

**logseq/config.edn**
- **Path:** `/nightfoxfilms/logseq/config.edn`
- **Format:** Clojure EDN (Extensible Data Notation)
- **Purpose:** Configuration for Logseq note-taking app
- **Used by:** Logseq application (for pages/ directory)
- **Status:** Active (if using Logseq), can be archived if not

### Missing Config (SHOULD CREATE)

**.gitignore**
- **Path:** `/nightfoxfilms/.gitignore` (DOES NOT EXIST)
- **Purpose:** Exclude OS cruft and temp files from git
- **Should exclude:**
  ```
  .DS_Store
  .Trash
  *.log
  node_modules/
  .env
  .vscode/
  .idea/
  ```
- **Status:** CRITICAL - needs creation

**package.json** (If adding scripts)
- **Path:** `/nightfoxfilms/package.json` (DOES NOT EXIST)
- **Purpose:** Define npm scripts for automation
- **Contains:** Script commands, dependencies
- **Status:** Create if adding Node.js automation

**Makefile** (Alternative to package.json)
- **Path:** `/nightfoxfilms/Makefile` (DOES NOT EXIST)
- **Purpose:** Define common tasks (validate, test, build, deploy)
- **Example targets:**
  ```makefile
  validate: Run validate-markdown.sh
  test: Run all validation scripts
  build: Generate TOCs, check links, validate
  deploy: Build + deploy to hosting
  ```
- **Status:** Recommended for ease of use

---

## REFERENCE COMMANDS

### Common Git Operations

```bash
# View status
git status

# Create new branch
git checkout -b feature/description

# Commit changes
git add .
git commit -m "feat(scope): description"

# Push to remote
git push origin branch-name

# View recent commits
git log --oneline -10
```

### Recommended Automation Commands (When Scripts Exist)

```bash
# Validate all markdown
./scripts/validate-markdown.sh

# Check for TODO items
./scripts/check-todos.sh

# Update table of contents
./scripts/update-toc.sh

# Deploy website (if custom)
./scripts/deploy.sh

# Run health check
./scripts/health-check.sh
```

### File Search Commands

```bash
# Find all markdown files
find . -name "*.md" -type f

# Search for keyword in all files
grep -r "keyword" --include="*.md"

# Count total lines of documentation
wc -l *.md **/*.md
```

---

## MAINTENANCE SCHEDULE

### Weekly
- [ ] Review todo.md for completed tasks
- [ ] Check for outdated information in copy/*.md
- [ ] Validate internal links still work
- [ ] Update CRITICAL-MISSING-PIECES.md status

### Monthly
- [ ] Review pricing-sheet-2025.md (adjust if needed)
- [ ] Update competitive-analysis.md (check competitor pricing)
- [ ] Add "Last Updated" dates to modified files
- [ ] Review and archive old logseq notes

### Quarterly
- [ ] Full documentation audit
- [ ] Update developer-guide.md with new best practices
- [ ] Review seo-implementation-guide.md (SEO evolves)
- [ ] Update IMPLEMENTATION-SUMMARY.md ROI projections

### Annually
- [ ] Update year in pricing-sheet (2025 → 2026)
- [ ] Major documentation refactor if needed
- [ ] Archive outdated strategy documents
- [ ] Review and update THE RULES in claude.md

---

## TROUBLESHOOTING

### Common Issues

**Issue: Pricing inconsistency across files**
- Solution: pricing-sheet-2025.md is source of truth
- Action: Search all copy/*.md files for pricing mentions
- Update: All files to reference current pricing

**Issue: Broken internal links**
- Solution: Create validate-markdown.sh script
- Action: Run validation on all .md files
- Fix: Update links to correct paths

**Issue: Outdated competitive analysis**
- Solution: Review competitors quarterly
- Action: Update competitive-analysis.md
- Impact: May affect pricing-sheet-2025.md

**Issue: Duplicate content (logseq vs root)**
- Solution: Root .md files are authoritative
- Action: Archive logseq/pages to /archive
- Reason: Logseq notes were drafts, root files are polished

---

## VERSION HISTORY

**v1.0.0 (2025-11-18)**
- Initial creation of techguide.md
- Documented all 50+ files in repository
- Created complete file dependency map
- Documented workflows and integration patterns
- Identified gaps and missing scripts

**Future Versions:**
- v1.1.0: Add script documentation when scripts created
- v1.2.0: Add deployment workflow documentation
- v2.0.0: Major update if repository structure changes

---

## NEXT STEPS

**Immediate (This Week):**
1. Create .gitignore file
2. Remove .DS_Store from repository
3. Create archive/ directory
4. Move logseq/pages to archive
5. Update CRITICAL-MISSING-PIECES.md status

**Short-term (This Month):**
6. Create validation scripts (validate-markdown.sh, check-todos.sh)
7. Add "Last Updated" dates to all strategy docs
8. Create CHANGELOG.md
9. Build location pages (Buffalo, Syracuse, Finger Lakes, Adirondacks)

**Long-term (This Quarter):**
10. DECISION: Choose website platform
11. Build actual website using documentation
12. Create deployment automation (if custom build)
13. Set up analytics and monitoring

---

**Last Updated:** 2025-11-18
**Maintained by:** Repository owner + AI assistants
**Review Schedule:** Update when major changes occur
