# Open-Source Tech Stack - Nightfox Films

**Last Updated:** 2025-11-18
**Decision:** Custom Next.js + Free Open-Source Tools
**Philosophy:** Break free from corporate platforms, own your infrastructure
**Total Monthly Cost:** $0 (100% free tier)

---

## PLATFORM DECISION: OPEN-SOURCE STACK

**You chose:** Custom Next.js with free, open-source tools
**Why this rocks:** Complete ownership, zero vendor lock-in, no monthly fees

---

## THE COMPLETE FREE STACK

### Frontend: Next.js 14+ (Open-Source)

**Why Next.js:**
- ✅ Open-source (MIT license)
- ✅ Owned by Vercel but code is free
- ✅ Best-in-class React framework
- ✅ Amazing performance (SSG + SSR)
- ✅ Built-in image optimization
- ✅ Huge community, excellent docs

**Version:** Next.js 14+ with App Router
**License:** MIT
**Cost:** $0 (open-source)

---

### Hosting: Cloudflare Pages (Free Tier)

**Why Cloudflare Pages:**
- ✅ 100% FREE (unlimited bandwidth!)
- ✅ Global CDN included
- ✅ Automatic HTTPS/SSL
- ✅ Git integration (auto-deploy on push)
- ✅ Edge functions (serverless at the edge)
- ✅ No corporate overlords vibes (compared to Vercel)

**Free tier limits:**
- Unlimited sites
- Unlimited requests
- Unlimited bandwidth
- 500 builds/month (more than enough)

**Alternative:** Vercel (also free tier, but owned by VC-backed company)
**Alternative:** Netlify (free tier, open-source friendly)

**Recommendation:** Cloudflare Pages for maximum free-ness and edge performance

---

### CMS: Decap CMS (Formerly Netlify CMS) - 100% Free & Open-Source

**Why Decap CMS:**
- ✅ 100% open-source (MIT license)
- ✅ Git-based (content stored as markdown in your repo)
- ✅ No database needed
- ✅ No monthly fees EVER
- ✅ You own all content (in your repo)
- ✅ Works with any static site generator

**How it works:**
1. Admin interface at `/admin`
2. Edit content in browser
3. Saves as markdown files to Git
4. Triggers rebuild automatically
5. New content appears on site

**Alternative CMS options:**

**Tina CMS** (Open-source, great DX)
- Free tier: 2 users
- Git-based like Decap
- Better editing UX
- Backed by company but code is open

**Payload CMS** (Open-source, self-hosted)
- Fully open-source
- More powerful (Node.js based)
- Requires database (PostgreSQL)
- Slightly more complex

**Strapi** (Open-source headless CMS)
- Very popular
- Self-hosted (need to run it somewhere)
- More enterprise features
- Requires database

**Recommendation:** Start with Decap CMS (simplest, 100% free, no database)

---

### Forms: Formspree (Free Tier) or Web3Forms (100% Free)

**Option 1: Web3Forms (BEST - 100% FREE)**
- ✅ Completely free forever
- ✅ No limits on submissions
- ✅ Open-source friendly
- ✅ Spam protection included
- ✅ File uploads supported
- ❌ Fewer features than paid options

**Option 2: Formspree (Freemium)**
- Free tier: 50 submissions/month
- $10/month for 1,000/month
- Great UX, well-maintained

**Option 3: Build your own (100% free)**
- Use Cloudflare Workers (free tier)
- Send emails via Resend (100 emails/day free)
- Full control, no limits

**Recommendation:** Web3Forms for simplicity, or build your own for zero dependencies

---

### Email Marketing: Listmonk (Self-Hosted, Open-Source)

**Why Listmonk:**
- ✅ 100% open-source (AGPL)
- ✅ Self-hosted (no monthly fees)
- ✅ Unlimited subscribers
- ✅ Unlimited emails
- ✅ Beautiful UI
- ✅ All features included

**Where to host:**
- DigitalOcean droplet ($6/month for smallest)
- Railway.app (free tier, then usage-based)
- Fly.io (free tier available)

**Cost:** $0-6/month depending on hosting choice

**Alternative:** Sendy (one-time $69, self-hosted, uses Amazon SES)
**Alternative:** Mailtrain (open-source, similar to Listmonk)

