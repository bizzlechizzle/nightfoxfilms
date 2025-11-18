# Infrastructure Status - Inquiry Systems, CMS, and Technical Setup

**Last Updated:** 2025-11-18
**Purpose:** Comprehensive audit of what's implemented vs what's planned vs what's missing
**Status:** PLATFORM DECISION MADE - Ready to begin implementation

---

## Executive Summary

**PLATFORM DECISION: Next.js + Open-Source Stack** (Decided: 2025-11-18)

**Current Reality:** This repository contains ZERO technical infrastructure. No website, no CMS, no inquiry forms, no databases, no hosting, no domains configured.

**What exists:**
- Excellent documentation planning what SHOULD be built
- Complete open-source technology stack selected (see OPEN-SOURCE-STACK.md)
- Platform decision finalized - ready to implement

**What's missing:** Everything technical - the actual implementation (but now unblocked)

---

## INQUIRY SYSTEMS

### What's Documented (But Not Implemented)

**Contact Forms (Planned):**
- Location: Referenced in `MASTER-IMPLEMENTATION-CHECKLIST.md` (lines 209-227)
- Platform recommendation: Native platform forms (Squarespace/WordPress) OR custom with Formspree/Netlify Forms
- Fields documented:
  - Name (required)
  - Email (required)
  - Phone (optional)
  - Wedding Date (required)
  - Venue/Location (optional)
  - Package Interest (dropdown)
  - How did you hear about us? (dropdown)
  - Message (optional)

**Booking System (Planned):**
- Platform: Calendly (free plan recommended)
- Integration: Embed on Pricing page and Contact page
- Purpose: Schedule consultation calls
- Mentioned in: `email-templates.md`, `MASTER-IMPLEMENTATION-CHECKLIST.md`

**Email Response System (Documented):**
- File: `email-templates.md` (10 templates created)
- Templates include:
  1. Initial inquiry response
  2. Consultation follow-up
  3. Proposal email
  4. Booked confirmation
  5. Price objection handling
  6. "Not sure yet" nurture
  7. Referral request
  8. Thank you email
- **Status:** Templates written, NOT connected to any system

**Lead Nurture (Documented):**
- File: `lead-nurture-email-sequence.md` (5-email sequence)
- Platform recommendation: Mailchimp (free) or ConvertKit ($15/month)
- Automation trigger: Form submission
- **Status:** Sequence written, NOT implemented in any email platform

### What's Actually Set Up

**NOTHING.**

- No website = no forms
- No Calendly account created
- No email platform configured
- No autoresponders set up
- No form submissions possible
- No inquiry tracking system

### What Needs to Happen

**To implement inquiry system:**

1. **Platform chosen: Next.js + Open-Source Stack** (DECISION MADE ✅)
   - Forms: Web3Forms (100% free, unlimited submissions)
   - Alternative: Cloudflare Workers (custom, free)
   - See OPEN-SOURCE-STACK.md for complete setup guide

2. **Set up Calendly** (15 minutes)
   - Create free Calendly account
   - Set availability (recommend: Tue-Thu 6-8pm, Sat 10am-2pm)
   - Create event type: "Wedding Consultation Call" (30 minutes)
   - Get embed code
   - Add to website

3. **Configure email platform** (2-4 hours)
   - Sign up for Mailchimp or ConvertKit
   - Import email templates from `email-templates.md`
   - Create automation for lead nurture sequence
   - Connect to contact form submissions
   - Test automation flow

4. **Create contact form** (1-2 hours)
   - Build form with fields from checklist
   - Connect to email (form → your inbox)
   - Set up autoresponder (confirms receipt)
   - Add Google Analytics goal tracking
   - Test submission

**Estimated total setup time:** 4-8 hours
**Monthly cost:** $0-38 (Calendly free, email platform $0-15, forms built-in)

---

## CMS (Content Management System)

### Platform Chosen: Decap CMS (Git-Based, Open-Source)

**DECISION MADE:** Decap CMS (formerly Netlify CMS) ✅

**Why Decap CMS:**
- 100% open-source (MIT license, no vendor lock-in)
- Git-based workflow (content = markdown files in repository)
- No database required (files are the database)
- No hosting cost (runs in browser, static admin panel)
- Version control for all content (full git history)
- Works offline (local development possible)
- Aligns with "free and open source" requirement

