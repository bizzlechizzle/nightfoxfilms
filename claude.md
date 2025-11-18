# Claude Development Principles & Process

**Last Updated:** 2025-11-18
**Purpose:** Core principles and standard operating procedures for AI-assisted development on Nightfox Films repository

---

## THE RULES

### KISS = Keep It Simple, Stupid
- Simplest solution wins
- Avoid over-engineering
- One function = one purpose
- Readable code beats clever code
- If it takes more than 3 sentences to explain, simplify it

**Examples:**
- GOOD: `validate_email(email)` - Does one thing, clear purpose
- BAD: `process_user_data_and_send_email_and_log_to_db()` - Does too much

---

### FAANG PE = Facebook/Amazon/Apple/Netflix/Google-level Engineering for Small Teams
- Enterprise-grade quality at startup scale
- Write code like it will be maintained for 10 years
- Document everything (future you will thank present you)
- Use industry best practices, not hacky shortcuts
- Scalable architecture even if you only have 10 users today

**Standards:**
- Code reviews (even for solo projects - review your own code)
- Automated testing (unit tests, integration tests, end-to-end)
- Version control with meaningful commit messages
- Error handling and logging throughout
- Security-first mindset (never commit secrets, validate all inputs)

---

### BPL = Bulletproof Long-Term
- Build for reliability over 3-10 years minimum
- Assume code will outlive current tools and frameworks
- Minimize dependencies (every dependency is a liability)
- Design for maintainability (someone else might inherit this)
- Backwards compatibility whenever possible

**Checklist:**
- Will this still work in 5 years?
- Can someone unfamiliar with the codebase understand this?
- Is error handling comprehensive?
- Are breaking changes documented?
- Is there a rollback plan?

---

### BPA = Best Practices Always
- Always check official documentation (not Stack Overflow first)
- Follow language/framework conventions (PEP 8 for Python, etc.)
- Use latest stable versions (not bleeding edge, not ancient)
- Stay updated on security patches
- Reference authoritative sources

**Before writing code:**
1. Check official docs for the tool/framework/language
2. Review recent changelog for breaking changes
3. Search for known security vulnerabilities
4. Verify best practices haven't changed

---

### NME = No Emojis Ever
- Professional communication only
- Clear, concise technical writing
- No emojis in code, comments, commit messages, or documentation
- Focus on substance over style
- Technical accuracy beats personality

**Examples:**
- GOOD: "Fix authentication bug in user login"
- BAD: "Fix auth bug! Login works now"

---

### WWYDD = What Would You Do Differently - Suggestions Encouraged
- User is a generalist, not a specialist - expertise welcome
- Question assumptions before implementing
- Propose better alternatives proactively
- Explain trade-offs of different approaches
- Challenge the requirements if there's a better way

**Process:**
1. Understand the request
2. Consider alternatives
3. Propose improvements BEFORE coding
4. Explain why your approach is better
5. Let user decide final direction

**Example Response:**
"You asked for X, but have you considered Y? Here's why Y might be better:
- Pros: [list benefits]
- Cons: [list drawbacks]
- Trade-offs: [explain]
Do you want to proceed with X as requested, or explore Y?"

---

### DRETW = Don't Re-Invent The Wheel
- Search GitHub for existing solutions first
- Check npm/PyPI for packages that solve this
- Look for proven open-source alternatives
- Review Reddit/HackerNews for recommendations
- Borrow code from quality sources (with attribution)

**Process:**
1. Define the problem clearly
2. Search GitHub: "site:github.com [problem description]"
3. Search package managers: npm/PyPI/etc
4. Check awesome-lists (awesome-python, awesome-javascript, etc.)
5. If found: evaluate quality (stars, recent commits, issues, license)
6. If suitable: use it (give credit)
7. If not: build it, but borrow patterns from similar projects

**Evaluation Criteria for External Code:**
- Is it actively maintained? (commits in last 6 months)
- Does it have good documentation?
- Is the license compatible? (MIT, Apache, BSD preferred)
- Are there open security issues?
- Is the code quality high? (tests, linting, CI/CD)

---

### LILBITS = Always Write Scripts in Little Bits
- One script = one function
- Modular, composable, reusable
- Each script should do ONE thing well
- Document every new script in lilbits.md
- Easy to test, easy to debug, easy to replace