**For now:** Use Mailchimp free tier (500 contacts) until you outgrow it, then migrate to Listmonk

---

### Email Sending (Transactional): Resend (Free Tier)

**Why Resend:**
- Free tier: 100 emails/day, 3,000/month
- Simple API (built for developers)
- Open-source SDK
- No corporate nonsense

**Alternative:** Plunk (open-source email API)
**Alternative:** Amazon SES (very cheap, $0.10 per 1,000 emails)

**For contact forms:**
- Use Cloudflare Workers + Resend
- Or Web3Forms (they handle it)

---

### Booking: Cal.com (Open-Source Calendly Alternative)

**Why Cal.com:**
- ✅ 100% open-source (AGPLv3)
- ✅ Free tier available
- ✅ Self-hosting option (100% free)
- ✅ Same features as Calendly
- ✅ Beautiful UX

**Free tier:**
- Unlimited event types
- Unlimited bookings
- All core features
- Cal.com branding (can remove with self-hosting)

**Self-hosting cost:** $0 (host on Railway/Fly.io free tier)

**Alternative:** Just use Cal.com free tier (easiest)
**Alternative:** Self-host for complete control

---

### Analytics: Plausible (Open-Source) or Umami (Self-Hosted)

**Option 1: Plausible Cloud**
- NOT free ($9/month for 10k pageviews)
- But open-source code
- Privacy-focused
- Beautiful UX

**Option 2: Plausible Self-Hosted (FREE)**
- ✅ 100% open-source (AGPL)
- ✅ Host on Railway/Fly.io
- ✅ Same features as cloud version
- Cost: $0-5/month for hosting

**Option 3: Umami (FREE, Self-Hosted)**
- ✅ 100% open-source (MIT)
- ✅ Self-host on Vercel (free tier!)
- ✅ Simple, fast, privacy-focused
- ✅ Easiest to set up

**Recommendation:** Umami self-hosted on Vercel (completely free)

**For now:** Use Google Analytics 4 (free, you already know it), migrate to Umami later

---

### Images: Cloudinary (Free Tier) or Uploadthing (Open-Source)

**Option 1: Cloudinary Free Tier**
- 25 GB storage
- 25 GB bandwidth/month
- Image transformations included
- Good enough for starting out

**Option 2: Uploadthing**
- Open-source file upload for Next.js
- 2GB storage free
- Built by Theo (t3.gg)
- Very developer-friendly

**Option 3: Self-host with R2**
- Cloudflare R2 storage (free tier: 10GB)
- Use Next.js Image component
- Most control, cheapest long-term

**Recommendation:** Cloudinary free tier to start, migrate to R2 when you need more

---

### Database (If Needed): PostgreSQL on Supabase (Free Tier)

**Why Supabase:**
- ✅ Open-source (can self-host)
- ✅ PostgreSQL database
- ✅ Free tier: 500MB database
- ✅ Auth built-in (if needed later)
- ✅ Realtime subscriptions
- ✅ Auto-generated APIs

**Free tier:**
- 500MB database
- 5GB file storage
- Unlimited API requests
- 50k monthly active users

**Alternative:** PlanetScale (free tier, MySQL)
**Alternative:** Railway PostgreSQL (free tier)
**Alternative:** Neon (serverless Postgres, free tier)

**For this project:** Probably don't need database (static site with Decap CMS uses Git)

---

### Payment Processing: Stripe (Free to Start)

**Why Stripe:**
- No monthly fee
- Pay per transaction (2.9% + 30¢)
- Industry standard
- Excellent docs

**Open-source alternative:** None good enough
**Recommendation:** Just use Stripe (everyone does)

---

## THE COMPLETE STACK SUMMARY

| Component | Tool | Cost | License |
|-----------|------|------|---------|
| **Frontend** | Next.js 14 | $0 | MIT (Open-Source) |
| **Hosting** | Cloudflare Pages | $0 | N/A (Free Service) |
| **CMS** | Decap CMS | $0 | MIT (Open-Source) |
| **Forms** | Web3Forms | $0 | Proprietary but free |
| **Booking** | Cal.com | $0 | AGPL (Open-Source) |
| **Analytics** | Umami (self-hosted) | $0 | MIT (Open-Source) |
| **Email (transactional)** | Resend | $0* | N/A (*100/day free) |
| **Email (marketing)** | Mailchimp → Listmonk | $0** | **Move to Listmonk later |
| **Images** | Cloudinary | $0* | N/A (*25GB free) |
| **Domain** | Namecheap | $12/year | N/A |

