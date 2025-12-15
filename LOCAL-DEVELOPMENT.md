# Local Development Guide - Nightfox Films

**Last Updated:** 2025-11-18
**Purpose:** Complete guide for running Next.js site locally on your machine
**Prerequisites:** Read OPEN-SOURCE-STACK.md first for architecture overview

---

## Quick Start (5 Minutes)

```bash
# 1. Check prerequisites
node --version   # Must be 18.0.0 or higher
npm --version    # Must be 9.0.0 or higher
git --version    # Any recent version

# 2. Create Next.js project
npx create-next-app@latest nightfoxfilms-site
# Choose: TypeScript YES, Tailwind YES, App Router YES

# 3. Start development server
cd nightfoxfilms-site
npm run dev

# 4. Open browser
# Visit: http://localhost:3000
```

If this works, you're ready to build. Read the rest for production features.

---

## Prerequisites (What You Need Installed)

### Required Software

**Node.js 18+ (LTS recommended)**
```bash
# Check version
node --version
# Should output: v18.x.x or v20.x.x

# If not installed:
# macOS: brew install node
# Windows: Download from https://nodejs.org
# Linux: Use nvm (Node Version Manager)
```

**npm (comes with Node.js)**
```bash
# Check version
npm --version
# Should output: 9.x.x or higher

# Update if needed
npm install -g npm@latest
```

**Git**
```bash
# Check version
git --version
# Should output: git version 2.x.x

# If not installed:
# macOS: brew install git
# Windows: Download from https://git-scm.com
# Linux: sudo apt-get install git
```

**Text Editor (Choose One)**
- VS Code (recommended): https://code.visualstudio.com
- Cursor: https://cursor.sh
- WebStorm: https://www.jetbrains.com/webstorm
- Sublime Text: https://www.sublimetext.com

### Recommended VS Code Extensions

If using VS Code, install these:
```
- ESLint (dbaeumer.vscode-eslint)
- Tailwind CSS IntelliSense (bradlc.vscode-tailwindcss)
- Prettier (esbenp.prettier-vscode)
- TypeScript (built-in)
```

---

## Step 1: Create Next.js Project

### Initialize Project

```bash
# Navigate to where you keep projects
cd ~/Projects  # or wherever you want

# Create new Next.js app
npx create-next-app@latest nightfoxfilms-site

# Answer prompts:
# ✓ TypeScript: Yes
# ✓ ESLint: Yes
# ✓ Tailwind CSS: Yes
# ✓ `src/` directory: Yes (recommended for organization)
# ✓ App Router: Yes (required for our stack)
# ✓ Customize default import alias: No

# Navigate into project
cd nightfoxfilms-site
```

### Verify Installation

```bash
# Check package.json exists
cat package.json

# Should see:
# - next: ^14.x.x or ^15.x.x
# - react: ^18.x.x
# - typescript: ^5.x.x
# - tailwindcss: ^3.x.x
```

### Start Development Server

```bash
npm run dev
```

**Expected output:**
```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
  - Network:      http://192.168.x.x:3000

 ✓ Ready in 2.3s
```

**Open browser:** http://localhost:3000

You should see the default Next.js welcome page.

**To stop server:** Press Ctrl+C in terminal

---

## Step 2: Environment Variables Setup

### Understanding Environment Variables

Environment variables store sensitive information (API keys, secrets) that should NOT be committed to Git.

### Create .env.local File

```bash
# In project root (nightfoxfilms-site/)
touch .env.local
```

**Add to .env.local:**

```bash
# ==========================================
# LOCAL DEVELOPMENT ENVIRONMENT VARIABLES
# ==========================================
# NEVER commit this file to Git
# Copy .env.example to .env.local and fill in values

# ------------------------------------------
# NODE ENVIRONMENT
# ------------------------------------------
NODE_ENV=development

# ------------------------------------------
# WEB3FORMS (Contact Form)
# ------------------------------------------
# Get your free access key: https://web3forms.com
NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=your-key-here

# ------------------------------------------
# CLOUDINARY (Image Hosting)
# ------------------------------------------
# Sign up: https://cloudinary.com
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# ------------------------------------------
# RESEND (Email Sending)
# ------------------------------------------
# Sign up: https://resend.com
RESEND_API_KEY=re_your-key-here

# ------------------------------------------
# UMAMI ANALYTICS (Optional - only needed after deployment)
# ------------------------------------------
# Deploy Umami first, then add tracking ID
NEXT_PUBLIC_UMAMI_WEBSITE_ID=your-website-id
NEXT_PUBLIC_UMAMI_URL=https://umami.yourdomain.com

# ------------------------------------------
# CAL.COM (Booking - Optional - only needed after Cal.com setup)
# ------------------------------------------
# Deploy Cal.com, then add your booking URL
NEXT_PUBLIC_CALCOM_USERNAME=yourname

# ------------------------------------------
# GITHUB (For Decap CMS OAuth)
# ------------------------------------------
# Only needed for production CMS admin
# Create OAuth app: https://github.com/settings/developers
# GITHUB_CLIENT_ID=your-client-id
# GITHUB_CLIENT_SECRET=your-client-secret
```