**Structure:**
```
scripts/
  validate_email.sh       # One function: validate email format
  send_email.sh           # One function: send email via API
  process_signup.sh       # Orchestrates: validate + send
```

**NOT this:**
```
scripts/
  do_everything.sh        # 500 lines, does signup, email, logging, etc.
```

**Documentation Required:**
For each script, document in lilbits.md:
- What it does (one sentence)
- Inputs/outputs
- Dependencies
- Example usage
- Error codes

---

## CORE PROCESS

Follow this process for EVERY task (fix, troubleshoot, code, brainstorm, optimize, or WWYDD):

### Step 1: Read Context
**Read in this order:**
1. User prompt (what are they asking for?)
2. claude.md (this file - core principles)
3. techguide.md (what files exist, relationships, rules)
4. lilbits.md (existing scripts and their purpose)

**Questions to answer:**
- What exactly is the user asking for?
- Have we done something similar before?
- What files/scripts are relevant to this task?
- Are there existing patterns to follow?

---

### Step 2: Search and Read Referenced Files
**Find relevant files:**
- Files explicitly mentioned in user prompt
- Files referenced in techguide.md that relate to this task
- Related scripts/configs that might be affected
- Dependencies that might break

**Use appropriate tools:**
- Glob for finding files by pattern
- Grep for searching code content
- Read for examining specific files
- Explore agent for thorough codebase understanding

---

### Step 3: Make a Plan
**Create initial plan addressing:**
- What needs to change?
- Which files are affected?
- What's the simplest approach? (KISS)
- Are there existing solutions? (DRETW)
- What could go wrong?

**Plan should include:**
- List of files to modify/create
- Sequence of changes
- Testing strategy
- Rollback plan if it fails

---

### Step 4: Make Core Logic Reference
**Before writing code, outline:**
- Key functions/components needed
- Data flow (input → processing → output)
- Error handling strategy
- Edge cases to handle

**Example:**
```
Function: validate_user_input(data)
Input: dict with user data
Logic:
  1. Check required fields exist
  2. Validate email format
  3. Validate phone format (if provided)
  4. Check for SQL injection attempts
  5. Sanitize all inputs
Output: dict (cleaned data) or raise ValidationError
Errors: InvalidEmailError, MissingFieldError, SecurityError
```

---

### Step 5: Audit the Plan
**Review plan against:**
- Step 1 findings (does it align with existing patterns?)
- Step 2 findings (does it integrate with existing files?)
- THE RULES (KISS, BPL, BPA, etc.)
- Best practices for tools/frameworks being used

**Questions:**
- Is this the simplest approach? (KISS)
- Will this work in 5 years? (BPL)
- Are we following official docs? (BPA)
- Should we suggest alternatives? (WWYDD)
- Does a solution already exist? (DRETW)
- Are we using modular scripts? (LILBITS)

**Update plan based on audit findings.**

---

### Step 6: Write Implementation Guide
**Create guide for a new developer:**
- Prerequisites (what must be installed/configured first)
- Step-by-step instructions (numbered, clear, complete)
- Expected outcome for each step
- How to verify it worked
- What to do if it fails

**Format:**
```
## Implementation Guide: [Feature Name]

### Prerequisites
- Python 3.9+
- pip packages: requests, pytest
- API key configured in .env

### Steps
1. Create new file `scripts/feature.py`
   Expected: File exists with basic structure

2. Add function `def process_data(input_data)`
   Expected: Function accepts dict, returns dict

3. Add error handling for network failures
   Expected: Raises custom NetworkError on timeout

4. Write unit tests in `tests/test_feature.py`
   Expected: All tests pass

### Verification
Run: `pytest tests/test_feature.py`
Expected output: All tests passed (100% coverage)

### Rollback
If deployment fails: `git revert [commit-hash]`
```

---

### Step 7: Audit the Implementation Guide
**Review guide against:**
- Step 1 context (does it fit the project?)
- Step 2 file analysis (does it integrate correctly?)
- Step 4 core logic (does implementation match design?)
- Best practices for all tools used (linters, formatters, testing frameworks)