**Cost:** $0/month (completely free)

**Alternatives Considered (but rejected):**
- Sanity.io: Proprietary, vendor lock-in
- Contentful: Expensive ($300/month), proprietary
- Strapi: Requires database hosting, more complex
- WordPress: Not JAMstack, requires PHP hosting
- Squarespace: Proprietary, expensive ($23/month)

### What's Actually Set Up

**NOTHING.**

- No CMS platform chosen
- No CMS account created
- No content imported
- No admin interface
- No content editing capability

### What Content Would Go in CMS

**If CMS is used:**

1. **Page Content:**
   - Home page copy (from `copy/home-page-copy.md`)
   - Service pages (Super 8, Dad Cam, etc.)
   - About page
   - FAQ page
   - Pricing (from `pricing-sheet-2025.md`)

2. **Blog Posts:**
   - Educational content (from `blog-posts/`)
   - Archive posts (from `sample-archive-posts/`)

3. **Portfolio:**
   - Wedding films (videos)
   - Featured weddings
   - Vendor credits

4. **SEO:**
   - Meta titles and descriptions
   - Schema markup
   - Location pages

**Current status:** All content exists as markdown files, needs to be:
- Imported to CMS
- Formatted for web display
- Connected to templates

### What Needs to Happen

**To implement Decap CMS:**

1. **Platform Decision MADE** ✅
   - Chosen: Decap CMS (git-based, open-source)
   - Frontend: Next.js 14+ (App Router)
   - Hosting: Cloudflare Pages (free tier)
   - See OPEN-SOURCE-STACK.md for complete guide

2. **Set up Decap CMS** (20-30 minutes)
   - Create `public/admin/config.yml` with CMS configuration
   - Configure collections: pages, services, blog, archive
   - Enable GitHub OAuth for authentication
   - Access admin panel at yourdomain.com/admin
   - Full setup instructions in OPEN-SOURCE-STACK.md

3. **Import existing content** (2-4 hours)
   - Convert existing markdown files to Decap format
   - Import copy from wireframes/ directory
   - Set up content structure matching wireframes
   - Configure media library (Cloudinary integration)

4. **Deploy CMS admin** (5 minutes)
   - Decap admin is static files (no server needed)
   - Deploys automatically with Next.js site
   - No separate hosting required

**Time to implement:** 3-5 hours total
**Monthly cost:** $0 (completely free)

---

## EMAIL INFRASTRUCTURE

### What's Set Up

**NOTHING YET.**

**Domain:** Not purchased
**Email service:** Not configured
**Sending domain:** Not set up
**DMARC/SPF/DKIM:** Not configured

### What's Needed

**Professional Email:**
- Domain: `nightfoxfilms.com` (needs to be purchased)
- Email: `hello@nightfoxfilms.com` or `jess@nightfoxfilms.com`
- Provider options:
  - Google Workspace ($6/user/month) - Professional
  - Zoho Mail (Free for 1 user) - Budget
  - Microsoft 365 ($6/user/month) - Enterprise
  - Domain email through hosting - Varies

**Marketing Email:**
- Platform: Mailchimp (free up to 500 contacts) or ConvertKit ($15/month)
- Purpose: Send automated nurture sequences
- Setup: Import templates from `lead-nurture-email-sequence.md`

**Transactional Email:**
- Platform: SendGrid (free tier) or Postmark
- Purpose: Contact form notifications, booking confirmations
- Integration: Website → SendGrid → your inbox

**Current Status:**
- Email templates: ✅ Written (10 templates)
- Nurture sequence: ✅ Written (5 emails)
- Email platform: ❌ Not configured
- Domain email: ❌ Not set up
- Automation: ❌ Not connected

**Setup Time:** 2-4 hours
**Monthly Cost:** $0-21 (can start free)

---

## DOMAIN & HOSTING

### Platform Chosen: Cloudflare Pages (Free Tier)

**Domain:**
- Status: NOT PURCHASED
- Recommendation: `nightfoxfilms.com`
- Where to buy: Namecheap or Cloudflare Registrar ($12-15/year)
- Cost: $12-15/year

