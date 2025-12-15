/**
 * Web Source Behaviors - Browsertrix-Level Page Interaction
 *
 * Comprehensive behaviors that interact with web pages to expose ALL hidden content
 * before archiving. Inspired by Browsertrix Crawler's behavior system.
 *
 * Behaviors:
 * 1. dismissOverlays - Cookie banners, modals, popups, newsletter prompts
 * 2. scrollToLoadAll - Aggressive scrolling with lazy-load detection
 * 3. expandAllContent - Accordions, details, FAQs, "read more" links
 * 4. clickAllTabs - Iterate through all tab interfaces
 * 5. navigateCarousels - Click through all carousel/slider slides
 * 6. expandComments - Load all comments in comment sections
 * 7. handleInfiniteScroll - Keep scrolling until no new content
 *
 * Design principles:
 * - Never fail silently - log all actions
 * - Never get stuck - timeouts on everything
 * - Be thorough - no arbitrary limits
 * - Be respectful - don't spam clicks, wait for network
 */

import { Page } from 'puppeteer-core';

// =============================================================================
// Types
// =============================================================================

export interface BehaviorReport {
  behavior: string;
  actionsPerformed: number;
  elementsFound: number;
  errors: string[];
  durationMs: number;
}

export interface BehaviorResult {
  success: boolean;
  behaviors: BehaviorReport[];
  totalDurationMs: number;
  contentHash?: string; // Hash of DOM after all behaviors
  stats: {
    overlaysDismissed: number;
    elementsExpanded: number;
    tabsClicked: number;
    carouselSlides: number;
    scrollDepth: number;
    infiniteScrollPages: number;
  };
}

export interface BehaviorOptions {
  /** Maximum total time for all behaviors (ms) */
  maxTotalTime: number;
  /** Maximum time per individual behavior (ms) */
  maxBehaviorTime: number;
  /** Wait time after each action for network/DOM settle (ms) */
  actionDelay: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Which behaviors to run */
  enabledBehaviors: {
    dismissOverlays: boolean;
    scrollToLoadAll: boolean;
    expandAllContent: boolean;
    clickAllTabs: boolean;
    navigateCarousels: boolean;
    expandComments: boolean;
    infiniteScroll: boolean;
  };
}

