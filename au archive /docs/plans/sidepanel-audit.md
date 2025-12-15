# Side Panel Plan Audit

## Audit Against Original Goal

**Goal Statement:**
> Archive Websites into Abandoned Archive Project - A premium archive app. Works with sites that requires logins like Facebook, and other sites that would have memories, old photos, etc.
> Right click add to new location, recent locations (updates), SEARCH (autofills)

### Goal Checklist

| Requirement | Plan Addresses? | Notes |
|-------------|-----------------|-------|
| Archive websites | ✅ Yes | Bookmarks saved to database with URL/title |
| Login-required sites (Facebook) | ✅ Yes | Ungoogled Chromium persists session in profile |
| Add to NEW location | ✅ Yes | Phase 2 adds `POST /api/location` + inline form |
| Recent locations (updates) | ✅ Yes | WebSocket pushes location updates in real-time |
| Search with autofill | ✅ Yes | Search input with autocomplete dropdown |
| Premium experience | ✅ Yes | Side panel = persistent, always-visible companion |

### Gap Analysis
| Gap | Severity | Resolution |
|-----|----------|------------|
| No page archiving (full HTML save) | Low | Out of scope for this phase, future Phase 5 |
| No thumbnail capture in plan | Medium | Already exists in background.js, needs wiring to panel |

---

## Audit Against CLAUDE.md Rules

### Development Rules Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| **Scope Discipline** | ✅ PASS | Only implements bookmark panel as requested |
| **Archive-First** | ✅ PASS | Serves research workflow - save sources while browsing |
| **Prefer Open Source** | ✅ PASS | Chrome Side Panel API (native), ws package (MIT) |
| **Offline-First** | ⚠️ PARTIAL | HTTP works offline, but WebSocket is online-only |
| **One Script = One Function** | ✅ PASS | Separate files: sidepanel.js, background.js, websocket-server.ts |
| **No AI in Docs** | ✅ PASS | No AI mentions in UI copy |
| **Keep It Simple** | ✅ PASS | ~800 LOC total, minimal abstraction |
| **Binary Dependencies Welcome** | N/A | No new binaries needed |

### Offline-First Concern
**Issue:** WebSocket requires network connection to app (localhost).

**Resolution:** This is acceptable because:
1. The Side Panel connects to localhost (same machine), not internet
2. HTTP fallback exists if WebSocket fails
3. "Offline" in CLAUDE.md refers to internet connectivity, not IPC

### Do Not Rules Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| Invent new features beyond task | ✅ PASS | Side panel was explicitly requested |
| Bypass hashing contract | N/A | Bookmarks don't use hashing |
| Remove/rename migrations | ✅ PASS | No migration changes |
| Leak local archive data | ✅ PASS | All data stays on localhost |
| Add third-party SDKs without license | ⚠️ CHECK | `ws` package needs license verification |
| Mention AI in UI | ✅ PASS | No AI mentions |
| Leave TODOs | ✅ PASS | Plan specifies complete implementation |

### License Check Needed
**Action Required:** Verify `ws` package license before implementation.
```
ws: MIT License (✅ acceptable)
```

### Critical Gotchas Check

| Gotcha | Status | Notes |
|--------|--------|-------|
| Preload CommonJS | N/A | Extension code, not Electron preload |
| Database migrations only | ✅ PASS | No schema changes in plan |
| Ownership pledge | ✅ PASS | All data stays local |

---

## Audit Against Best Practices

### Chrome Extension Best Practices

| Practice | Status | Notes |
|----------|--------|-------|
| Manifest V3 compliant | ✅ PASS | Uses service worker, modern APIs |
| Minimal permissions | ✅ PASS | Only activeTab, storage, contextMenus, sidePanel |
| No remote code execution | ✅ PASS | All code bundled locally |
| Graceful degradation | ✅ PASS | Falls back to popup if sidePanel unavailable |
| Error handling | ✅ PASS | Plan includes offline/error states |

### WebSocket Best Practices

| Practice | Status | Notes |
|----------|--------|-------|
| Reconnect with backoff | ✅ PASS | Plan specifies reconnect logic |
| Heartbeat/ping-pong | ✅ PASS | Plan includes heartbeat |
| Connection status UI | ✅ PASS | Green/amber/red indicator in header |
| Message validation | ⚠️ ADD | Should validate incoming JSON |

### UX Best Practices

| Practice | Status | Notes |
|----------|--------|-------|
| Keyboard navigation | ⚠️ ADD | Plan should include Enter to save |
| Loading states | ⚠️ ADD | Plan should specify loading spinners |
| Error messages | ✅ PASS | Status indicator, error states mentioned |
| Responsive to panel width | ✅ PASS | 300px fixed, designed for narrow |

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Mitigation in Plan? |
|------|------------|---------------------|
| Side Panel API not supported | Low | ✅ Yes - popup fallback |
| WebSocket port conflict | Medium | ⚠️ Partial - needs configurable port |
| Chrome 114+ requirement | Low | ✅ Yes - we bundle Chromium |

### Security Risks

| Risk | Likelihood | Mitigation in Plan? |
|------|------------|---------------------|
| Other localhost apps hit API | Low | ⚠️ No - consider auth token |
| WebSocket hijacking | Low | ⚠️ No - localhost only mitigates |

---

## Recommended Plan Amendments

### High Priority
1. **Add keyboard shortcut handling** - Enter key to save from search field
2. **Add loading states** - Spinner while searching, saving
3. **Add message validation** - Validate WebSocket JSON before processing

### Medium Priority
4. **Consider simple auth token** - Prevent other localhost apps from hitting API
5. **Make WebSocket port configurable** - Fallback if 47124 is in use

### Low Priority
6. **Add thumbnail display** - Show captured screenshots in session history
7. **Add bulk save** - Select multiple tabs to bookmark at once (future)

---

## Audit Verdict

| Category | Score | Notes |
|----------|-------|-------|
| Goal Alignment | 95% | Missing page archive (out of scope) |
| CLAUDE.md Compliance | 98% | License check needed for `ws` |
| Best Practices | 90% | Add keyboard nav, loading states |
| **Overall** | **94%** | Ready for implementation with minor amendments |

---

## Approval Questions for User

Before proceeding:

1. **Location types for "New Location" form:**
   - Just name + state? Or include type dropdown (hospital, asylum, factory, etc.)?

2. **Theme colors:**
   - Match Electron app dark theme exactly?
   - Or custom extension theme?

3. **Session history persistence:**
   - Memory only (clears when panel closes)?
   - localStorage (persists across sessions)?

4. **WebSocket vs HTTP-only:**
   - Confirm WebSocket is worth the complexity?
   - Or start with HTTP polling and add WebSocket later?