**Hosting: Cloudflare Pages** ✅
- Status: PLATFORM CHOSEN (not yet deployed)
- Cost: $0/month (free tier)
- Features:
  - Unlimited bandwidth (no limits)
  - Unlimited sites
  - Automatic HTTPS/SSL
  - Global CDN (300+ edge locations)
  - Automatic deployments from GitHub
  - Custom domains (free)
  - Preview deployments for PRs
- See OPEN-SOURCE-STACK.md for setup

**SSL Certificate:**
- Status: NOT SET UP (but automatic with Cloudflare Pages)
- Cloudflare provides free SSL (automatic, no configuration)
- Enables HTTPS (required for security and SEO)

**DNS Configuration:**
- Status: NOT CONFIGURED
- Cloudflare Pages includes DNS management (free)
- Needed for: Email (MX records), Website (automatic with Cloudflare), Verification (TXT)

---

## ANALYTICS & TRACKING

### Platform Chosen: Umami (Self-Hosted, Open-Source)

**Analytics: Umami** ✅
- Status: PLATFORM CHOSEN (not yet deployed)
- Type: Self-hosted, privacy-focused analytics
- Cost: $0/month (deploy free on Vercel)
- License: MIT (open-source)
- Features:
  - GDPR compliant (no cookies, no tracking scripts)
  - Simple, beautiful dashboard
  - Real-time visitor tracking
  - Page views, referrers, devices, countries
  - Event tracking (form submissions, clicks)
- Alternative: Plausible (similar but has paid tier)
- See OPEN-SOURCE-STACK.md for setup

**Also Setting Up:**
1. **Google Search Console** - For SEO monitoring (free)
2. **Google Analytics 4** - Optional backup (if client wants it)
3. **Goal tracking** - Form submissions, contact clicks (Umami events)
4. **Facebook Pixel** - Optional (only if running ads)

### What's Set Up

**NOTHING.**

- No Google Analytics account
- No Search Console configured
- No tracking codes
- No conversion tracking
- No performance monitoring

### What Needs to Happen

**To implement analytics:**

1. **Create Google Analytics 4 account** (30 minutes)
   - Sign up at analytics.google.com
   - Create property for nightfoxfilms.com
   - Get tracking code
   - Install on website
   - Test tracking

2. **Set up Google Search Console** (30 minutes)
   - Sign up at search.google.com/search-console
   - Verify domain ownership
   - Submit sitemap
   - Monitor search performance

3. **Configure goal tracking** (1 hour)
   - Form submissions (contact, booking)
   - Button clicks (call, email)
   - Page views (pricing, services)
   - Conversion funnel

**Total setup time:** 2-3 hours
**Monthly cost:** $0 (all free tools)

---

## CLIENT MANAGEMENT

### What's Documented

**Systems planned:**
- Contract management: `contract-template-outline.md`
- Client questionnaire: `client-questionnaire-template.md`
- Consultation script: `consultation-call-script.md`
- Email templates: `email-templates.md`
- Pricing: `pricing-sheet-2025.md`

**Recommended platforms (from checklist):**
- HoneyBook ($16/month) - All-in-one client management
- Bonsai ($16/month) - Contracts + proposals + payments
- DocuSign/HelloSign - Just e-signatures
- Stripe/PayPal - Payment processing

### What's Set Up

**NOTHING.**

- No contract platform
- No e-signature capability
- No payment processing
- No client database
- No workflow automation

### What Needs to Happen

**To implement client management:**

1. **Choose platform** (HoneyBook recommended)
   - All-in-one: proposals, contracts, invoices, questionnaires
   - Cost: $16/month (annual billing)
   - Alternative: Bonsai (similar features, same price)

2. **Set up templates** (4-6 hours)
   - Import contract from `contract-template-outline.md`
   - Import questionnaire from `client-questionnaire-template.md`
   - Create proposal templates for each package
   - Set up invoice templates
   - Configure payment processing (Stripe)

3. **Create workflows** (2-3 hours)
   - Inquiry → Send proposal
   - Booked → Send contract
   - Signed → Send invoice for deposit
   - 60 days before → Send questionnaire
   - 30 days before → Timeline review
   - Delivery → Request testimonial

**Total setup time:** 6-9 hours
**Monthly cost:** $16-20

---

## AUTOMATION & SCRIPTS

