# Nightfox Films Rebrand - Developer Implementation Guide
## Complete Technical Specification & Build Guide

**Version:** 1.0
**Last Updated:** November 17, 2025
**Target Launch:** Q1 2026
**Estimated Development Time:** 12-16 weeks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Technical Stack Recommendations](#technical-stack-recommendations)
3. [Development Environment Setup](#development-environment-setup)
4. [Site Architecture & File Structure](#site-architecture--file-structure)
5. [Database Schema](#database-schema)
6. [Component Library](#component-library)
7. [Page-by-Page Implementation](#page-by-page-implementation)
8. [SEO Technical Implementation](#seo-technical-implementation)
9. [Schema Markup Examples](#schema-markup-examples)
10. [Analytics & Tracking](#analytics--tracking)
11. [Performance Optimization](#performance-optimization)
12. [Forms & Lead Capture](#forms--lead-capture)
13. [Content Management System](#content-management-system)
14. [Video Portfolio System](#video-portfolio-system)
15. [Deployment Strategy](#deployment-strategy)
16. [Testing & QA Checklist](#testing--qa-checklist)
17. [Sprint-by-Sprint Implementation Plan](#sprint-by-sprint-implementation-plan)
18. [Code Examples](#code-examples)
19. [Third-Party Integrations](#third-party-integrations)
20. [Maintenance & Optimization](#maintenance--optimization)

---

## Executive Summary

### Project Goals

**Primary Objective:** Build an SEO-optimized wedding videography website that captures Super 8 and Dad Cam search traffic in the Northeast USA.

**Success Metrics:**
- Rank #1 for "Super 8 wedding [region]" within 6 months
- Rank #1 for "Dad Cam wedding [region]" within 6 months
- 100+ qualified inquiries per wedding season
- Page load time <3 seconds
- Mobile-first responsive design
- Accessibility compliance (WCAG 2.1 AA)

### Technical Approach

**Framework:** Next.js 14+ (App Router)
**Styling:** Tailwind CSS + Custom CSS Variables
**CMS:** Sanity.io or Contentful
**Hosting:** Vercel (edge network, automatic CDN)
**Analytics:** GA4 + Plausible Analytics
**Forms:** React Hook Form + email service

### Key Features

1. ✅ Multi-medium service pages (Super 8, Dad Cam, Digital)
2. ✅ Regional landing pages (SEO-optimized)
3. ✅ Filterable video portfolio
4. ✅ Blog with categories and tags
5. ✅ Package pricing calculator
6. ✅ Lead capture forms
7. ✅ Schema markup for rich results
8. ✅ Lightning-fast performance
9. ✅ Mobile-first design
10. ✅ Admin CMS for content updates

---

## Technical Stack Recommendations

### Frontend Framework: Next.js 14+ (App Router)

**Why Next.js?**
- Server-side rendering (SSR) = better SEO
- Static site generation (SSG) = blazing speed
- Built-in image optimization
- API routes for form handling
- Excellent TypeScript support
- Edge runtime for global performance

**Alternative Considerations:**
- **Astro:** Great for content-heavy sites, excellent SEO
- **Gatsby:** Good, but Next.js has better DX now
- **WordPress:** Familiar CMS, but slower and less flexible

**Recommendation:** Next.js for modern DX, performance, and SEO.

---

### Styling: Tailwind CSS

**Why Tailwind?**
- Utility-first = fast development
- Minimal CSS bundle size
- Built-in design system
- Responsive utilities
- Dark mode support (future-proofing)

**Brand Colors (from rebrand.md):**
```css
/* tailwind.config.js */
module.exports = {
  theme: {
    extend: {
      colors: {
        cream: '#fffbf7',      // Background
        charcoal: '#454545',   // Foreground text
        gold: '#b9975c',       // Accent color
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Merriweather', 'serif'], // For headings
      },
    },
  },
}
```

---

### CMS: Sanity.io

**Why Sanity?**
- Structured content (perfect for portfolio)
- Real-time collaboration
- Custom schemas
- Image optimization pipeline
- Portable text (rich content)
- Version control
- Free tier generous

**Alternative:**
- **Contentful:** More enterprise-focused
- **Strapi:** Self-hosted option
- **Notion API:** Simple but limited

**Content Types Needed:**
1. Blog Posts
2. Portfolio Videos
3. Testimonials
4. FAQs
5. Service Pages
6. Regional Pages

---

### Hosting: Vercel

**Why Vercel?**
- Next.js creators = perfect integration
- Edge network (global CDN)
- Automatic SSL
- Preview deployments
- Analytics built-in
- Zero-config deployments

**Cost:** Free for hobby/personal, ~$20/mo for Pro

**Alternative:**
- **Netlify:** Similar features, good option
- **Cloudflare Pages:** Excellent performance, more setup

---

### Database: PostgreSQL (via Supabase or Neon)

**Use Cases:**
- Form submissions storage
- Newsletter subscribers
- Contact inquiries
- Analytics events (optional)

**Why Supabase?**
- PostgreSQL + real-time features
- Built-in auth (for admin panel)
- Free tier: 500MB database
- Row-level security

**Alternative:**
- **PlanetScale:** MySQL, great DX
- **MongoDB Atlas:** NoSQL option

---

### Email Service: Resend or SendGrid

**For:**
- Inquiry notifications
- Auto-responders
- Newsletter campaigns

**Resend:**
- Modern API
- React Email templates
- 100 emails/day free

**SendGrid:**
- More established
- 100 emails/day free
- Better deliverability at scale

---

### Analytics Stack

**Google Analytics 4:**
- Industry standard
- Conversion tracking
- Audience insights

**Plausible Analytics (recommended addition):**
- Privacy-friendly
- Simple, fast
- Cookie-free
- Better UX than GA4

**Hotjar (optional):**
- Heatmaps
- Session recordings
- User feedback

---

## Development Environment Setup

### Prerequisites

```bash
# Required
Node.js 18+ (LTS recommended)
npm or pnpm or yarn
Git

# Recommended
VS Code with extensions:
  - ESLint
  - Prettier
  - Tailwind CSS IntelliSense
  - TypeScript and JavaScript Language Features
```

### Project Initialization

```bash
# Create Next.js project
npx create-next-app@latest nightfox-films --typescript --tailwind --app

# Navigate to project
cd nightfox-films

# Install dependencies
npm install

# Additional dependencies
npm install @sanity/client @sanity/image-url
npm install react-hook-form zod
npm install framer-motion
npm install @vercel/analytics
npm install sharp # Image optimization
```

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SITE_URL=https://nightfoxfilms.com
NEXT_PUBLIC_SANITY_PROJECT_ID=your-project-id
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_TOKEN=your-token

# Email service
RESEND_API_KEY=your-resend-key

# Database
DATABASE_URL=your-supabase-url

# Analytics
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

### Project Structure

```
nightfox-films/
├── app/
│   ├── (marketing)/          # Marketing pages group
│   │   ├── page.tsx          # Homepage
│   │   ├── about/
│   │   ├── packages/
│   │   ├── portfolio/
│   │   └── contact/
│   ├── services/
│   │   ├── super-8/
│   │   ├── dad-cam/
│   │   ├── modern-digital/
│   │   └── wedding-week/
│   ├── locations/            # Regional landing pages
│   │   ├── rochester/
│   │   ├── buffalo/
│   │   └── finger-lakes/
│   ├── blog/
│   │   ├── [slug]/
│   │   └── category/
│   ├── api/
│   │   ├── contact/
│   │   └── newsletter/
│   └── layout.tsx
├── components/
│   ├── ui/                   # Reusable UI components
│   ├── sections/             # Page sections
│   ├── forms/
│   └── portfolio/
├── lib/
│   ├── sanity/               # CMS client
│   ├── utils/
│   └── constants/
├── public/
│   ├── images/
│   ├── videos/
│   └── fonts/
├── styles/
│   └── globals.css
├── sanity/                   # Sanity Studio
│   ├── schemas/
│   └── config.ts
└── tests/
```

---

## Site Architecture & File Structure

### URL Structure (SEO-Optimized)

```
Homepage
└── /

Services
├── /services/super-8-wedding-videographer
├── /services/dad-cam-wedding-video
├── /services/modern-digital-wedding-films
└── /services/wedding-week-dad-cam

Regional Landing Pages
├── /locations/rochester-wedding-videographer
├── /locations/buffalo-wedding-videographer
├── /locations/finger-lakes-wedding-videographer
├── /locations/syracuse-wedding-videographer
└── /locations/albany-wedding-videographer

Packages
└── /packages

Portfolio
├── /portfolio
├── /portfolio/super-8
├── /portfolio/dad-cam
├── /portfolio/modern-digital
└── /portfolio/mixed-media

Blog
├── /blog
├── /blog/[slug]
└── /blog/category/[category]

Other
├── /about
├── /contact
└── /faq
```

### Routing Implementation (Next.js App Router)

```typescript
// app/(marketing)/page.tsx - Homepage
export default function HomePage() {
  return <HomepageContent />
}

// app/services/super-8-wedding-videographer/page.tsx
export const metadata = {
  title: 'Super 8 Wedding Videographer | Rochester NY | Nightfox Films',
  description: 'Professional Super 8 wedding videography in Rochester, Buffalo, and the Finger Lakes. Authentic film wedding videos with Kodak heritage.',
}

export default function Super8ServicePage() {
  return <Super8ServiceContent />
}
```

---

## Database Schema

### Supabase Tables

#### 1. Contact Inquiries

```sql
CREATE TABLE contact_inquiries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  wedding_date DATE,
  venue_location TEXT,
  package_interest TEXT[],
  message TEXT,
  source TEXT, -- UTM tracking
  status TEXT DEFAULT 'new', -- new, contacted, qualified, booked, declined
  notes TEXT
);

-- Index for faster queries
CREATE INDEX idx_contact_status ON contact_inquiries(status);
CREATE INDEX idx_contact_date ON contact_inquiries(created_at DESC);
```

#### 2. Newsletter Subscribers

```sql
CREATE TABLE newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source TEXT,
  status TEXT DEFAULT 'active' -- active, unsubscribed
);
```

#### 3. Form Analytics

```sql
CREATE TABLE form_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  form_type TEXT NOT NULL, -- contact, newsletter, package-inquiry
  page_url TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  conversion BOOLEAN DEFAULT false
);
```

---

## Component Library

### Core UI Components

#### 1. Button Component

```typescript
// components/ui/Button.tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-gold text-cream hover:bg-gold/90': variant === 'primary',
            'bg-charcoal text-cream hover:bg-charcoal/90': variant === 'secondary',
            'border-2 border-charcoal text-charcoal hover:bg-charcoal hover:text-cream': variant === 'outline',
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2 text-base': size === 'md',
            'px-6 py-3 text-lg': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
```

#### 2. Video Player Component

```typescript
// components/portfolio/VideoPlayer.tsx
'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

interface VideoPlayerProps {
  videoUrl: string
  thumbnailUrl: string
  title: string
  medium: 'super-8' | 'dad-cam' | 'modern-digital' | 'mixed-media'
}

export function VideoPlayer({ videoUrl, thumbnailUrl, title, medium }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-charcoal/10">
      {!isPlaying ? (
        <>
          <img
            src={thumbnailUrl}
            alt={title}
            className="h-full w-full object-cover"
          />
          <button
            onClick={() => setIsPlaying(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/40 transition-all hover:bg-black/50"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold text-cream">
              <Play className="ml-1 h-8 w-8" />
            </div>
          </button>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 p-4">
            <p className="text-sm font-medium text-cream">{title}</p>
            <p className="text-xs text-cream/80 capitalize">{medium.replace('-', ' ')}</p>
          </div>
        </>
      ) : (
        <iframe
          src={`${videoUrl}?autoplay=1`}
          className="h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      )}
    </div>
  )
}
```

#### 3. Package Card Component

```typescript
// components/packages/PackageCard.tsx
interface PackageCardProps {
  name: string
  price: number
  coverage: string
  mediums: string[]
  deliverables: string[]
  popular?: boolean
}

export function PackageCard({
  name,
  price,
  coverage,
  mediums,
  deliverables,
  popular = false
}: PackageCardProps) {
  return (
    <div className={cn(
      'relative rounded-lg border-2 p-8',
      popular
        ? 'border-gold bg-gold/5'
        : 'border-charcoal/20 bg-cream'
    )}>
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-4 py-1 text-sm font-semibold text-cream">
          Most Popular
        </div>
      )}

      <h3 className="text-2xl font-bold text-charcoal">{name}</h3>
      <div className="mt-4 flex items-baseline">
        <span className="text-4xl font-bold text-gold">${price.toLocaleString()}</span>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-sm font-semibold text-charcoal/60">Coverage</p>
          <p className="text-charcoal">{coverage}</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-charcoal/60">Mediums</p>
          <ul className="mt-2 space-y-1">
            {mediums.map((medium) => (
              <li key={medium} className="text-charcoal">{medium}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-charcoal/60">Deliverables</p>
          <ul className="mt-2 space-y-1">
            {deliverables.map((item) => (
              <li key={item} className="flex items-start">
                <span className="mr-2 text-gold">✓</span>
                <span className="text-charcoal">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Button variant="primary" className="mt-8 w-full">
        Inquire About {name}
      </Button>
    </div>
  )
}
```

#### 4. Testimonial Component

```typescript
// components/sections/Testimonial.tsx
interface TestimonialProps {
  quote: string
  author: string
  location: string
  medium: string
  imageUrl?: string
}

export function Testimonial({ quote, author, location, medium, imageUrl }: TestimonialProps) {
  return (
    <div className="rounded-lg bg-cream p-8 shadow-lg">
      <div className="mb-4 text-4xl text-gold">"</div>
      <p className="text-lg italic text-charcoal">{quote}</p>
      <div className="mt-6 flex items-center">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={author}
            className="h-12 w-12 rounded-full object-cover"
          />
        )}
        <div className={imageUrl ? 'ml-4' : ''}>
          <p className="font-semibold text-charcoal">{author}</p>
          <p className="text-sm text-charcoal/60">{location} • {medium}</p>
        </div>
      </div>
    </div>
  )
}
```

---

## Page-by-Page Implementation

### Homepage (`app/page.tsx`)

**SEO Title:** "Super 8, Dad Cam & Modern Wedding Videography | Rochester NY"

**Sections:**
1. Hero with video background
2. Multi-medium showcase
3. Featured portfolio
4. Packages overview
5. Testimonials
6. FAQ
7. CTA

**Implementation:**

```typescript
// app/page.tsx
import { Metadata } from 'next'
import { Hero } from '@/components/sections/Hero'
import { MultiMediumShowcase } from '@/components/sections/MultiMediumShowcase'
import { FeaturedPortfolio } from '@/components/sections/FeaturedPortfolio'
import { PackagesOverview } from '@/components/sections/PackagesOverview'
import { Testimonials } from '@/components/sections/Testimonials'
import { FAQ } from '@/components/sections/FAQ'
import { CTA } from '@/components/sections/CTA'

export const metadata: Metadata = {
  title: 'Nightfox Films | Super 8, Dad Cam & Modern Wedding Videography | Rochester NY',
  description: 'Multi-medium wedding videography in Rochester, Buffalo, and Finger Lakes. Choose Super 8 film, Dad Cam VHS, modern digital, or all three. From Kodak\'s hometown.',
  keywords: [
    'Super 8 wedding videographer Rochester',
    'Dad Cam wedding video',
    'wedding videographer Rochester NY',
    'analog wedding film',
    'VHS wedding videography'
  ],
  openGraph: {
    title: 'Nightfox Films | Multi-Medium Wedding Videography',
    description: 'Super 8, Dad Cam, and Modern Digital wedding films in the Northeast',
    images: ['/og-image.jpg'],
    locale: 'en_US',
    type: 'website',
  }
}

export default function HomePage() {
  return (
    <main>
      <Hero />
      <MultiMediumShowcase />
      <FeaturedPortfolio />
      <PackagesOverview />
      <Testimonials />
      <FAQ />
      <CTA />
    </main>
  )
}
```

**Hero Section:**

```typescript
// components/sections/Hero.tsx
'use client'

import { Button } from '@/components/ui/Button'
import { motion } from 'framer-motion'
import Link from 'next/link'

export function Hero() {
  return (
    <section className="relative h-screen overflow-hidden bg-charcoal">
      {/* Background Video */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-40"
      >
        <source src="/hero-video.mp4" type="video/mp4" />
      </video>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-charcoal/60 to-charcoal/90" />

      {/* Content */}
      <div className="relative z-10 flex h-full items-center">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="max-w-3xl"
          >
            <h1 className="text-5xl font-bold text-cream sm:text-6xl lg:text-7xl">
              Your Wedding.
              <br />
              <span className="text-gold">Your Medium.</span>
              <br />
              Your Story.
            </h1>

            <p className="mt-6 text-xl text-cream/90 sm:text-2xl">
              Super 8 Film • Dad Cam VHS • Modern Digital
              <br />
              Choose one, choose all three. From Kodak's hometown.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Button asChild variant="primary" size="lg">
                <Link href="/packages">View Packages</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-cream text-cream hover:bg-cream hover:text-charcoal">
                <Link href="/portfolio">Watch Films</Link>
              </Button>
            </div>

            <div className="mt-12 flex items-center gap-8 text-cream/80">
              <div>
                <p className="text-3xl font-bold text-gold">100+</p>
                <p className="text-sm">Weddings Filmed</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-gold">3</p>
                <p className="text-sm">Film Formats</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-gold">1</p>
                <p className="text-sm">Kodak Hometown</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ repeat: Infinity, duration: 1.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <div className="h-10 w-6 rounded-full border-2 border-cream/50">
          <div className="mx-auto mt-2 h-2 w-1 rounded-full bg-cream/50" />
        </div>
      </motion.div>
    </section>
  )
}
```

---

### Service Page: Super 8 Wedding Videographer

**URL:** `/services/super-8-wedding-videographer`

**SEO Strategy:**
- Primary keyword: "Super 8 wedding videographer [region]"
- Secondary: "Super 8 wedding film", "analog wedding video"
- Long-tail: "Super 8 wedding with sound", "Super 8 wedding cost"

**Page Structure:**

```typescript
// app/services/super-8-wedding-videographer/page.tsx
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Super 8 Wedding Videographer | Rochester, Buffalo & Finger Lakes',
  description: 'Professional Super 8 wedding videography with synchronized audio. Authentic Kodak film from Rochester, NY. Starting at $2,500. View our Super 8 wedding films.',
  keywords: [
    'Super 8 wedding videographer Rochester',
    'Super 8 wedding film',
    'Super 8 wedding Buffalo',
    'analog wedding videographer',
    'Super 8 wedding with sound'
  ]
}

export default function Super8ServicePage() {
  return (
    <main>
      <ServiceHero
        title="The Perfect Highlight Film"
        subtitle="Super 8 Wedding Videography"
        description="Authentic Kodak film from the birthplace of cinema. Every frame is a work of art."
        imageUrl="/super8-hero.jpg"
      />

      <WhatIsSuper8 />
      <WhyChooseSuper8 />
      <AudioExplanation />
      <FilmStockOptions />
      <Super8Process />
      <Super8Packages />
      <Super8Portfolio />
      <Super8FAQ />
      <CTA text="Book Your Super 8 Wedding Film" />
    </main>
  )
}
```

**What Is Super 8 Section:**

```typescript
// components/services/WhatIsSuper8.tsx
export function WhatIsSuper8() {
  return (
    <section className="bg-cream py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-4xl font-bold text-charcoal">
              What is Super 8 Film?
            </h2>
            <div className="mt-6 space-y-4 text-lg text-charcoal/80">
              <p>
                Super 8 is a film format introduced by Kodak in 1965. It's the same film
                your grandparents used to capture family memories—birthdays, holidays,
                and life's most precious moments.
              </p>
              <p>
                Today, Super 8 brings that same nostalgic warmth to weddings. The organic
                grain, rich colors, and dreamy quality cannot be replicated by digital cameras
                or filters. It's the real thing.
              </p>
              <p className="font-semibold text-gold">
                We're based in Rochester, NY—Kodak's hometown. Film is in our DNA.
              </p>
            </div>
          </div>

          <div className="relative">
            <img
              src="/super8-camera.jpg"
              alt="Super 8 camera"
              className="rounded-lg shadow-2xl"
            />
            <div className="absolute -bottom-6 -right-6 rounded-lg bg-gold p-6 text-cream shadow-xl">
              <p className="text-sm font-semibold">Film Stock</p>
              <p className="text-2xl font-bold">Kodak Vision3</p>
              <p className="text-sm opacity-90">Professional Cinema Film</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
```

---

### Regional Landing Page Template

**Example:** `/locations/rochester-wedding-videographer`

**SEO Strategy:**
- Primary: "wedding videographer Rochester NY"
- Secondary: "Super 8 wedding Rochester", "Dad Cam wedding Rochester"
- Local: Include venue names, neighborhoods

```typescript
// app/locations/rochester-wedding-videographer/page.tsx
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Rochester Wedding Videographer | Super 8, Dad Cam & Digital | Nightfox Films',
  description: 'Professional wedding videography in Rochester, NY and surrounding areas. Super 8 film, Dad Cam VHS, and modern digital. Based in Kodak\'s hometown.',
  openGraph: {
    title: 'Rochester Wedding Videographer | Nightfox Films',
    description: 'Multi-medium wedding films in Rochester, NY',
    images: ['/og-rochester.jpg'],
  }
}

const ROCHESTER_VENUES = [
  'The Century',
  'The Wintergarden',
  'The Memorial Art Gallery',
  'Woodcliff Hotel & Spa',
  'Del Monte Lodge',
  // ... more venues
]

export default function RochesterLandingPage() {
  return (
    <main>
      <RegionalHero
        location="Rochester, NY"
        tagline="Wedding Videography from Kodak's Hometown"
        imageUrl="/rochester-skyline.jpg"
      />

      <WhyChooseNightfoxInRochester />

      <LocalVenuesSection venues={ROCHESTER_VENUES} />

      <RochesterTestimonials />

      <ServicesOverview location="Rochester" />

      <PackagesSection />

      <LocalFAQ location="Rochester" />

      <CTA location="Rochester" />
    </main>
  )
}
```

**Local Venues Section (SEO Boost):**

```typescript
// components/regional/LocalVenuesSection.tsx
interface LocalVenuesSectionProps {
  venues: string[]
}

export function LocalVenuesSection({ venues }: LocalVenuesSectionProps) {
  return (
    <section className="bg-cream py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-charcoal">
          We've Filmed at Rochester's Best Wedding Venues
        </h2>
        <p className="mt-4 text-lg text-charcoal/70">
          From The Century to intimate backyard ceremonies, we know Rochester's
          wedding scene inside and out.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {venues.map((venue) => (
            <div
              key={venue}
              className="rounded-lg border border-charcoal/10 bg-white p-4 text-center text-charcoal"
            >
              {venue}
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-charcoal/60">
          Don't see your venue? We travel throughout the Finger Lakes region.
        </p>
      </div>
    </section>
  )
}
```

---

## SEO Technical Implementation

### 1. Metadata & Open Graph

```typescript
// app/layout.tsx
import { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://nightfoxfilms.com'),
  title: {
    default: 'Nightfox Films | Super 8, Dad Cam & Modern Wedding Videography',
    template: '%s | Nightfox Films'
  },
  description: 'Multi-medium wedding videography in Rochester, Buffalo, and Finger Lakes. Choose Super 8 film, Dad Cam VHS, modern digital, or all three.',
  keywords: [
    'Super 8 wedding videographer',
    'Dad Cam wedding video',
    'wedding videographer Rochester NY',
    'analog wedding film',
    'VHS wedding videography',
    'mixed media wedding film'
  ],
  authors: [{ name: 'Nightfox Films' }],
  creator: 'Nightfox Films',
  publisher: 'Nightfox Films',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://nightfoxfilms.com',
    siteName: 'Nightfox Films',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Nightfox Films - Multi-Medium Wedding Videography'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nightfox Films | Multi-Medium Wedding Videography',
    description: 'Super 8, Dad Cam, and Modern Digital wedding films',
    images: ['/twitter-image.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'your-google-verification-code',
    // yandex: 'yandex',
    // other: {
    //   'bing': 'bing-verification',
    // },
  },
}
```

### 2. Sitemap Generation

```typescript
// app/sitemap.ts
import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://nightfoxfilms.com'

  // Static pages
  const staticPages = [
    '',
    '/about',
    '/packages',
    '/portfolio',
    '/contact',
    '/faq',
  ].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: route === '' ? 1 : 0.8,
  }))

  // Service pages
  const servicePages = [
    '/services/super-8-wedding-videographer',
    '/services/dad-cam-wedding-video',
    '/services/modern-digital-wedding-films',
    '/services/wedding-week-dad-cam',
  ].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.9,
  }))

  // Regional pages
  const regionalPages = [
    '/locations/rochester-wedding-videographer',
    '/locations/buffalo-wedding-videographer',
    '/locations/finger-lakes-wedding-videographer',
    '/locations/syracuse-wedding-videographer',
    '/locations/albany-wedding-videographer',
  ].map(route => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.85,
  }))

  // Blog posts (fetch from CMS)
  // const blogPosts = await getBlogPosts()
  // const blogPages = blogPosts.map(post => ({
  //   url: `${baseUrl}/blog/${post.slug}`,
  //   lastModified: new Date(post.publishedAt),
  //   changeFrequency: 'weekly' as const,
  //   priority: 0.7,
  // }))

  return [
    ...staticPages,
    ...servicePages,
    ...regionalPages,
    // ...blogPages,
  ]
}
```

### 3. Robots.txt

```typescript
// app/robots.ts
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/', '/_next/'],
      },
    ],
    sitemap: 'https://nightfoxfilms.com/sitemap.xml',
  }
}
```

### 4. Canonical URLs

```typescript
// In each page component
export const metadata: Metadata = {
  // ... other metadata
  alternates: {
    canonical: 'https://nightfoxfilms.com/services/super-8-wedding-videographer',
  },
}
```

---

## Schema Markup Examples

### 1. LocalBusiness Schema (Organization)

```typescript
// components/SchemaMarkup.tsx
export function OrganizationSchema() {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': 'https://nightfoxfilms.com/#organization',
    name: 'Nightfox Films',
    description: 'Multi-medium wedding videography specializing in Super 8 film, Dad Cam VHS, and modern digital formats',
    url: 'https://nightfoxfilms.com',
    telephone: '(585) 512-8999',
    email: 'hello@nightfoxfilms.com',
    logo: 'https://nightfoxfilms.com/logo.png',
    image: 'https://nightfoxfilms.com/og-image.jpg',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '[Your Street Address]',
      addressLocality: 'Rochester',
      addressRegion: 'NY',
      postalCode: '14600',
      addressCountry: 'US'
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: '43.1566',
      longitude: '-77.6088'
    },
    areaServed: [
      {
        '@type': 'City',
        name: 'Rochester',
        '@id': 'https://en.wikipedia.org/wiki/Rochester,_New_York'
      },
      {
        '@type': 'City',
        name: 'Buffalo'
      },
      {
        '@type': 'City',
        name: 'Syracuse'
      },
      {
        '@type': 'City',
        name: 'Albany'
      }
    ],
    priceRange: '$$$',
    openingHours: 'Mo-Su 09:00-20:00',
    sameAs: [
      'https://instagram.com/nightfoxfilms',
      'https://facebook.com/nightfoxfilms',
      'https://www.theknot.com/nightfoxfilms',
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '5.0',
      reviewCount: '47'
    }
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
```

### 2. Service Schema

```typescript
// components/ServiceSchema.tsx
export function ServiceSchema({ service }: { service: string }) {
  const serviceDescriptions = {
    'super-8': {
      name: 'Super 8 Wedding Videography',
      description: 'Professional Super 8 film wedding videography with synchronized audio',
      price: '2500-12500'
    },
    'dad-cam': {
      name: 'Dad Cam VHS Wedding Video',
      description: 'Authentic VHS camcorder wedding videography for nostalgic, home-movie style films',
      price: '2500-12500'
    },
    'modern-digital': {
      name: 'Modern Digital Wedding Videography',
      description: '4K digital wedding videography with cinematic quality',
      price: '2500-12500'
    }
  }

  const serviceData = serviceDescriptions[service as keyof typeof serviceDescriptions]

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: serviceData.name,
    provider: {
      '@id': 'https://nightfoxfilms.com/#organization'
    },
    description: serviceData.description,
    areaServed: {
      '@type': 'State',
      name: 'New York'
    },
    offers: {
      '@type': 'Offer',
      priceRange: `$${serviceData.price}`,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock'
    }
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
```

### 3. VideoObject Schema (Portfolio)

```typescript
// For each portfolio video
export function VideoSchema({ video }: { video: PortfolioVideo }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    uploadDate: video.publishedAt,
    contentUrl: video.videoUrl,
    embedUrl: video.embedUrl,
    duration: video.duration, // ISO 8601 format: PT3M45S
    publisher: {
      '@id': 'https://nightfoxfilms.com/#organization'
    }
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
```

### 4. FAQPage Schema

```typescript
// components/FAQSchema.tsx
export function FAQSchema({ faqs }: { faqs: FAQ[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    }))
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
```

### 5. BreadcrumbList Schema

```typescript
// components/BreadcrumbSchema.tsx
interface BreadcrumbItem {
  name: string
  url: string
}

export function BreadcrumbSchema({ items }: { items: BreadcrumbItem[] }) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
```

---

## Analytics & Tracking

### Google Analytics 4 Setup

```typescript
// lib/analytics/gtag.ts
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// Log page views
export const pageview = (url: string) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('config', GA_MEASUREMENT_ID!, {
      page_path: url,
    })
  }
}

// Log specific events
export const event = ({ action, category, label, value }: {
  action: string
  category: string
  label: string
  value?: number
}) => {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value,
    })
  }
}
```

```typescript
// app/layout.tsx - Add GA script
import Script from 'next/script'
import { GA_MEASUREMENT_ID } from '@/lib/analytics/gtag'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body>{children}</body>
    </html>
  )
}
```

### Event Tracking Examples

```typescript
// components/forms/ContactForm.tsx
import { event } from '@/lib/analytics/gtag'

function handleSubmit() {
  // ... form submission logic

  // Track conversion
  event({
    action: 'submit_form',
    category: 'Contact',
    label: 'Contact Form Submission',
  })

  // Track specific package interest
  event({
    action: 'package_interest',
    category: 'Packages',
    label: formData.packageInterest,
    value: packagePrices[formData.packageInterest],
  })
}
```

### Conversion Goals Setup

**Key Conversions to Track:**

1. **Contact Form Submission**
   - Event: `submit_form`
   - Category: `Contact`
   - Value: Package price (if selected)

2. **Package Inquiry Click**
   - Event: `package_click`
   - Category: `Packages`
   - Label: Package name

3. **Video Play**
   - Event: `video_play`
   - Category: `Portfolio`
   - Label: Video title

4. **Phone Number Click**
   - Event: `phone_click`
   - Category: `Contact`

5. **Newsletter Signup**
   - Event: `newsletter_signup`
   - Category: `Newsletter`

---

## Performance Optimization

### 1. Image Optimization

```typescript
// next.config.js
module.exports = {
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    domains: ['cdn.sanity.io', 'cdn.nightfoxfilms.com'],
  },
}
```

```typescript
// Usage
import Image from 'next/image'

<Image
  src="/wedding-photo.jpg"
  alt="Super 8 wedding film still"
  width={1200}
  height={800}
  priority={isAboveFold}
  placeholder="blur"
  blurDataURL={blurDataUrl}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
/>
```

### 2. Font Optimization

```typescript
// app/layout.tsx
import { Inter, Merriweather } from 'next/font/google'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const merriweather = Merriweather({
  weight: ['300', '400', '700'],
  subsets: ['latin'],
  variable: '--font-merriweather',
  display: 'swap',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${merriweather.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

### 3. Code Splitting

```typescript
// Dynamic imports for heavy components
import dynamic from 'next/dynamic'

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), {
  loading: () => <VideoPlayerSkeleton />,
  ssr: false, // Disable SSR for client-only components
})

const PortfolioGrid = dynamic(() => import('@/components/PortfolioGrid'), {
  loading: () => <Spinner />,
})
```

### 4. Prefetching & Preloading

```typescript
// Prefetch critical resources
<link rel="preconnect" href="https://cdn.sanity.io" />
<link rel="dns-prefetch" href="https://www.google-analytics.com" />

// Preload critical fonts
<link
  rel="preload"
  href="/fonts/custom-font.woff2"
  as="font"
  type="font/woff2"
  crossOrigin="anonymous"
/>
```

### 5. Lazy Loading

```typescript
// Lazy load images below the fold
<Image
  src="/image.jpg"
  alt="Description"
  loading="lazy"
  width={800}
  height={600}
/>

// Lazy load videos
<video
  preload="none"
  poster="/video-thumbnail.jpg"
>
  <source src="/video.mp4" type="video/mp4" />
</video>
```

### Performance Targets

- **Lighthouse Score:** 90+ (all categories)
- **First Contentful Paint (FCP):** <1.8s
- **Largest Contentful Paint (LCP):** <2.5s
- **Cumulative Layout Shift (CLS):** <0.1
- **Time to Interactive (TTI):** <3.5s
- **Total Blocking Time (TBT):** <200ms

---

## Forms & Lead Capture

### Contact Form Implementation

```typescript
// components/forms/ContactForm.tsx
'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { event } from '@/lib/analytics/gtag'

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  weddingDate: z.string().optional(),
  venueLocation: z.string().optional(),
  packageInterest: z.array(z.string()).optional(),
  message: z.string().min(10, 'Message must be at least 10 characters'),
})

type ContactFormData = z.infer<typeof contactSchema>

export function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  })

  const onSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) throw new Error('Submission failed')

      // Track conversion
      event({
        action: 'submit_form',
        category: 'Contact',
        label: 'Contact Form Submission',
      })

      setSubmitStatus('success')
      reset()
    } catch (error) {
      setSubmitStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-charcoal">
          Name *
        </label>
        <input
          {...register('name')}
          type="text"
          id="name"
          className="mt-1 block w-full rounded-md border-charcoal/20 bg-white px-4 py-2 text-charcoal shadow-sm focus:border-gold focus:ring-gold"
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-charcoal">
          Email *
        </label>
        <input
          {...register('email')}
          type="email"
          id="email"
          className="mt-1 block w-full rounded-md border-charcoal/20 bg-white px-4 py-2 text-charcoal shadow-sm focus:border-gold focus:ring-gold"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      {/* Phone (optional) */}
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-charcoal">
          Phone
        </label>
        <input
          {...register('phone')}
          type="tel"
          id="phone"
          className="mt-1 block w-full rounded-md border-charcoal/20 bg-white px-4 py-2 text-charcoal shadow-sm focus:border-gold focus:ring-gold"
        />
      </div>

      {/* Wedding Date */}
      <div>
        <label htmlFor="weddingDate" className="block text-sm font-medium text-charcoal">
          Wedding Date
        </label>
        <input
          {...register('weddingDate')}
          type="date"
          id="weddingDate"
          className="mt-1 block w-full rounded-md border-charcoal/20 bg-white px-4 py-2 text-charcoal shadow-sm focus:border-gold focus:ring-gold"
        />
      </div>

      {/* Package Interest */}
      <div>
        <label className="block text-sm font-medium text-charcoal">
          Interested In
        </label>
        <div className="mt-2 space-y-2">
          {['Just Shoot It', 'The Highlight Film', 'Mixed Media Experience', 'The Full Experience'].map((pkg) => (
            <label key={pkg} className="flex items-center">
              <input
                {...register('packageInterest')}
                type="checkbox"
                value={pkg}
                className="h-4 w-4 rounded border-charcoal/20 text-gold focus:ring-gold"
              />
              <span className="ml-2 text-charcoal">{pkg}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Message */}
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-charcoal">
          Message *
        </label>
        <textarea
          {...register('message')}
          id="message"
          rows={4}
          className="mt-1 block w-full rounded-md border-charcoal/20 bg-white px-4 py-2 text-charcoal shadow-sm focus:border-gold focus:ring-gold"
        />
        {errors.message && (
          <p className="mt-1 text-sm text-red-600">{errors.message.message}</p>
        )}
      </div>

      {/* Submit */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={isSubmitting}
        className="w-full"
      >
        {isSubmitting ? 'Sending...' : 'Send Inquiry'}
      </Button>

      {/* Status messages */}
      {submitStatus === 'success' && (
        <div className="rounded-md bg-green-50 p-4 text-green-800">
          Thank you! We'll be in touch within 24 hours.
        </div>
      )}
      {submitStatus === 'error' && (
        <div className="rounded-md bg-red-50 p-4 text-red-800">
          Something went wrong. Please try again or email us directly.
        </div>
      )}
    </form>
  )
}
```

### API Route for Form Submission

```typescript
// app/api/contact/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { supabase } from '@/lib/supabase'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()

    // Store in database
    const { error: dbError } = await supabase
      .from('contact_inquiries')
      .insert([
        {
          name: data.name,
          email: data.email,
          phone: data.phone,
          wedding_date: data.weddingDate,
          venue_location: data.venueLocation,
          package_interest: data.packageInterest,
          message: data.message,
          source: request.headers.get('referer'),
        }
      ])

    if (dbError) throw dbError

    // Send notification email
    await resend.emails.send({
      from: 'inquiries@nightfoxfilms.com',
      to: 'hello@nightfoxfilms.com',
      subject: `New Wedding Inquiry: ${data.name}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
        <p><strong>Wedding Date:</strong> ${data.weddingDate || 'Not provided'}</p>
        <p><strong>Venue:</strong> ${data.venueLocation || 'Not provided'}</p>
        <p><strong>Package Interest:</strong> ${data.packageInterest?.join(', ') || 'None selected'}</p>
        <p><strong>Message:</strong></p>
        <p>${data.message}</p>
      `,
    })

    // Send auto-responder to customer
    await resend.emails.send({
      from: 'Nightfox Films <hello@nightfoxfilms.com>',
      to: data.email,
      subject: 'Thank you for your inquiry!',
      html: `
        <p>Hi ${data.name},</p>
        <p>Thank you for reaching out! We're excited to learn more about your wedding.</p>
        <p>We'll review your inquiry and get back to you within 24 hours.</p>
        <p>In the meantime, feel free to:</p>
        <ul>
          <li><a href="https://nightfoxfilms.com/portfolio">Browse our portfolio</a></li>
          <li><a href="https://nightfoxfilms.com/packages">Review our packages</a></li>
          <li><a href="https://nightfoxfilms.com/faq">Read our FAQs</a></li>
        </ul>
        <p>Best,<br/>The Nightfox Films Team</p>
      `,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Form submission error:', error)
    return NextResponse.json(
      { error: 'Failed to submit form' },
      { status: 500 }
    )
  }
}
```

---

## Content Management System

### Sanity Schema Setup

```typescript
// sanity/schemas/blogPost.ts
export default {
  name: 'blogPost',
  title: 'Blog Post',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: 'title',
        maxLength: 96,
      },
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'author',
      title: 'Author',
      type: 'reference',
      to: [{ type: 'author' }],
    },
    {
      name: 'mainImage',
      title: 'Main image',
      type: 'image',
      options: {
        hotspot: true,
      },
    },
    {
      name: 'categories',
      title: 'Categories',
      type: 'array',
      of: [{ type: 'reference', to: { type: 'category' } }],
    },
    {
      name: 'publishedAt',
      title: 'Published at',
      type: 'datetime',
    },
    {
      name: 'excerpt',
      title: 'Excerpt',
      type: 'text',
      rows: 4,
    },
    {
      name: 'body',
      title: 'Body',
      type: 'blockContent',
    },
    {
      name: 'seo',
      title: 'SEO',
      type: 'object',
      fields: [
        {
          name: 'metaTitle',
          title: 'Meta Title',
          type: 'string',
        },
        {
          name: 'metaDescription',
          title: 'Meta Description',
          type: 'text',
          rows: 3,
        },
        {
          name: 'keywords',
          title: 'Keywords',
          type: 'array',
          of: [{ type: 'string' }],
        },
      ],
    },
  ],
  preview: {
    select: {
      title: 'title',
      author: 'author.name',
      media: 'mainImage',
    },
  },
}
```

```typescript
// sanity/schemas/portfolioVideo.ts
export default {
  name: 'portfolioVideo',
  title: 'Portfolio Video',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: 'title',
        maxLength: 96,
      },
    },
    {
      name: 'medium',
      title: 'Medium',
      type: 'string',
      options: {
        list: [
          { title: 'Super 8', value: 'super-8' },
          { title: 'Dad Cam', value: 'dad-cam' },
          { title: 'Modern Digital', value: 'modern-digital' },
          { title: 'Mixed Media', value: 'mixed-media' },
        ],
      },
      validation: (Rule: any) => Rule.required(),
    },
    {
      name: 'vimeoUrl',
      title: 'Vimeo URL',
      type: 'url',
    },
    {
      name: 'thumbnailImage',
      title: 'Thumbnail Image',
      type: 'image',
      options: {
        hotspot: true,
      },
    },
    {
      name: 'venue',
      title: 'Venue',
      type: 'string',
    },
    {
      name: 'location',
      title: 'Location',
      type: 'string',
    },
    {
      name: 'weddingDate',
      title: 'Wedding Date',
      type: 'date',
    },
    {
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      description: 'Show on homepage',
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 3,
    },
  ],
}
```

---

## Sprint-by-Sprint Implementation Plan

### Sprint 1: Foundation & Setup (Weeks 1-2)

**Goals:**
- Project setup complete
- Design system implemented
- Basic routing in place

**Tasks:**
1. ✅ Initialize Next.js project
2. ✅ Set up Tailwind CSS with brand colors
3. ✅ Configure TypeScript
4. ✅ Set up Sanity CMS
5. ✅ Create component library (Button, Input, etc.)
6. ✅ Build layout components (Header, Footer)
7. ✅ Implement routing structure
8. ✅ Set up environment variables
9. ✅ Configure ESLint and Prettier

**Deliverables:**
- Working dev environment
- Component library
- Basic site structure

---

### Sprint 2: Homepage & Core Pages (Weeks 3-4)

**Goals:**
- Homepage complete
- About and Contact pages done
- Basic SEO in place

**Tasks:**
1. ✅ Build homepage sections
2. ✅ Implement hero with video
3. ✅ Create multi-medium showcase
4. ✅ Build about page
5. ✅ Build contact page with form
6. ✅ Set up metadata and SEO
7. ✅ Implement schema markup
8. ✅ Add analytics tracking

**Deliverables:**
- Complete homepage
- About and Contact pages
- Working contact form

---

### Sprint 3: Service Pages (Weeks 5-6)

**Goals:**
- All 4 service pages complete
- SEO-optimized content

**Tasks:**
1. ✅ Super 8 service page
2. ✅ Dad Cam service page
3. ✅ Modern Digital service page
4. ✅ Wedding Week Dad Cam page
5. ✅ Service-specific schema markup
6. ✅ FAQ sections
7. ✅ Internal linking strategy

**Deliverables:**
- 4 complete service pages
- Service schemas

---

### Sprint 4: Regional Landing Pages (Weeks 7-8)

**Goals:**
- 5+ regional pages complete
- Local SEO optimized

**Tasks:**
1. ✅ Create regional page template
2. ✅ Rochester landing page
3. ✅ Buffalo landing page
4. ✅ Finger Lakes landing page
5. ✅ Syracuse landing page
6. ✅ Albany landing page
7. ✅ Local venue lists
8. ✅ Regional testimonials

**Deliverables:**
- 5 regional landing pages
- Local SEO implementation

---

### Sprint 5: Portfolio System (Weeks 9-10)

**Goals:**
- Portfolio page with filtering
- Video integration
- CMS integration

**Tasks:**
1. ✅ Build portfolio grid
2. ✅ Implement filters (medium, location)
3. ✅ Vimeo/YouTube integration
4. ✅ Video player component
5. ✅ Individual video pages
6. ✅ Sanity schema for videos
7. ✅ Featured videos on homepage

**Deliverables:**
- Working portfolio system
- Video CMS integration

---

### Sprint 6: Packages & Pricing (Weeks 11-12)

**Goals:**
- Packages page complete
- Pricing calculator (optional)
- Package inquiry forms

**Tasks:**
1. ✅ Build packages page
2. ✅ Package card components
3. ✅ Add-ons section
4. ✅ Package comparison table
5. ✅ Package-specific inquiry forms
6. ✅ Conversion tracking

**Deliverables:**
- Complete packages page
- Inquiry forms

---

### Sprint 7: Blog System (Weeks 13-14)

**Goals:**
- Blog infrastructure complete
- First 3-5 blog posts published
- SEO optimized

**Tasks:**
1. ✅ Blog listing page
2. ✅ Blog post template
3. ✅ Category pages
4. ✅ Search functionality
5. ✅ Related posts
6. ✅ Blog schema markup
7. ✅ Write first blog posts

**Deliverables:**
- Working blog system
- 3-5 published posts

---

### Sprint 8: Testing & Optimization (Weeks 15-16)

**Goals:**
- Performance optimization
- QA testing
- Launch preparation

**Tasks:**
1. ✅ Lighthouse audits
2. ✅ Performance optimization
3. ✅ Mobile testing (all devices)
4. ✅ Browser testing
5. ✅ Accessibility audit
6. ✅ SEO audit
7. ✅ Form testing
8. ✅ Analytics verification
9. ✅ SSL setup
10. ✅ Final content review

**Deliverables:**
- Production-ready website
- Performance reports
- Launch checklist

---

### Sprint 9: Launch & Post-Launch (Week 17+)

**Goals:**
- Site launch
- Monitoring
- Iteration

**Tasks:**
1. ✅ Deploy to production
2. ✅ Submit sitemap to search engines
3. ✅ Set up Google Search Console
4. ✅ Monitor analytics
5. ✅ Fix any bugs
6. ✅ Start content marketing
7. ✅ A/B testing

**Deliverables:**
- Live website
- Monitoring dashboard

---

## Testing & QA Checklist

### Functional Testing

**Forms:**
- [ ] Contact form submits successfully
- [ ] Form validation works
- [ ] Error messages display correctly
- [ ] Success message displays
- [ ] Email notifications sent
- [ ] Data saved to database
- [ ] Auto-responder sent

**Navigation:**
- [ ] All links work
- [ ] Mobile menu works
- [ ] Breadcrumbs accurate
- [ ] Footer links work
- [ ] CTA buttons work

**Portfolio:**
- [ ] Videos load and play
- [ ] Filters work correctly
- [ ] Search works
- [ ] Pagination works
- [ ] Thumbnails load

---

### SEO Testing

- [ ] All pages have unique titles
- [ ] All pages have meta descriptions
- [ ] All images have alt text
- [ ] Schema markup validates
- [ ] Sitemap generates correctly
- [ ] Robots.txt configured
- [ ] Canonical URLs set
- [ ] Open Graph tags present
- [ ] Twitter cards configured
- [ ] Structured data validates (Google Rich Results Test)

---

### Performance Testing

- [ ] Lighthouse score 90+
- [ ] Images optimized
- [ ] Fonts optimized
- [ ] JavaScript minified
- [ ] CSS minified
- [ ] Lazy loading implemented
- [ ] CDN configured
- [ ] Caching headers set
- [ ] GZIP compression enabled

---

### Accessibility Testing

- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Color contrast sufficient (WCAG AA)
- [ ] Focus states visible
- [ ] ARIA labels present
- [ ] Semantic HTML used
- [ ] Skip links available

---

### Browser Testing

- [ ] Chrome (latest)
- [ ] Safari (latest)
- [ ] Firefox (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

---

### Mobile Testing

- [ ] iPhone SE (small screen)
- [ ] iPhone 12/13 (medium)
- [ ] iPhone 14 Pro Max (large)
- [ ] iPad (tablet)
- [ ] Android phones (various)

---

## Deployment Strategy

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod
```

### Environment Variables (Vercel)

```
NEXT_PUBLIC_SITE_URL=https://nightfoxfilms.com
NEXT_PUBLIC_SANITY_PROJECT_ID=xxx
NEXT_PUBLIC_SANITY_DATASET=production
SANITY_API_TOKEN=xxx
RESEND_API_KEY=xxx
DATABASE_URL=xxx
NEXT_PUBLIC_GA_MEASUREMENT_ID=xxx
```

### Domain Configuration

1. Add custom domain in Vercel
2. Update DNS records
3. Wait for SSL certificate
4. Test HTTPS

### Post-Deployment

1. Submit sitemap to Google Search Console
2. Submit sitemap to Bing Webmaster Tools
3. Set up Google Analytics
4. Set up monitoring (Vercel Analytics, Sentry)
5. Test all forms
6. Monitor error logs

---

## Maintenance & Optimization

### Monthly Tasks

- [ ] Review Google Analytics
- [ ] Check keyword rankings
- [ ] Review and respond to inquiries
- [ ] Publish 2 blog posts
- [ ] Update portfolio (new videos)
- [ ] Check for broken links
- [ ] Review performance metrics
- [ ] Update packages if needed

### Quarterly Tasks

- [ ] SEO audit
- [ ] Competitor analysis
- [ ] Content refresh
- [ ] A/B testing review
- [ ] Technology updates
- [ ] Security patches

---

## Next Steps

**Week 1 Action Items:**

1. **Set up development environment**
   - Install Node.js, Git, VS Code
   - Initialize Next.js project
   - Set up Tailwind CSS

2. **Create Sanity CMS account**
   - Set up project
   - Create schemas
   - Import sample content

3. **Design handoff**
   - Finalize logo
   - Get high-res images
   - Collect video assets

4. **Content gathering**
   - Write homepage copy
   - Write service page copy
   - Collect testimonials

5. **Domain & hosting**
   - Purchase domain (if needed)
   - Set up Vercel account
   - Configure DNS

**Questions to Answer:**

1. Do we have all brand assets (logo, colors, fonts)?
2. Do we have high-quality photos and videos?
3. Who will write blog content?
4. What's the budget for third-party services?
5. Do we need a staging environment?

---

## Resources

**Documentation:**
- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Sanity.io](https://www.sanity.io/docs)
- [Vercel Deployment](https://vercel.com/docs)
- [Schema.org](https://schema.org)

**Tools:**
- [Google Search Console](https://search.google.com/search-console)
- [Google Analytics](https://analytics.google.com)
- [PageSpeed Insights](https://pagespeed.web.dev)
- [Schema Markup Validator](https://validator.schema.org)
- [Google Rich Results Test](https://search.google.com/test/rich-results)

**SEO Resources:**
- [Ahrefs Keyword Generator](https://ahrefs.com/keyword-generator)
- [SEMrush](https://www.semrush.com)
- [Moz Local SEO Guide](https://moz.com/learn/seo/local)

---

## Conclusion

This developer guide provides a complete blueprint for building the Nightfox Films website. Follow the sprint-by-sprint plan, reference the code examples, and use the checklists to ensure nothing is missed.

**Key Success Factors:**

1. ✅ SEO-first approach (every page optimized)
2. ✅ Performance matters (sub-3-second load times)
3. ✅ Mobile-first design (60%+ traffic is mobile)
4. ✅ Clear conversion paths (easy to inquire)
5. ✅ Regular content updates (blog + portfolio)

**Let's build something great. 🎬**

---

**Questions?** Contact the development team or refer to the research guide and rebrand outline for additional context.