**Check:**
- Are all dependencies documented?
- Is every step clear and unambiguous?
- Have we linked to official documentation where relevant?
- Are error cases handled?
- Is the rollback plan viable?

**Update guide based on audit.**

---

### Step 8: Write Technical Guide with Examples
**Create detailed technical documentation:**
- Code examples for key functions
- Logic explanations (why this approach?)
- Architecture diagrams (if complex)
- API documentation (inputs, outputs, errors)
- Integration examples (how to use this with other components)

**Format:**
```
## Technical Guide: [Feature Name]

### Overview
[What this does and why it exists]

### Architecture
[How components interact - diagram if needed]

### API Reference
#### `function_name(param1, param2)`
- param1 (str): Description
- param2 (int): Description
- Returns: dict with keys {result, status, error}
- Raises: CustomError if validation fails

### Example Usage
```python
from scripts.feature import process_data

data = {"user": "john", "email": "john@example.com"}
result = process_data(data)
print(result)  # Output: {"status": "success", "user_id": 123}
```

### Error Handling
| Error | Cause | Solution |
|-------|-------|----------|
| ValidationError | Invalid input | Check input format |
| NetworkError | API timeout | Retry with backoff |

### Testing
Run tests: `pytest tests/test_feature.py -v`
Coverage: `pytest --cov=scripts/feature`

### Integration
This module is used by:
- scripts/main.py (calls process_data)
- scripts/batch_processor.py (calls in loop)
```

---

### Step 9: Write/Update/Create Code
**Now write the actual code:**
- Follow implementation guide from Step 6
- Use technical design from Step 8
- Adhere to all THE RULES
- Keep it modular (LILBITS)

**Code Quality Checklist:**
- Follows language conventions (PEP 8, ESLint, etc.)
- Has docstrings/comments explaining WHY not WHAT
- Includes error handling
- Has input validation
- Logs important events
- No hardcoded secrets or credentials

---

### Step 10: Audit the Code
**Review finished code against:**
- Step 1 original requirements
- Step 2 file integration
- Step 4 core logic design
- Step 6 implementation guide
- Step 7 best practices
- THE RULES (all of them)

**Final Checklist:**
- Does it work? (test it)
- Is it simple? (KISS)
- Is it production-ready? (FAANG PE)
- Will it last? (BPL)
- Follows best practices? (BPA)
- No emojis? (NME)
- Could we have done better? (WWYDD)
- Did we check for existing solutions? (DRETW)
- Is it modular? (LILBITS)

**If any answer is NO, update the code.**

---

### Step 11: Update Documentation
**Update these files:**
- techguide.md (add new file to map, note dependencies)
- lilbits.md (if new script, document it fully)
- README.md (if major feature, update overview)
- CHANGELOG.md (note what changed and why)

**Documentation must include:**
- What changed
- Why it changed
- How to use the new feature
- What files were modified
- Any breaking changes
- Migration guide (if needed)

---

## EXAMPLE WALKTHROUGH

### User Request:
"Create a script to validate email addresses in our contact form"

### Step 1: Read Context
- Read claude.md (this file) ✓
- Read techguide.md - check if email validation exists
- Read lilbits.md - check for similar validation scripts
- Understanding: Need modular email validation script

### Step 2: Search Files
- Grep for existing email validation: `grep -r "validate.*email"`
- Check if libraries are already imported: `grep -r "import re"`
- Review techguide.md for validation standards
- Finding: No existing email validation

### Step 3: Make a Plan
Initial plan:
1. Create `scripts/validate_email.py`
2. Use regex for email validation
3. Return True/False
4. Add to lilbits.md

### Step 4: Core Logic
```
Function: validate_email(email)
Input: str (email address)
Logic:
  1. Check if email is string
  2. Check basic format with regex (RFC 5322)
  3. Check for common typos (.con instead of .com)
  4. Optionally: DNS lookup for domain
Output: bool (True if valid)
Errors: TypeError if not string
```

### Step 5: Audit Plan
- KISS: Yes, simple function
- DRETW: Check if library exists... found `email-validator` on PyPI
- WWYDD: Should we use library instead of regex?
**Updated plan:** Use `email-validator` library (more reliable than regex)