const DEFAULT_OPTIONS: BehaviorOptions = {
  maxTotalTime: 120000, // 2 minutes total
  maxBehaviorTime: 30000, // 30 seconds per behavior
  actionDelay: 300, // 300ms between actions
  verbose: true,
  enabledBehaviors: {
    dismissOverlays: true,
    scrollToLoadAll: true,
    expandAllContent: true,
    clickAllTabs: true,
    navigateCarousels: true,
    expandComments: true,
    infiniteScroll: true,
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

function log(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(`[Behaviors] ${message}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNetworkIdle(page: Page, timeout = 2000): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout });
  } catch {
    // Timeout is fine - page might have persistent connections
  }
}

// =============================================================================
// Behavior 1: Dismiss Overlays
// =============================================================================

async function dismissOverlays(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'dismissOverlays',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Dismissing overlays (cookies, modals, popups)...', options.verbose);

  try {
    const dismissed = await page.evaluate(async (actionDelay: number) => {
      let count = 0;
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      // Comprehensive selector list for overlays
      const overlaySelectors = [
        // Cookie consent
        '[class*="cookie"] button[class*="accept"]',
        '[class*="cookie"] button[class*="agree"]',
        '[class*="cookie"] button[class*="allow"]',
        '[class*="cookie"] button[class*="consent"]',
        '[class*="cookie"] button[class*="ok"]',
        '[class*="consent"] button[class*="accept"]',
        '[class*="gdpr"] button[class*="accept"]',
        '#onetrust-accept-btn-handler',
        '.cc-accept', '.cc-allow', '.cc-dismiss',
        '[data-testid="cookie-accept"]',
        '[data-testid="accept-cookies"]',
        'button[aria-label*="Accept"]',
        'button[aria-label*="cookie"]',

        // Generic close buttons on modals
        '[class*="modal"] [class*="close"]',
        '[class*="modal"] button[aria-label="Close"]',
        '[class*="popup"] [class*="close"]',
        '[class*="overlay"] [class*="close"]',
        '[class*="dialog"] [class*="close"]',
        '.modal-close', '.popup-close', '.overlay-close',
        '[data-dismiss="modal"]',
        'button[data-micromodal-close]',

        // Newsletter/subscription popups
        '[class*="newsletter"] [class*="close"]',
        '[class*="subscribe"] [class*="close"]',
        '[class*="signup"] [class*="close"]',
        '[class*="email-capture"] [class*="close"]',

        // Generic dismiss/skip
        'button[class*="dismiss"]',
        'button[class*="skip"]',
        'button[class*="no-thanks"]',
        'button[class*="later"]',
        '[class*="banner"] [class*="close"]',

        // X buttons (common close pattern)
        'button:has(svg[class*="close"])',
        'button:has([class*="icon-close"])',
        '[role="dialog"] button:first-of-type',
      ];

      // Click all matching elements
      for (const selector of overlaySelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of Array.from(elements)) {
            if (el instanceof HTMLElement && el.offsetParent !== null) {
              el.click();
              count++;
              await sleep(actionDelay);
            }
          }
        } catch {
          // Selector failed, continue
        }
      }

      // Press Escape key to close any modals
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);

      // Remove fixed/sticky overlays that might be blocking content
      const overlayElements = document.querySelectorAll('[class*="overlay"], [class*="modal"], [class*="popup"]');
      for (const el of Array.from(overlayElements)) {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute') {
          if (style.zIndex && parseInt(style.zIndex) > 1000) {
            (el as HTMLElement).style.display = 'none';
            count++;
          }
        }
      }

      // Remove any backdrop/overlay divs
      const backdrops = document.querySelectorAll('.modal-backdrop, .overlay-backdrop, [class*="backdrop"]');
      for (const el of Array.from(backdrops)) {
        (el as HTMLElement).style.display = 'none';
        count++;
      }

      return count;
    }, options.actionDelay);

    report.actionsPerformed = dismissed;
    report.elementsFound = dismissed;
    log(`Dismissed ${dismissed} overlays`, options.verbose);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 2: Scroll to Load All Content
// =============================================================================

async function scrollToLoadAll(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'scrollToLoadAll',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Scrolling to load all lazy content...', options.verbose);

  try {
    const scrollResult = await page.evaluate(async (actionDelay: number, maxTime: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      const startTime = Date.now();

      let scrollCount = 0;
      let lastHeight = 0;
      let sameHeightCount = 0;
      const maxSameHeight = 3; // Stop after 3 scrolls with no height change

      // Get all scrollable containers
      const getScrollableElements = (): HTMLElement[] => {
        const elements: HTMLElement[] = [document.documentElement];

        // Find other scrollable containers
        const allElements = document.querySelectorAll('*');
        for (const el of Array.from(allElements)) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
            if ((el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight) {
              elements.push(el as HTMLElement);
            }
          }
        }

        return elements;
      };

      const scrollableElements = getScrollableElements();

      // Scroll each scrollable container
      for (const container of scrollableElements) {
        lastHeight = 0;
        sameHeightCount = 0;

        while (Date.now() - startTime < maxTime) {
          const currentHeight = container.scrollHeight;

          // Scroll down
          container.scrollTo({
            top: container.scrollTop + window.innerHeight,
            behavior: 'smooth'
          });
          scrollCount++;

          await sleep(actionDelay);

          // Check if we've reached the bottom
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
            // At bottom, check if height changed
            if (currentHeight === lastHeight) {
              sameHeightCount++;
              if (sameHeightCount >= maxSameHeight) {
                break; // No more content loading
              }
            } else {
              sameHeightCount = 0;
            }
            lastHeight = currentHeight;

            // Wait for potential lazy load
            await sleep(500);
          }

          // Safety: max 100 scrolls per container
          if (scrollCount > 100) break;
        }

        // Scroll back to top
        container.scrollTo({ top: 0, behavior: 'instant' });
      }

      return {
        scrollCount,
        containersScrolled: scrollableElements.length,
        finalHeight: document.documentElement.scrollHeight
      };
    }, options.actionDelay, options.maxBehaviorTime);

    report.actionsPerformed = scrollResult.scrollCount;
    report.elementsFound = scrollResult.containersScrolled;
    log(`Scrolled ${scrollResult.scrollCount} times across ${scrollResult.containersScrolled} containers`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 3: Expand All Content
// =============================================================================

async function expandAllContent(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'expandAllContent',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Expanding all accordions, details, and read-more elements...', options.verbose);

  try {
    const expandResult = await page.evaluate(async (actionDelay: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      let expanded = 0;
      let found = 0;

      // 1. Expand all <details> elements
      const details = document.querySelectorAll('details:not([open])');
      found += details.length;
      for (const el of Array.from(details)) {
        (el as HTMLDetailsElement).open = true;
        expanded++;
      }

      // 2. Click all aria-expanded="false" elements
      const ariaExpanded = document.querySelectorAll('[aria-expanded="false"]');
      found += ariaExpanded.length;
      for (const el of Array.from(ariaExpanded)) {
        try {
          (el as HTMLElement).click();
          expanded++;
          await sleep(actionDelay / 2);
        } catch { /* ignore */ }
      }

      // 3. Comprehensive accordion selectors
      const accordionSelectors = [
        '.accordion:not(.open):not(.active):not(.expanded)',
        '.accordion-item:not(.open):not(.active)',
        '.accordion-header:not(.open)',
        '.accordion-trigger:not(.open)',
        '[data-toggle="collapse"]:not(.collapsed)',
        '.collapse-trigger',
        '.collapsible-trigger',
        '.expandable:not(.expanded)',
        '.faq-question',
        '.faq-item:not(.open)',
        '[class*="accordion"] [class*="header"]:not(.open)',
        '[class*="accordion"] [class*="title"]:not(.open)',
        '[class*="expand"]:not(.expanded)',
        '[class*="collapse"]:not(.open)',
      ];

      for (const selector of accordionSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          found += elements.length;
          for (const el of Array.from(elements)) {
            try {
              (el as HTMLElement).click();
              expanded++;
              await sleep(actionDelay / 2);
            } catch { /* ignore */ }
          }
        } catch { /* selector invalid */ }
      }

      // 4. "Read more" / "Show more" buttons and links
      const readMoreSelectors = [
        'button[class*="read-more"]',
        'button[class*="show-more"]',
        'button[class*="see-more"]',
        'button[class*="view-more"]',
        'button[class*="load-more"]',
        'a[class*="read-more"]',
        'a[class*="show-more"]',
        'a[class*="see-more"]',
        '[class*="truncate"] + button',
        '[class*="truncate"] + a',
        '[class*="ellipsis"] + button',
        '[class*="ellipsis"] + a',
        'span[class*="more"]',
        '[data-read-more]',
        '[data-show-more]',
        '[data-expand]',
      ];

      for (const selector of readMoreSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          found += elements.length;
          for (const el of Array.from(elements)) {
            try {
              (el as HTMLElement).click();
              expanded++;
              await sleep(actionDelay);
            } catch { /* ignore */ }
          }
        } catch { /* selector invalid */ }
      }

      // 5. Text that looks like "Read more", "Show more", etc.
      const textMatches = ['read more', 'show more', 'see more', 'view more', 'expand', 'show all', 'view all'];
      const allClickables = document.querySelectorAll('button, a, span[role="button"], [onclick]');
      for (const el of Array.from(allClickables)) {
        const text = (el as HTMLElement).innerText?.toLowerCase().trim();
        if (text && textMatches.some(m => text === m || text.startsWith(m + ' '))) {
          found++;
          try {
            (el as HTMLElement).click();
            expanded++;
            await sleep(actionDelay);
          } catch { /* ignore */ }
        }
      }

      // 6. Bootstrap collapse elements
      const collapseElements = document.querySelectorAll('.collapse:not(.show)');
      for (const el of Array.from(collapseElements)) {
        found++;
        (el as HTMLElement).classList.add('show');
        expanded++;
      }

      return { expanded, found };
    }, options.actionDelay);

    report.actionsPerformed = expandResult.expanded;
    report.elementsFound = expandResult.found;
    log(`Expanded ${expandResult.expanded} of ${expandResult.found} expandable elements`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 4: Click All Tabs
// =============================================================================

async function clickAllTabs(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'clickAllTabs',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Clicking through all tab interfaces...', options.verbose);

  try {
    const tabResult = await page.evaluate(async (actionDelay: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      let clicked = 0;
      let found = 0;

      // Find all tab containers
      const tabContainerSelectors = [
        '[role="tablist"]',
        '.tabs',
        '.tab-list',
        '.nav-tabs',
        '.tab-nav',
        '[class*="tabs"]',
        '[class*="tab-container"]',
      ];

      const processedTabs = new Set<HTMLElement>();

      for (const containerSelector of tabContainerSelectors) {
        const containers = document.querySelectorAll(containerSelector);

        for (const container of Array.from(containers)) {
          // Find tabs within this container
          const tabSelectors = [
            '[role="tab"]',
            '.tab',
            '.nav-link',
            '.tab-link',
            '[data-toggle="tab"]',
            '[data-bs-toggle="tab"]',
            'button[class*="tab"]',
            'a[class*="tab"]',
          ];

          for (const tabSelector of tabSelectors) {
            const tabs = container.querySelectorAll(tabSelector);
            found += tabs.length;

            for (const tab of Array.from(tabs)) {
              if (processedTabs.has(tab as HTMLElement)) continue;
              processedTabs.add(tab as HTMLElement);

              try {
                // Skip if already selected
                const isSelected = (tab as HTMLElement).getAttribute('aria-selected') === 'true' ||
                                   (tab as HTMLElement).classList.contains('active') ||
                                   (tab as HTMLElement).classList.contains('selected');

                if (!isSelected) {
                  (tab as HTMLElement).click();
                  clicked++;
                  await sleep(actionDelay);
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      // Also find standalone tab-like navigation
      const standaloneTabSelectors = [
        '.segment-control button',
        '.toggle-group button',
        '.button-group button',
        '[class*="segmented"] button',
      ];

      for (const selector of standaloneTabSelectors) {
        try {
          const buttons = document.querySelectorAll(selector);
          found += buttons.length;
          for (const btn of Array.from(buttons)) {
            if (processedTabs.has(btn as HTMLElement)) continue;
            processedTabs.add(btn as HTMLElement);

            try {
              (btn as HTMLElement).click();
              clicked++;
              await sleep(actionDelay);
            } catch { /* ignore */ }
          }
        } catch { /* selector invalid */ }
      }

      return { clicked, found };
    }, options.actionDelay);

    report.actionsPerformed = tabResult.clicked;
    report.elementsFound = tabResult.found;
    log(`Clicked ${tabResult.clicked} of ${tabResult.found} tabs`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 5: Navigate Carousels
// =============================================================================

async function navigateCarousels(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'navigateCarousels',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Navigating through all carousels and sliders...', options.verbose);

  try {
    const carouselResult = await page.evaluate(async (actionDelay: number, maxTime: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      const startTime = Date.now();
      let slides = 0;
      let carousels = 0;

      // Find carousel containers
      const carouselSelectors = [
        '.carousel',
        '.slider',
        '.swiper',
        '.slick-slider',
        '.owl-carousel',
        '.glide',
        '[class*="carousel"]',
        '[class*="slider"]',
        '[class*="gallery"]',
        '[data-carousel]',
        '[data-slider]',
      ];

      const processedCarousels = new Set<Element>();

      for (const selector of carouselSelectors) {
        try {
          const containers = document.querySelectorAll(selector);

          for (const container of Array.from(containers)) {
            if (processedCarousels.has(container)) continue;
            processedCarousels.add(container);
            carousels++;

            // Find next button
            const nextSelectors = [
              '.carousel-next',
              '.slick-next',
              '.swiper-button-next',
              '.owl-next',
              '.glide__arrow--right',
              '[class*="next"]',
              '[class*="arrow-right"]',
              '[aria-label*="next"]',
              '[aria-label*="Next"]',
              'button[class*="right"]',
            ];

            let nextButton: HTMLElement | null = null;
            for (const nextSel of nextSelectors) {
              const btn = container.querySelector(nextSel);
              if (btn) {
                nextButton = btn as HTMLElement;
                break;
              }
            }

            if (nextButton) {
              // Click through slides (max 20 per carousel)
              const maxSlides = 20;
              let clickCount = 0;
              const seenSlides = new Set<string>();

              while (clickCount < maxSlides && Date.now() - startTime < maxTime) {
                // Get current slide indicator
                const activeSlide = container.querySelector('.active, [aria-current="true"], .slick-current, .swiper-slide-active');
                const slideId = activeSlide?.textContent?.substring(0, 100) || clickCount.toString();

                if (seenSlides.has(slideId) && clickCount > 2) {
                  break; // We've looped back to start
                }
                seenSlides.add(slideId);

                try {
                  nextButton.click();
                  slides++;
                  clickCount++;
                  await sleep(actionDelay);
                } catch {
                  break;
                }
              }
            }

            // Also click dot/indicator navigation
            const dotSelectors = [
              '.carousel-indicators button',
              '.carousel-indicators li',
              '.slick-dots button',
              '.slick-dots li',
              '.swiper-pagination-bullet',
              '.owl-dot',
              '.glide__bullet',
              '[class*="dot"]',
              '[class*="indicator"]',
            ];

            for (const dotSel of dotSelectors) {
              try {
                const dots = container.querySelectorAll(dotSel);
                for (const dot of Array.from(dots)) {
                  try {
                    (dot as HTMLElement).click();
                    slides++;
                    await sleep(actionDelay / 2);
                  } catch { /* ignore */ }
                }
              } catch { /* selector invalid */ }
            }
          }
        } catch { /* selector invalid */ }
      }

      return { slides, carousels };
    }, options.actionDelay, options.maxBehaviorTime);

    report.actionsPerformed = carouselResult.slides;
    report.elementsFound = carouselResult.carousels;
    log(`Navigated ${carouselResult.slides} slides across ${carouselResult.carousels} carousels`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 6: Expand Comments
// =============================================================================

async function expandComments(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'expandComments',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Expanding comment sections...', options.verbose);

  try {
    const commentResult = await page.evaluate(async (actionDelay: number, maxTime: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      const startTime = Date.now();
      let expanded = 0;
      let found = 0;

      // Load more comments buttons
      const loadMoreSelectors = [
        '[class*="comment"] [class*="load-more"]',
        '[class*="comment"] [class*="show-more"]',
        '[class*="comment"] [class*="view-more"]',
        '[class*="replies"] [class*="load"]',
        '[class*="replies"] [class*="show"]',
        '[class*="replies"] [class*="view"]',
        'button[class*="replies"]',
        '[data-load-comments]',
        '[data-show-replies]',
        '.comment-load-more',
        '.load-more-comments',
        '.show-replies',
        '.view-replies',
      ];

      // Keep clicking until no more or timeout
      let lastFound = -1;
      while (Date.now() - startTime < maxTime) {
        let foundThisRound = 0;

        for (const selector of loadMoreSelectors) {
          try {
            const buttons = document.querySelectorAll(selector);
            found += buttons.length;
            foundThisRound += buttons.length;

            for (const btn of Array.from(buttons)) {
              if ((btn as HTMLElement).offsetParent !== null) { // Is visible
                try {
                  (btn as HTMLElement).click();
                  expanded++;
                  await sleep(actionDelay);
                } catch { /* ignore */ }
              }
            }
          } catch { /* selector invalid */ }
        }

        // Also look for "X replies" links
        const replyLinks = document.querySelectorAll('a, button, span[role="button"]');
        for (const el of Array.from(replyLinks)) {
          const text = (el as HTMLElement).innerText?.toLowerCase() || '';
          if (/\d+\s*(replies|comments|responses)/.test(text)) {
            found++;
            foundThisRound++;
            try {
              (el as HTMLElement).click();
              expanded++;
              await sleep(actionDelay);
            } catch { /* ignore */ }
          }
        }

        // Stop if no new elements found
        if (foundThisRound === 0 || foundThisRound === lastFound) {
          break;
        }
        lastFound = foundThisRound;

        await sleep(500); // Wait for comments to load
      }

      return { expanded, found };
    }, options.actionDelay, options.maxBehaviorTime);

    report.actionsPerformed = commentResult.expanded;
    report.elementsFound = commentResult.found;
    log(`Expanded ${commentResult.expanded} comment sections`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Behavior 7: Handle Infinite Scroll
// =============================================================================

async function handleInfiniteScroll(page: Page, options: BehaviorOptions): Promise<BehaviorReport> {
  const startTime = Date.now();
  const report: BehaviorReport = {
    behavior: 'infiniteScroll',
    actionsPerformed: 0,
    elementsFound: 0,
    errors: [],
    durationMs: 0,
  };

  log('Handling infinite scroll...', options.verbose);

  try {
    const scrollResult = await page.evaluate(async (actionDelay: number, maxTime: number) => {
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      const startTime = Date.now();

      let scrollPages = 0;
      let previousHeight = document.documentElement.scrollHeight;
      let noChangeCount = 0;
      const maxNoChange = 5; // Stop after 5 scrolls with no height change

      while (Date.now() - startTime < maxTime && noChangeCount < maxNoChange) {
        // Scroll to bottom
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: 'smooth'
        });

        scrollPages++;

        // Wait for potential content load
        await sleep(actionDelay * 3); // Longer wait for infinite scroll

        const newHeight = document.documentElement.scrollHeight;

        if (newHeight === previousHeight) {
          noChangeCount++;
        } else {
          noChangeCount = 0;
          previousHeight = newHeight;
        }

        // Safety limit
        if (scrollPages > 50) break;
      }

      // Scroll back to top
      window.scrollTo({ top: 0, behavior: 'instant' });

      return {
        scrollPages,
        finalHeight: document.documentElement.scrollHeight
      };
    }, options.actionDelay, options.maxBehaviorTime);

    report.actionsPerformed = scrollResult.scrollPages;
    report.elementsFound = scrollResult.scrollPages;
    log(`Infinite scroll: ${scrollResult.scrollPages} pages, final height ${scrollResult.finalHeight}px`, options.verbose);

    await waitForNetworkIdle(page);

  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run all enabled behaviors on a page to expose hidden content
 * Call this BEFORE taking screenshots, PDFs, or extracting content
 */
export async function runAllBehaviors(
  page: Page,
  customOptions?: Partial<BehaviorOptions>
): Promise<BehaviorResult> {
  const options: BehaviorOptions = { ...DEFAULT_OPTIONS, ...customOptions };
  const totalStartTime = Date.now();

  const result: BehaviorResult = {
    success: true,
    behaviors: [],
    totalDurationMs: 0,
    stats: {
      overlaysDismissed: 0,
      elementsExpanded: 0,
      tabsClicked: 0,
      carouselSlides: 0,
      scrollDepth: 0,
      infiniteScrollPages: 0,
    },
  };

  console.log('[Behaviors] Starting comprehensive page behavior extraction...');

  try {
    // 1. First, dismiss any overlays blocking content
    if (options.enabledBehaviors.dismissOverlays) {
      const report = await dismissOverlays(page, options);
      result.behaviors.push(report);
      result.stats.overlaysDismissed = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 2. Initial scroll to load lazy content
    if (options.enabledBehaviors.scrollToLoadAll) {
      const report = await scrollToLoadAll(page, options);
      result.behaviors.push(report);
      result.stats.scrollDepth = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 3. Expand all accordions, details, read-more
    if (options.enabledBehaviors.expandAllContent) {
      const report = await expandAllContent(page, options);
      result.behaviors.push(report);
      result.stats.elementsExpanded = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 4. Click through all tabs
    if (options.enabledBehaviors.clickAllTabs) {
      const report = await clickAllTabs(page, options);
      result.behaviors.push(report);
      result.stats.tabsClicked = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 5. Navigate all carousels
    if (options.enabledBehaviors.navigateCarousels) {
      const report = await navigateCarousels(page, options);
      result.behaviors.push(report);
      result.stats.carouselSlides = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 6. Expand comment sections
    if (options.enabledBehaviors.expandComments) {
      const report = await expandComments(page, options);
      result.behaviors.push(report);
      if (report.errors.length) result.success = false;
    }

    // 7. Handle infinite scroll (final pass)
    if (options.enabledBehaviors.infiniteScroll) {
      const report = await handleInfiniteScroll(page, options);
      result.behaviors.push(report);
      result.stats.infiniteScrollPages = report.actionsPerformed;
      if (report.errors.length) result.success = false;
    }

    // 8. Final scroll back to top and wait for network
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await waitForNetworkIdle(page);

  } catch (error) {
    result.success = false;
    console.error('[Behaviors] Fatal error:', error);
  }

  result.totalDurationMs = Date.now() - totalStartTime;

  console.log(`[Behaviors] Complete in ${result.totalDurationMs}ms:`, {
    overlaysDismissed: result.stats.overlaysDismissed,
    elementsExpanded: result.stats.elementsExpanded,
    tabsClicked: result.stats.tabsClicked,
    carouselSlides: result.stats.carouselSlides,
    infiniteScrollPages: result.stats.infiniteScrollPages,
  });

  return result;
}

/**
 * Quick behavior run - faster but less thorough
 * Use for quick captures where time is critical
 */
export async function runQuickBehaviors(page: Page): Promise<BehaviorResult> {
  return runAllBehaviors(page, {
    maxTotalTime: 30000, // 30 seconds
    maxBehaviorTime: 10000, // 10 seconds per behavior
    actionDelay: 150, // Faster actions
    enabledBehaviors: {
      dismissOverlays: true,
      scrollToLoadAll: true,
      expandAllContent: true,
      clickAllTabs: false, // Skip for speed
      navigateCarousels: false, // Skip for speed
      expandComments: false, // Skip for speed
      infiniteScroll: false, // Skip for speed
    },
  });
}

/**
 * Thorough behavior run - comprehensive but slower
 * Use for important archival captures
 */
export async function runThoroughBehaviors(page: Page): Promise<BehaviorResult> {
  return runAllBehaviors(page, {
    maxTotalTime: 180000, // 3 minutes
    maxBehaviorTime: 45000, // 45 seconds per behavior
    actionDelay: 400, // More careful
    enabledBehaviors: {
      dismissOverlays: true,
      scrollToLoadAll: true,
      expandAllContent: true,
      clickAllTabs: true,
      navigateCarousels: true,
      expandComments: true,
      infiniteScroll: true,
    },
  });
}