**Total monthly cost:** $0
**Total annual cost:** $12 (just domain)

**When you outgrow free tiers:**
- Cloudflare Pages: Stay free (unlimited)
- Resend: $20/month for 50k emails
- Cal.com: Self-host for free
- Umami: Already free (self-hosted)
- Listmonk: Self-host ($6/month hosting)

---

## TECH STACK ARCHITECTURE

```
┌─────────────────────────────────────────────────────────┐
│                     USERS / VISITORS                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│          Cloudflare Pages (CDN + Hosting)                │
│                    - Free Tier -                         │
│        Global edge network, HTTPS, infinite scale        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│              Next.js 14 Application                      │
│                 (Open-Source)                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Pages (SSG):                                     │  │
│  │  - Home, Services, About, Pricing, FAQ           │  │
│  │  - Blog posts (from markdown)                     │  │
│  │  - Archive posts (from markdown)                  │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Components:                                      │  │
│  │  - Contact form → Web3Forms/Cloudflare Worker    │  │
│  │  - Cal.com embed (booking)                        │  │
│  │  - Analytics (Umami script)                       │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│                 Content Management                       │
│                                                          │
│  Decap CMS (/admin) → Edits Markdown → Git Repo        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  On save: Commit to GitHub → Trigger rebuild     │  │
│  │  Cloudflare Pages auto-deploys new version       │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

CONTENT FLOW:
1. You edit content in Decap CMS at /admin
2. Decap saves markdown to GitHub repo
3. GitHub webhook triggers Cloudflare Pages build
4. Next.js builds static pages from markdown
5. New site deployed to Cloudflare edge globally
6. Visitors see updated content (static, fast)
```

---

## WHY THIS STACK (Applying THE RULES)

### KISS (Keep It Simple)
- **Simpler than WordPress:** No database, no PHP, no security patches
- **Simpler than custom backend:** Static site, no server management
- **Git as database:** Just markdown files, easy to understand

### FAANG PE (Enterprise Quality)
- **Next.js:** Used by Netflix, Nike, TikTok, Notion
- **Cloudflare:** Powers millions of sites, bulletproof CDN
- **PostgreSQL:** (if needed) Enterprise-grade database

### BPL (Bulletproof Long-Term)
- **All open-source:** If any company dies, code lives on
- **Git-based content:** Your content is portable markdown files
- **No vendor lock-in:** Can migrate to different hosting anytime
- **Will work in 10 years:** Static HTML works forever

### BPA (Best Practices)
- **JAMstack architecture:** Industry standard for modern sites
- **Static site generation:** Fastest, most secure approach
- **Git-based workflow:** Modern development practice

### NME (No Emojis)
- All professional, no corporate fluff

### WWYDD (What Would You Do Differently)
**This IS what I'd do differently.** Breaking free from:
- ❌ Squarespace: $276/year forever
- ❌ WordPress: Slow, security hell, bloated
- ❌ Corporate CMS platforms: Lock-in, price increases

✅ **Open-source everything:** Own your stack

### DRETW (Don't Re-Invent The Wheel)
- Using proven Next.js (not building framework)
- Using Decap CMS (not building CMS)
- Using Cal.com (not building booking system)
- All battle-tested open-source tools

### LILBITS (Modular)
- Each tool does one thing well
- Can swap any component independently
- No monolithic dependency

---

## IMPLEMENTATION TIMELINE

### Week 1: Setup & First Page
- Day 1: Create Next.js project, push to GitHub
- Day 2: Connect to Cloudflare Pages
- Day 3: Build home page component
- Day 4: Set up Decap CMS
- Day 5: Test content editing workflow

### Week 2-3: Core Pages
- Build all service pages
- Add markdown content from wireframes/copy directories
- Set up image optimization

### Week 4: Features
- Add contact form (Web3Forms or Cloudflare Worker)
- Embed Cal.com booking
- Set up Umami analytics

### Week 5-6: Content & SEO
- Import all blog/archive posts
- Implement SEO (meta tags, sitemaps, schema)
- Test performance (should be 90+ on PageSpeed)