### Step 6: Implementation Guide
```
## Implementation: Email Validation

### Prerequisites
- Python 3.9+
- Install: `pip install email-validator`

### Steps
1. Create `scripts/validate_email.py`
2. Import email_validator library
3. Implement validate_email(email) function
4. Add error handling
5. Write tests in `tests/test_validate_email.py`
6. Update lilbits.md with documentation
```

### Step 7: Audit Implementation Guide
- BPA: Yes, using official PyPI package
- All steps clear and testable
- Guide is complete

### Step 8: Technical Guide
```python
## Email Validation Module

### API
validate_email(email: str) -> bool

### Example
from scripts.validate_email import validate_email

result = validate_email("user@example.com")  # True
result = validate_email("invalid.email")      # False
```

### Step 9: Write Code
```python
# scripts/validate_email.py
from email_validator import validate_email as validator, EmailNotValidError

def validate_email(email):
    """
    Validate email address format.

    Args:
        email (str): Email address to validate

    Returns:
        bool: True if valid, False otherwise

    Uses email-validator library for RFC 5322 compliance.
    """
    if not isinstance(email, str):
        return False

    try:
        validator(email, check_deliverability=False)
        return True
    except EmailNotValidError:
        return False
```

### Step 10: Audit Code
- KISS: Yes, simple 10-line function
- FAANG PE: Uses industry-standard library
- BPL: Library is well-maintained
- BPA: Following official library docs
- NME: No emojis ✓
- LILBITS: One function, one purpose ✓

### Step 11: Update Documentation
- Add to lilbits.md
- Add to techguide.md (dependencies section)
- Note in todo.md as completed

---

## SPECIAL CASES

### When User Provides Incomplete Requirements
**DO:**
- Ask clarifying questions
- Propose what you THINK they want
- Explain trade-offs of different interpretations
- Use WWYDD to suggest improvements

**DON'T:**
- Assume and build the wrong thing
- Build the first solution that comes to mind
- Skip the planning steps

---

### When Existing Code is Poor Quality
**DO:**
- Point out issues professionally
- Suggest refactoring approach
- Explain benefits of cleanup
- Offer to fix it (with permission)

**DON'T:**
- Silently perpetuate bad patterns
- Criticize without offering solutions
- Refactor without asking

---

### When Requirements Conflict with THE RULES
**DO:**
- Explain the conflict
- Propose alternative that follows rules
- Explain why rules exist
- Let user override if they insist (document why)

**DON'T:**
- Blindly follow bad requirements
- Break rules without discussion

---

### When Stuck or Uncertain
**DO:**
- Admit uncertainty
- Research official documentation
- Propose multiple approaches
- Ask for user input

**DON'T:**
- Guess and hope it works
- Use outdated Stack Overflow answers
- Skip research steps

---

## QUALITY GATES

Before considering ANY task complete:

**Code Quality:**
- [ ] Follows language conventions
- [ ] Has comprehensive error handling
- [ ] Includes tests (if applicable)
- [ ] No hardcoded secrets
- [ ] Passes linter/formatter

**Documentation:**
- [ ] Updated techguide.md
- [ ] Updated lilbits.md (if script)
- [ ] Updated README.md (if major change)
- [ ] Inline comments explain WHY

**Process:**
- [ ] Followed all 11 steps
- [ ] Audited against THE RULES
- [ ] Checked for existing solutions (DRETW)
- [ ] Proposed improvements (WWYDD)

**Testing:**
- [ ] Manually tested happy path
- [ ] Tested error cases
- [ ] Verified integration with existing code
- [ ] Documented test results

---

## COMMIT MESSAGE STANDARDS

Follow conventional commits:

**Format:**
```
type(scope): brief description

Longer explanation if needed.

Refs: #issue-number
```

**Types:**
- feat: New feature
- fix: Bug fix
- docs: Documentation only
- refactor: Code change that neither fixes bug nor adds feature
- test: Adding tests
- chore: Maintenance (dependencies, etc.)

**Examples:**
```
feat(validation): add email validation script

Implements email validation using email-validator library.
Follows LILBITS principle with single-purpose function.

Refs: #42

---

docs(techguide): add email validation to file map

Documents new validate_email.py script and its dependencies.

---

fix(validation): handle None input gracefully

Previously crashed on None, now returns False.
Adds test case for None input.
```

---