### Create .env.example (Safe to Commit)

```bash
# Create example file for others
touch .env.example
```

**Add to .env.example:**

```bash
# Copy this file to .env.local and fill in your values
NODE_ENV=development
NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
RESEND_API_KEY=
NEXT_PUBLIC_UMAMI_WEBSITE_ID=
NEXT_PUBLIC_UMAMI_URL=
NEXT_PUBLIC_CALCOM_USERNAME=
```

### Update .gitignore

Verify `.gitignore` includes:

```bash
# Check .gitignore
cat .gitignore | grep .env
```

Should show:
```
.env*.local
.env.local
```

If not, add it:
```bash
echo ".env*.local" >> .gitignore
```

---

## Step 3: Local CMS Workflow (CRITICAL)

### The Decap CMS Local Problem

**IMPORTANT:** Decap CMS admin interface (`/admin`) will NOT work on localhost without extra setup.

**Why:** Decap CMS requires GitHub OAuth authentication, which only works on deployed sites (not localhost).

### Solution: Three Options

#### Option 1: Edit Markdown Files Directly (Recommended for Local Dev)

**Best for:** Development and content creation

**How it works:**
1. Content lives in `content/` directory as markdown files
2. Edit files directly in your text editor (VS Code)
3. Next.js reads markdown files and renders them
4. No CMS admin interface needed locally

**Setup:**
```bash
# Create content directory structure
mkdir -p content/pages
mkdir -p content/services
mkdir -p content/blog
mkdir -p content/archive

# Create sample content file
cat > content/pages/home.md << 'EOF'
---
title: "Home"
slug: "/"
description: "Analog wedding videography in Upstate NY"
---

# Welcome to Nightfox Films

Super 8 film and VHS wedding videography.
EOF
```

**Editing workflow:**
1. Open project in VS Code
2. Navigate to `content/pages/home.md`
3. Edit markdown content
4. Save file
5. Refresh browser - changes appear immediately

#### Option 2: Use Decap Server (Local CMS Backend)

**Best for:** Testing CMS workflow locally

**How it works:**
- Runs local proxy server for Decap CMS
- No GitHub OAuth needed
- Can use CMS admin interface at `localhost:3000/admin`

**Setup:**
```bash
# Install decap-server globally
npm install -g decap-server

# Start decap server (in separate terminal)
npx decap-server

# Output:
# Decap Server listening on port 8081
```

**In your Next.js config:**
```javascript
// public/admin/config.yml
backend:
  name: proxy
  proxy_url: http://localhost:8081/api/v1
  branch: main  # or master
```

**To use:**
1. Start decap-server: `npx decap-server` (terminal 1)
2. Start Next.js: `npm run dev` (terminal 2)
3. Visit: `http://localhost:3000/admin`
4. Login with any credentials (local proxy ignores auth)

#### Option 3: Test Mode (No Git Integration)

**Best for:** Quick CMS UI testing

**Setup:**
```javascript
// public/admin/config.yml
backend:
  name: test-repo
```

**Limitation:** Changes are NOT saved to files, only exists in memory

---

## Step 4: Content Structure

### Create Content Directory

```bash
# In project root
mkdir -p content/{pages,services,blog,archive}

# Create sample files
touch content/pages/home.md
touch content/services/super-8.md
touch content/blog/first-post.md
```

### Copy Content from Documentation Repo

```bash
# Navigate to nightfoxfilms (documentation repo)
cd ~/Projects/nightfoxfilms

# Copy wireframe content to Next.js project
cp copy/home-page-copy.md ~/Projects/nightfoxfilms-site/content/pages/home.md
cp copy/super-8-page-copy.md ~/Projects/nightfoxfilms-site/content/services/super-8.md
cp copy/dad-cam-page-copy.md ~/Projects/nightfoxfilms-site/content/services/dad-cam.md

# Copy all archive posts
cp -r sample-archive-posts/* ~/Projects/nightfoxfilms-site/content/archive/
```

### Content File Format

**Example: content/pages/home.md**
```markdown
---
title: "Home"
slug: "/"
description: "Super 8 and VHS wedding videography in Upstate NY"
image: "/images/hero.jpg"
---

# Nightfox Films

Analog wedding videography for couples who want something different.

## Services

- Super 8 Film Wedding Videos
- Dad Cam VHS Experience
- Archive-Quality Film Processing
```

**Frontmatter fields:**
- `title`: Page title (used in <title> tag)
- `slug`: URL path
- `description`: Meta description for SEO
- `image`: Featured image path