### Week 7-8: Polish & Launch
- Final testing
- Set up domain
- Launch publicly

**Total: 8 weeks** (same as Squarespace, but you own everything)

---

## PREREQUISITES

**Before you start, you need:**

1. **Node.js 18+** - JavaScript runtime
2. **npm 9+** - Package manager (comes with Node.js)
3. **Git** - Version control
4. **Text editor** - VS Code recommended
5. **GitHub account** - For code hosting and CMS OAuth
6. **Terminal/command line** - Basic familiarity

**Not sure if you have these?**

See `LOCAL-DEVELOPMENT.md` for complete setup instructions including:
- How to install Node.js, npm, and Git
- Environment variables configuration
- Local CMS workflow (critical for development)
- Common errors and troubleshooting
- VS Code setup and extensions

**Quick check:**
```bash
node --version  # Should be v18.x.x or v20.x.x
npm --version   # Should be 9.x.x or higher
git --version   # Any recent version
```

If these commands work, you're ready. If not, read `LOCAL-DEVELOPMENT.md` first.

---

## GETTING STARTED (Step-by-Step)

**IMPORTANT:** These steps are for deployment. For local development setup, see `LOCAL-DEVELOPMENT.md`.

### Step 1: Create Next.js Project (15 minutes)

```bash
# Create new Next.js 14 app
npx create-next-app@latest nightfoxfilms-website

# Options:
# ✓ TypeScript: Yes
# ✓ ESLint: Yes
# ✓ Tailwind CSS: Yes
# ✓ `src/` directory: Yes
# ✓ App Router: Yes
# ✓ Customize default import alias: No

cd nightfoxfilms-website
npm run dev
```

**Test:** Open http://localhost:3000

### Step 2: Push to GitHub (5 minutes)

```bash
git init
git add .
git commit -m "Initial commit: Next.js setup"

# Create repo on GitHub (github.com/new)
# Name: nightfoxfilms-website

git remote add origin git@github.com:yourusername/nightfoxfilms-website.git
git push -u origin main
```

### Step 3: Deploy to Cloudflare Pages (10 minutes)

1. Go to https://pages.cloudflare.com
2. Click "Create a project"
3. Connect your GitHub account
4. Select `nightfoxfilms-website` repo
5. Build settings:
   - Framework preset: Next.js
   - Build command: `npx @cloudflare/next-on-pages@1`
   - Build output directory: `.vercel/output/static`
6. Click "Save and Deploy"

**Result:** Your site is live at `nightfoxfilms-website.pages.dev`

### Step 4: Set Up Decap CMS (30 minutes)

```bash
# Install Decap CMS
npm install netlify-cms-app

# Create public/admin directory
mkdir -p public/admin

# Create public/admin/index.html
# (Full config provided in next section)

# Create public/admin/config.yml
# (CMS configuration for your content)
```

### Step 5: Configure Domain (15 minutes)

1. Purchase domain at Namecheap: `nightfoxfilms.com` ($12/year)
2. In Cloudflare Pages dashboard:
   - Go to Custom Domains
   - Add `nightfoxfilms.com`
   - Add `www.nightfoxfilms.com`
3. Update Namecheap DNS:
   - Point to Cloudflare nameservers
   - Or add CNAME records

**Result:** Site live at https://nightfoxfilms.com

---

## DECAP CMS CONFIGURATION

**File:** `public/admin/config.yml`