### What Exists

**Created in 2025-11-18 overhaul:**

1. **validate-markdown.sh** ✅ FUNCTIONAL
   - Purpose: Check markdown files for broken links
   - Location: `scripts/validation/validate-markdown.sh`
   - Status: Working, can run now
   - Usage: `./scripts/validation/validate-markdown.sh`

2. **launch.sh** 🔧 TEMPLATE ONLY
   - Purpose: Deploy website (when it exists)
   - Location: `scripts/deployment/launch.sh`
   - Status: Template, needs website to deploy
   - Cannot run until website is built

3. **health-check.sh** 🔧 TEMPLATE ONLY
   - Purpose: Monitor live website
   - Location: `scripts/deployment/health-check.sh`
   - Status: Template, needs website URL
   - Cannot run until website is deployed

### What's Planned (from `lilbits.md`)

**Future scripts:**
- `check-todos.sh` - Extract TODO items from markdown
- `validate-pricing.sh` - Check pricing consistency
- `update-toc.sh` - Auto-generate table of contents
- `backup.sh` - Backup documentation
- `export-to-cms.sh` - Convert markdown to CMS format

**Status:** Documented but not created

---

## DEPLOYMENT PIPELINE

### What's Set Up

**NOTHING.**

- No CI/CD pipeline
- No automated testing
- No build process
- No deployment automation
- No staging environment

### What's Needed (If Custom Build)

**GitHub Actions workflow:**
```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to Vercel
        run: vercel deploy --prod
```

**Status:** Doesn't apply yet (no code to deploy)

**If Squarespace/WordPress:**
- No deployment pipeline needed
- Manual updates through CMS interface

---

## SUMMARY MATRIX

| Component | Documented | Implemented | Platform Chosen | Ready to Use |
|-----------|------------|-------------|-----------------|--------------|
| **Contact Forms** | ✅ Yes | ❌ No | ✅ Web3Forms | ❌ No |
| **Booking (Calendly)** | ✅ Yes | ❌ No | ✅ Cal.com | ❌ No |
| **Email Templates** | ✅ Yes (10) | ❌ No | ✅ Resend | ❌ No |
| **Lead Nurture** | ✅ Yes (5 emails) | ❌ No | ✅ Resend/Listmonk | ❌ No |
| **CMS** | ✅ Yes | ❌ No | ✅ Decap CMS | ❌ No |
| **Frontend** | ✅ Wireframes | ❌ No | ✅ Next.js 14 | ❌ No |
| **Hosting** | ✅ Options listed | ❌ No | ✅ Cloudflare Pages | ❌ No |
| **Domain** | ✅ Recommended | ❌ No | 🟡 TBD | ❌ No |
| **Analytics** | ✅ Planned | ❌ No | ✅ Umami | ❌ No |
| **Client Management** | ✅ Templates exist | ❌ No | 🟡 TBD | ❌ No |
| **Payment Processing** | ✅ Mentioned | ❌ No | 🟡 TBD | ❌ No |
| **Automation** | ✅ 1 script works | 🟡 Partial | N/A | 🟡 1 of 3 |

**Overall Status:** 0% implemented, 100% documented, PLATFORM DECIDED (Next.js + Open-Source Stack)

---

## CRITICAL PATH TO LAUNCH

**DECISION MADE: Next.js + Open-Source Stack** ✅

Everything is now unblocked and ready to implement.

### Chosen Platform: Next.js + Cloudflare Pages + Decap CMS

**Decision Date:** 2025-11-18

**Stack Summary:**
- Frontend: Next.js 14+ (App Router)
- Hosting: Cloudflare Pages (free tier)
- CMS: Decap CMS (git-based, open-source)
- Forms: Web3Forms (100% free)
- Booking: Cal.com (self-hosted, open-source)
- Analytics: Umami (self-hosted, privacy-focused)
- Email: Resend (free tier) → Listmonk (self-hosted)

**Total Cost:** $12/year (domain only)

**Why This Stack:**
- User requirement: "Free and open source"
- User requirement: "Breaking up with the corporate overlords"
- Zero vendor lock-in (everything open-source)
- Professional quality (same tools as Netflix, Uber)
- Complete control and ownership