**Body:** Markdown content below `---`

---

## Step 5: Install Dependencies

### Core Dependencies

```bash
# Install markdown processing
npm install gray-matter remark remark-html

# Install UI components (optional but recommended)
npm install @radix-ui/react-icons class-variance-authority clsx tailwind-merge

# Install form handling
npm install react-hook-form @hookform/resolvers zod
```

### Development Dependencies

```bash
# Install TypeScript types
npm install -D @types/node @types/react @types/react-dom
```

---

## Step 6: Local Development Workflow

### Daily Workflow

```bash
# Morning: Start development server
cd ~/Projects/nightfoxfilms-site
npm run dev

# Work on features
# - Edit files in src/app/ for pages/components
# - Edit files in content/ for content
# - Save and auto-refresh shows changes

# Evening: Commit changes
git add .
git commit -m "Add home page component"
git push
```

### Project Structure

```
nightfoxfilms-site/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout
│   │   ├── page.tsx            # Home page (/)
│   │   ├── services/
│   │   │   └── page.tsx        # Services page
│   │   └── contact/
│   │       └── page.tsx        # Contact page
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── Footer.tsx
│   │   └── ContactForm.tsx
│   └── lib/
│       ├── markdown.ts         # Markdown utilities
│       └── utils.ts
├── content/
│   ├── pages/
│   ├── services/
│   ├── blog/
│   └── archive/
├── public/
│   ├── images/
│   ├── videos/
│   └── admin/                  # Decap CMS config
├── .env.local                  # Environment variables (NOT in Git)
├── .env.example                # Example env vars (safe to commit)
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Step 7: Testing Features Locally

### Contact Form (Web3Forms)

**Without API key (development):**
```typescript
// src/components/ContactForm.tsx
const handleSubmit = async (data: FormData) => {
  if (process.env.NODE_ENV === 'development') {
    // Log to console instead of sending
    console.log('Form submitted:', data);
    alert('Form submitted (dev mode - check console)');
    return;
  }

  // Production: Send to Web3Forms
  const response = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_key: process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY,
      ...data
    })
  });
};
```

**With API key (real testing):**
1. Sign up at https://web3forms.com (free)
2. Get access key
3. Add to `.env.local`: `NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY=your-key`
4. Forms will submit for real (check your email)

### Images (Cloudinary)

**Without Cloudinary (development):**
```typescript
// Use local images in public/ folder
<Image
  src="/images/hero.jpg"  // Local file
  alt="Hero"
  width={1920}
  height={1080}
/>
```

**With Cloudinary (production-like):**
```typescript
// Use Cloudinary URLs
<Image
  src={`https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/v1234567890/hero.jpg`}
  alt="Hero"
  width={1920}
  height={1080}
/>
```

### Analytics (Umami)

**Development mode:**
```typescript
// Skip analytics in development
if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID) {
  // Load Umami script
}
```

**Testing analytics:**
- Deploy to Cloudflare Pages first
- Set up Umami instance
- Add tracking script only in production

### Cal.com Booking

**Development:**
```typescript
// Use iframe with test Cal.com account
<iframe
  src={`https://cal.com/${process.env.NEXT_PUBLIC_CALCOM_USERNAME || 'demo'}`}
  width="100%"
  height="800px"
/>
```

---

## Step 8: Common Errors and Fixes

### Error: "Port 3000 already in use"

**Problem:** Another process is using port 3000

**Fix:**
```bash
# Option 1: Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Option 2: Use different port
npm run dev -- -p 3001
# Open: http://localhost:3001
```

### Error: "Module not found"

**Problem:** Missing dependency

**Fix:**
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Error: TypeScript errors on first run

**Problem:** New Next.js project has strict TypeScript

**Fix:**
```typescript
// tsconfig.json - Temporarily relax rules
{
  "compilerOptions": {
    "strict": false,  // Change from true
    "noImplicitAny": false  // Add this
  }
}
```

**Better fix:** Fix TypeScript errors properly (learn as you go)

### Error: "Image optimization error"

**Problem:** Next.js can't optimize external images

**Fix:**
```javascript
// next.config.js
module.exports = {
  images: {
    domains: ['res.cloudinary.com'], // Add external domains
    unoptimized: true, // Or disable optimization (dev only)
  },
}
```

### Error: "Failed to compile"

**Problem:** Syntax error in code

**Fix:**
1. Read error message (shows file and line number)
2. Open file in editor
3. Fix syntax error
4. Save file - Next.js auto-recompiles

### Error: Changes not appearing

**Problem:** Browser cache or Next.js cache

**Fix:**
```bash
# Hard refresh browser
# Mac: Cmd+Shift+R
# Windows: Ctrl+Shift+R