## INFRASTRUCTURE & PLATFORM DECISIONS

### Applying WWYDD to Technology Choices

**Current Status:** Platform decision MADE - Next.js + Open-Source Stack

**Decision Date:** 2025-11-18

See `OPEN-SOURCE-STACK.md` for complete implementation guide.

### Platform Decision Framework (Following THE RULES)

**KISS (Keep It Simple):**
- Use proven, stable frameworks (Next.js is mature)
- Leverage platform defaults (App Router, Static Export)
- Don't over-engineer - use static generation where possible
- Free hosting with Cloudflare Pages (no server to manage)

**FAANG PE (Enterprise Quality):**
- Next.js used by Netflix, Uber, Hulu (production-proven)
- Git-based CMS workflow (version control everything)
- Edge deployment for global performance
- Professional-grade stack for zero cost

**BPL (Bulletproof Long-Term):**
- Next.js backed by Vercel, massive adoption (won't disappear)
- Open-source everything (no vendor lock-in)
- Static exports work forever (no backend dependencies)
- Own all content as markdown (portable anywhere)

**BPA (Best Practices):**
- Follow Next.js official docs (App Router is current standard)
- Use official Cloudflare Pages deployment guides
- Implement proper SEO with metadata API
- Follow JAMstack architecture patterns

**DRETW (Don't Re-Invent The Wheel):**
- Use Next.js instead of building from scratch
- Use Decap CMS instead of custom admin panel
- Use Web3Forms instead of custom form backend
- Use Cal.com instead of building booking system

**WWYDD (What Would You Do Differently):**

This platform decision prioritizes:
1. Zero vendor lock-in (everything open-source)
2. Minimal ongoing costs ($12/year domain only)
3. Maximum flexibility (own the entire stack)
4. Professional quality (same tools as major companies)

### Final Platform Decision: Next.js + Open-Source Stack

**PLATFORM CHOSEN: Custom Next.js with Open-Source Tools**

**Reasoning:**
- User requirement: "We want free and open source"
- User requirement: "Breaking up with the corporate overlords"
- User confirmation: "Custom next.js"
- Budget-conscious approach with professional results
- Complete control and ownership of all code and content

### The Complete Open-Source Stack

See `OPEN-SOURCE-STACK.md` for detailed implementation guide.

| Component | Tool | Cost | License |
|-----------|------|------|---------|
| **Frontend** | Next.js 14+ (App Router) | $0 | MIT (Open-Source) |
| **Hosting** | Cloudflare Pages | $0 | N/A (Free Service) |
| **CMS** | Decap CMS (git-based) | $0 | MIT (Open-Source) |
| **Forms** | Web3Forms | $0 | Free Service |
| **Booking** | Cal.com (self-hosted) | $0 | AGPL (Open-Source) |
| **Analytics** | Umami (self-hosted) | $0 | MIT (Open-Source) |
| **Email** | Resend | $0 | Free tier (100/day) |
| **Images** | Cloudinary | $0 | Free tier (25GB) |

**Total monthly cost:** $0
**Total annual cost:** $12 (domain registration only)

### Architecture Overview

```
Users
  ↓
Cloudflare Pages CDN (Global Edge Network)
  ↓
Next.js 14 Static Site (App Router)
  ↓
Content: Markdown files in Git
  ↓
Decap CMS Admin (/admin) → Git Repository → Auto-deploy
```

**Key Benefits:**
- No server to manage (static export + edge deployment)
- No database to maintain (content as markdown files)
- No vendor lock-in (everything open-source)
- Automatic deployments (git push = deploy)
- Global CDN (fast worldwide)
- Unlimited bandwidth (Cloudflare Pages free tier)

### CMS Decision: Decap CMS (Git-Based)

**Why Decap CMS:**
- 100% open-source (MIT license, no vendor)
- Git-based workflow (content = markdown files in repo)
- No database required (files are the database)
- No hosting cost (runs in browser)
- Version control for all content (full history)
- Works offline (local development)

**Alternatives Considered:**
- Sanity.io: Proprietary, has free tier but vendor lock-in
- Contentful: Expensive ($300/month), proprietary
- Strapi: Requires database hosting, more complex
- WordPress: Not JAMstack, requires PHP hosting

**Decision:** Decap CMS aligns perfectly with "free and open source" requirement

### Inquiry System Implementation

**Contact Forms: Web3Forms**
- 100% free (unlimited submissions)
- No backend required (API endpoint)
- Spam protection included
- Email notifications
- 5-minute setup

**Booking: Cal.com (Self-Hosted)**
- Open-source Calendly alternative (AGPL license)
- Deploy free on Vercel or Railway
- Connect to Google Calendar
- Customizable booking pages
- No per-booking fees

**Email: Resend**
- 100 emails/day free tier
- Modern API (better than SendGrid/Mailgun)
- React Email templates
- For automation, migrate to Listmonk (self-hosted, unlimited)

**Client Management:**
- Start: Google Workspace (email + calendar + drive)
- Build custom portal later in Next.js (you own the code)

### What Can Be Done NOW (Platform Decision Made)

**Next steps to begin implementation:**

1. **Purchase domain** (15 min, $12-15)
   - Buy nightfoxfilms.com
   - Use Namecheap or Cloudflare Registrar
   - Don't connect yet (will configure with Cloudflare Pages)

2. **Set up development environment** (30 min)
   - Install Node.js 18+ and npm
   - Install Git (if not already)
   - Clone this repository locally
   - See OPEN-SOURCE-STACK.md for detailed setup

3. **Create Next.js project** (15 min)
   - Run: `npx create-next-app@latest nightfoxfilms-site`
   - Choose: App Router, TypeScript, Tailwind CSS
   - Initialize git repository
   - See OPEN-SOURCE-STACK.md Step 1

4. **Deploy to Cloudflare Pages** (15 min)
   - Connect GitHub repository
   - Configure build settings
   - Get live preview URL
   - See OPEN-SOURCE-STACK.md Step 2

5. **Set up Decap CMS** (20 min)
   - Add config.yml for CMS admin
   - Configure collections (pages, services, blog, archive)
   - Enable GitHub OAuth
   - Access admin at yourdomain.com/admin

**Total setup time: 2 hours to live site**

### Implementation Timeline (8-Week Launch)

**Week 1: Foundation**
- Day 1-2: Set up Next.js project and deploy to Cloudflare Pages
- Day 3-4: Configure Decap CMS and create content collections
- Day 5-7: Build home page layout and navigation

**Week 2-3: Core Pages**
- Week 2: Services page, About page, Contact page
- Week 3: FAQ page, Pricing page, Archive structure

**Week 4-5: Content & Features**
- Week 4: Import all copy from wireframes/, add forms
- Week 5: Set up Cal.com booking, integrate Web3Forms

**Week 6-7: Polish & SEO**
- Week 6: Add Umami analytics, optimize images
- Week 7: SEO metadata, sitemap, robots.txt

**Week 8: Launch**
- Test all features and forms
- Connect custom domain
- Go live and start marketing

**Detailed implementation: See OPEN-SOURCE-STACK.md**

### Common Mistakes to Avoid

**DON'T:**
- Skip the official Next.js tutorial (invest 2 hours to save 20)
- Ignore TypeScript errors (fix them immediately)
- Deploy without testing locally first
- Hardcode content (use CMS from day one)
- Over-complicate the design (start simple, iterate)

**DO:**
- Follow Next.js App Router patterns (official docs)
- Use static generation for all pages (fast, free)
- Test on mobile first (most users on phones)
- Set up analytics from day one (Umami)
- Version control everything (git commit often)
- Reference OPEN-SOURCE-STACK.md for step-by-step guidance

---

## SUMMARY

**Every task, every time:**
1. Read context (claude.md, techguide.md, lilbits.md, user prompt)
2. Search and read relevant files
3. Make a plan
4. Design core logic
5. Audit the plan
6. Write implementation guide
7. Audit the guide
8. Write technical documentation
9. Write the code
10. Audit the code
11. Update all documentation

**Every decision:**
- KISS - Keep it simple
- FAANG PE - Enterprise quality
- BPL - Build for long-term
- BPA - Follow best practices
- NME - No emojis
- WWYDD - Suggest improvements
- DRETW - Use existing solutions
- LILBITS - Modular scripts

---

**Last Review:** 2025-11-18
**Next Review:** When THE RULES need updating or process improvements identified