**Full Implementation Guide:** See `OPEN-SOURCE-STACK.md` (600+ lines, step-by-step)

---

## WHAT TO DO NEXT

**Platform Decision MADE - Ready to Implement**

See `OPEN-SOURCE-STACK.md` for complete step-by-step implementation guide.

**Immediate (This Week):**

1. **Purchase domain** (15 minutes, $12-15)
   - Buy `nightfoxfilms.com`
   - Use Namecheap or Cloudflare Registrar
   - Don't configure yet (will set up with Cloudflare Pages)

2. **Set up development environment** (30 minutes)
   - Install Node.js 18+ and npm
   - Install Git (if not already installed)
   - Clone this repository locally
   - See OPEN-SOURCE-STACK.md "Prerequisites"

3. **Create Next.js project** (15 minutes)
   - Run: `npx create-next-app@latest nightfoxfilms-site`
   - Choose: App Router, TypeScript, Tailwind CSS
   - Initialize git repository
   - See OPEN-SOURCE-STACK.md "Step 1: Create Next.js Project"

**Week 1: Foundation**

4. **Deploy to Cloudflare Pages** (15 minutes)
   - Connect GitHub repository to Cloudflare Pages
   - Configure build settings (Next.js preset)
   - Get live preview URL
   - See OPEN-SOURCE-STACK.md "Step 2: Deploy to Cloudflare Pages"

5. **Set up Decap CMS** (20-30 minutes)
   - Create `public/admin/config.yml`
   - Configure collections (pages, services, blog, archive)
   - Enable GitHub OAuth authentication
   - Access admin at yourdomain.com/admin
   - See OPEN-SOURCE-STACK.md "Step 3: Configure Decap CMS"

6. **Build home page layout** (4-6 hours)
   - Create Next.js components for header, footer, hero
   - Use wireframes from `wireframes/home-page-wireframe.md`
   - Use copy from `copy/home-page-copy.md`
   - Deploy and test

**Week 2-3: Core Pages**

7. **Build service pages** (8-12 hours)
   - Super 8 Service page
   - Dad Cam Service page
   - About page
   - Use wireframes and copy from respective files

8. **Build contact and pricing pages** (4-6 hours)
   - Contact page with Web3Forms integration
   - Pricing page with Cal.com booking embed
   - FAQ page

**Week 4-5: Features**

9. **Set up all integrations** (4-6 hours)
   - Web3Forms for contact form
   - Cal.com for booking (deploy to Vercel/Railway)
   - Umami analytics (deploy to Vercel)
   - Cloudinary for images

**Week 6-8: Polish and Launch**

10. **SEO optimization** (3-4 hours)
    - Add metadata to all pages
    - Create sitemap.xml and robots.txt
    - Set up Google Search Console
    - Optimize images and performance

11. **Final testing and launch** (2-3 hours)
    - Test all forms and booking
    - Test on mobile devices
    - Connect custom domain
    - Go live

**Total Implementation Time:** 40-60 hours over 8 weeks

---

## FILES TO REFERENCE

**For platform decision (DECIDED):**
- `OPEN-SOURCE-STACK.md` - Complete implementation guide for Next.js + open-source stack (600+ lines)
- `claude.md` - Platform decision rationale and architecture overview
- `developer-guide.md` - General technical guidance (2,562 lines)
- `README.md` - Updated with platform decision

**For implementation:**
- `OPEN-SOURCE-STACK.md` - STEP-BY-STEP guide (start here)
- `MASTER-IMPLEMENTATION-CHECKLIST.md` - 87-task roadmap
- `QUICK-START-ACTION-PLAN.md` - 8-week sprint plan

**For content:**
- `wireframes/` - Page structures
- `copy/` - Page content
- `pricing-sheet-2025.md` - Pricing

**For client systems:**
- `email-templates.md` - 10 email templates
- `lead-nurture-email-sequence.md` - 5-email automation
- `contract-template-outline.md` - Contract
- `client-questionnaire-template.md` - Questionnaire

---

**Last Updated:** 2025-11-18
**Next Review:** After beginning implementation (Week 2-3)
**Status:** Platform decision MADE (Next.js + Open-Source Stack) - Ready to implement
**Implementation Guide:** See OPEN-SOURCE-STACK.md for complete step-by-step instructions