# Clear Next.js cache
rm -rf .next
npm run dev
```

---

## Step 9: Git Setup (Local)

### Initialize Git Repository

```bash
# In project root
git init
git add .
git commit -m "Initial commit: Next.js setup"
```

### Create GitHub Repository

```bash
# Option 1: Use GitHub CLI
gh repo create nightfoxfilms-site --private --source=. --remote=origin
git push -u origin main

# Option 2: Manual
# 1. Go to github.com/new
# 2. Name: nightfoxfilms-site
# 3. Private
# 4. Don't initialize with README
# 5. Copy git remote command shown
git remote add origin git@github.com:yourusername/nightfoxfilms-site.git
git push -u origin main
```

### Commit Workflow

```bash
# After making changes
git status  # See what changed
git add .   # Stage all changes
git commit -m "Add contact form component"
git push    # Push to GitHub
```

---

## Step 10: VS Code Setup

### Recommended Settings

Create `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.experimental.classRegex": [
    ["cva\\(([^)]*)\\)", "[\"'`]([^\"'`]*).*?[\"'`]"],
    ["cn\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ]
}
```

### Snippets for Faster Development

Create `.vscode/nextjs.code-snippets`:

```json
{
  "Next.js Page Component": {
    "prefix": "nxpage",
    "body": [
      "export default function ${1:Page}() {",
      "  return (",
      "    <div>",
      "      <h1>${2:Title}</h1>",
      "      $0",
      "    </div>",
      "  );",
      "}"
    ]
  },
  "Next.js API Route": {
    "prefix": "nxapi",
    "body": [
      "import { NextRequest, NextResponse } from 'next/server';",
      "",
      "export async function GET(request: NextRequest) {",
      "  return NextResponse.json({ message: 'Hello' });",
      "}"
    ]
  }
}
```

---

## Step 11: Performance Tips

### Fast Refresh

Next.js supports Fast Refresh (hot module replacement):
- Save file = instant update (no full reload)
- Preserves component state
- Shows error overlay if syntax error

### Build for Production Locally

```bash
# Test production build
npm run build

# Output shows:
# - Page sizes
# - Static vs dynamic routes
# - Performance warnings

# Run production build locally
npm run start
# Opens on http://localhost:3000 (production mode)
```

### Optimize Development

```javascript
// next.config.js
module.exports = {
  // Faster builds in development
  experimental: {
    optimizeCss: false, // Disable in dev
    optimizePackageImports: ['@radix-ui/react-icons'],
  },
  // Don't minify in dev
  swcMinify: false,
}
```

---

## Step 12: Debugging

### Console Logging

```typescript
// In components
console.log('Component rendered:', { props });

// In API routes
console.log('Request received:', request.url);

// In server components
console.log('Data fetched:', data); // Shows in terminal, not browser
```

### React DevTools

1. Install: https://react.dev/learn/react-developer-tools
2. Open browser DevTools (F12)
3. Click "Components" tab
4. Inspect component tree, props, state

### Next.js DevTools

```bash
# Enable experimental devtools
# next.config.js
experimental: {
  appDir: true,
  devtoolsEnabled: true
}
```

---

## Step 13: Resources

### Official Documentation

- Next.js Docs: https://nextjs.org/docs
- React Docs: https://react.dev
- TypeScript Docs: https://www.typescriptlang.org/docs
- Tailwind CSS Docs: https://tailwindcss.com/docs

### Learning Next.js

- Next.js Tutorial: https://nextjs.org/learn
- App Router Guide: https://nextjs.org/docs/app
- TypeScript with Next.js: https://nextjs.org/docs/basic-features/typescript

### Getting Help

- Next.js Discord: https://nextjs.org/discord
- Stack Overflow: Tag [next.js]
- GitHub Issues: https://github.com/vercel/next.js/issues

---

## Checklist: Ready for Development

Before you start coding, verify:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm 9+ installed (`npm --version`)
- [ ] Git installed (`git --version`)
- [ ] Next.js project created (`npx create-next-app`)
- [ ] Dev server starts (`npm run dev`)
- [ ] Browser shows Next.js welcome page (`http://localhost:3000`)
- [ ] `.env.local` file created
- [ ] `.gitignore` includes `.env*.local`
- [ ] Content directory structure created
- [ ] VS Code extensions installed
- [ ] Git repository initialized
- [ ] First commit made

If all checked, you're ready to build!

---

## Next Steps

1. Read OPEN-SOURCE-STACK.md for architecture overview
2. Copy content from wireframes/ to content/ directory
3. Build first page component (home page)
4. Set up Decap CMS config (follow OPEN-SOURCE-STACK.md Step 4)
5. Deploy to Cloudflare Pages (follow OPEN-SOURCE-STACK.md Step 3)

---

**Last Updated:** 2025-11-18
**Next Review:** After first deployment to Cloudflare Pages
**Questions:** Check techguide.md or OPEN-SOURCE-STACK.md