```yaml
backend:
  name: github
  repo: yourusername/nightfoxfilms-website
  branch: main

media_folder: "public/images"
public_folder: "/images"

collections:
  - name: "pages"
    label: "Pages"
    files:
      - label: "Home Page"
        name: "home"
        file: "content/pages/home.md"
        fields:
          - {label: "Title", name: "title", widget: "string"}
          - {label: "Hero Heading", name: "hero_heading", widget: "string"}
          - {label: "Hero Text", name: "hero_text", widget: "text"}
          - {label: "Body", name: "body", widget: "markdown"}

      - label: "About Page"
        name: "about"
        file: "content/pages/about.md"
        fields:
          - {label: "Title", name: "title", widget: "string"}
          - {label: "Body", name: "body", widget: "markdown"}

  - name: "services"
    label: "Services"
    folder: "content/services"
    create: true
    fields:
      - {label: "Title", name: "title", widget: "string"}
      - {label: "Price", name: "price", widget: "string"}
      - {label: "Description", name: "description", widget: "text"}
      - {label: "Body", name: "body", widget: "markdown"}

  - name: "blog"
    label: "Blog Posts"
    folder: "content/blog"
    create: true
    slug: "{{year}}-{{month}}-{{day}}-{{slug}}"
    fields:
      - {label: "Title", name: "title", widget: "string"}
      - {label: "Date", name: "date", widget: "datetime"}
      - {label: "Featured Image", name: "image", widget: "image"}
      - {label: "Body", name: "body", widget: "markdown"}

  - name: "archive"
    label: "Wedding Archive"
    folder: "content/archive"
    create: true
    slug: "{{slug}}"
    fields:
      - {label: "Couple Names", name: "title", widget: "string"}
      - {label: "Date", name: "date", widget: "datetime"}
      - {label: "Location", name: "location", widget: "string"}
      - {label: "Medium", name: "medium", widget: "select", options: ["Super 8", "Dad Cam", "Modern Digital", "Mixed Media"]}
      - {label: "Video URL", name: "video_url", widget: "string"}
      - {label: "Featured Image", name: "image", widget: "image"}
      - {label: "Testimonial", name: "testimonial", widget: "text"}
      - {label: "Body", name: "body", widget: "markdown"}
```

**Access CMS:** https://nightfoxfilms.com/admin

---

## NEXT STEPS

1. **This week:** Make platform decision ✅ (DONE - Next.js + Cloudflare)
2. **Next week:** Set up Next.js project, deploy to Cloudflare Pages
3. **Week 2-3:** Build pages using content from this repo
4. **Week 4:** Add forms, Cal.com, analytics
5. **Week 6-8:** Content, SEO, launch

**Read next:**
- `developer-guide.md` (2,562 lines) - Still relevant for Next.js guidance
- `MASTER-IMPLEMENTATION-CHECKLIST.md` - 87-task roadmap (still applies)

---

## MONTHLY COST BREAKDOWN

**Free tier (starting out):**
- Hosting (Cloudflare Pages): $0
- CMS (Decap): $0
- Forms (Web3Forms): $0
- Booking (Cal.com free tier): $0
- Analytics (Umami self-hosted): $0
- Email sending (Resend): $0 (up to 3k/month)
- Email marketing (Mailchimp): $0 (up to 500 contacts)
- Domain: $1/month ($12/year)

**Total: $1/month**

**When you scale:**
- Cloudflare Pages: Still $0 (unlimited!)
- Resend: $20/month (for 50k emails)
- Cal.com: Self-host for $0
- Listmonk: $6/month (DigitalOcean hosting)

**At scale: $26/month** (vs $276/year for Squarespace + all fees)

---

## WHY THIS IS BETTER THAN CORPORATE PLATFORMS

**vs. Squarespace:**
- ❌ Squarespace: $23/month ($276/year)
- ✅ This stack: $1/month ($12/year)
- ✅ You own everything
- ✅ Faster performance
- ✅ No arbitrary limits

**vs. WordPress:**
- ❌ WordPress: Slow, security hell, constant updates
- ✅ Static site: No security issues, no updates needed
- ✅ 10x faster page loads

**vs. Wix/Webflow:**
- ❌ Vendor lock-in
- ❌ Can't export content easily
- ✅ Your content is just markdown in Git (portable forever)

---

## RESOURCES

**Next.js:**
- Docs: https://nextjs.org/docs
- Learn: https://nextjs.org/learn

**Cloudflare Pages:**
- Docs: https://developers.cloudflare.com/pages

**Decap CMS:**
- Docs: https://decapcms.org/docs

**Cal.com:**
- Docs: https://cal.com/docs

**Open-Source Alternatives:**
- Awesome Selfhosted: https://github.com/awesome-selfhosted/awesome-selfhosted
- Open Source Alternatives: https://www.opensourcealternative.to

---

**Last Updated:** 2025-11-18
**Status:** READY TO IMPLEMENT
**Decision:** ✅ Custom Next.js + Open-Source Tools
**Timeline:** 8 weeks to launch
**Cost:** $12/year (just domain)
