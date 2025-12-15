---
name: machinelogic
description: Complete planning and implementation workflow for ML and AI integration in Abandoned Archive. Use when adding image tagging, captioning, object detection, OCR, embeddings, or any ML/AI features. Handles research (Apple vs Google vs open source), hardware analysis, LiteLLM configuration, implementation planning, coding, testing, and scoring. Triggers on "add AI", "add ML", "image tagging", "auto-tag", "integrate LLM", "vision model", or any machine learning integration request.
---

# MachineLogic: ML/AI Integration Workflow

Complete planning-to-deployment workflow for ML and AI integration in Abandoned Archive.

## Workflow Overview

```
PHASE 1: Discovery      → Understand the ML task, gather requirements
PHASE 2: Research       → Compare solutions (Apple vs Google vs Open Source)
PHASE 3: Hardware       → Scan systems, recommend model sizes
PHASE 4: Plan           → Create detailed implementation guide
PHASE 5: Audit Plan     → Verify against CLAUDE.md, task requirements, best practices
PHASE 6: Implement      → Code to the guide
PHASE 7: Audit Code     → Verify code matches guide
PHASE 8: Test           → Real-world testing with user data
PHASE 9: Score          → Rate implementation, suggest improvements
```

**Gate checkpoints are optional** — only pause for user approval when required or when clarification is needed.

---

## PHASE 1: Discovery

Identify the ML task type and gather requirements through conversation.

### Task Taxonomy

Determine which category applies:

| Task | Description | Example Use in Abandoned Archive |
|------|-------------|----------------------------------|
| **Image Classification** | Categorize entire images | "abandoned factory", "hospital", "school" |
| **Object Detection** | Find/locate objects in images | Detect machinery, furniture, signs |
| **Image Captioning** | Generate natural language descriptions | "A decaying hospital corridor with peeling paint" |
| **OCR** | Extract text from images | Read signs, documents, graffiti |
| **Embeddings** | Vector representations for similarity | Find visually similar locations |
| **Face Detection** | Detect faces (not identify) | Privacy blurring workflow |

### Discovery Questions

Ask only what's needed:

1. **What problem are you solving?** (don't assume — let user describe)
2. **What's the expected input?** (single images, batches, video frames?)
3. **What output format?** (tags, descriptions, JSON, database fields?)
4. **Quality vs speed tradeoff?** (archive work = quality first)
5. **Offline requirement?** (must work without internet?)

**Continue to Phase 2 when task type and requirements are clear.**

---

## PHASE 2: Research

Research the best solution using the comparison framework.

### Research Requirements

All recommendations must meet these criteria:

1. **Accurate Results** — Quality over quantity
2. **Battle Tested** — Well documented, proven in production
3. **Actively Supported** — Bonus points for active maintenance
4. **Usable Results** — Output must integrate with Abandoned Archive data model

### Comparison Framework

For each ML task, compare THREE approaches:

| Approach | What to Evaluate |
|----------|------------------|
| **Apple (CoreML/Vision)** | Native macOS/iOS, optimized for Apple Silicon |
| **Google (ML Kit/MediaPipe)** | Cross-platform, well-documented |
| **Open Source Champion** | Best community solution (check Immich, PhotoPrism, etc.) |

### Research Template

```markdown
## [Task Name] Research

### Apple Implementation
- Framework: [CoreML/Vision/etc]
- Models available: [list]
- Accuracy: [benchmark if available]
- macOS integration: [native/requires bridge]
- Docs: [URL]

### Google Implementation
- Framework: [ML Kit/MediaPipe/etc]
- Models available: [list]
- Accuracy: [benchmark if available]
- Electron integration: [native/WASM/subprocess]
- Docs: [URL]

### Open Source Champion: [Name]
- Used by: [Immich/PhotoPrism/etc]
- Model: [specific model name]
- Why it wins: [specific reasons]
- Integration method: [ONNX/native/API]
- Docs: [URL]

### Recommendation
[Winner] because [specific reasons tied to Abandoned Archive requirements]

### LLM Enhancement Path
How results flow to LiteLLM for enhancement:
- Raw output: [what the ML model produces]
- Enhancement prompt: [how LLM improves/verifies results]
- Final output: [what gets stored in database]
```

### Research Sources

Web search for:
- `[task] benchmark comparison 2024`
- `Immich [task] implementation`
- `PhotoPrism [task] model`
- `Apple Vision framework [task]`
- `[task] ONNX model accuracy`

**Continue to Phase 3 when recommendation is selected.**

---

## PHASE 3: Hardware Analysis

Scan available hardware and recommend optimal configuration.

### Hardware Detection Script

Run on each available machine:

```bash
# System info
echo "=== SYSTEM ==="
uname -a
 
# macOS specific
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "=== APPLE SILICON ==="
    sysctl -n machdep.cpu.brand_string
    system_profiler SPHardwareDataType | grep -E "Chip|Memory|Cores"
    
    echo "=== GPU ==="
    system_profiler SPDisplaysDataType | grep -E "Chipset|VRAM|Metal"
fi

# Linux specific
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "=== CPU ==="
    lscpu | grep -E "Model name|CPU\(s\)|Thread"
    
    echo "=== RAM ==="
    free -h
    
    echo "=== GPU ==="
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv 2>/dev/null || echo "No NVIDIA GPU"
    
    # AMD
    rocm-smi 2>/dev/null || echo "No ROCm"
fi

# Python GPU support
echo "=== PYTHON GPU SUPPORT ==="
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}'); print(f'MPS: {torch.backends.mps.is_available()}')" 2>/dev/null || echo "PyTorch not installed"
```

### Model Size Recommendations

Based on hardware, recommend the largest model the system can handle:

| GPU VRAM | Recommended Quantization | Example Models |
|----------|-------------------------|----------------|
| 8GB | Q4_K_M | 7B models |
| 16GB | Q6_K or Q8 | 13B-20B models |
| 24GB+ | Q8 or FP16 | 32B+ models |
| Apple M1/M2/M3 | Use unified memory calculation | Metal-optimized |

### LLM Serving Recommendation

For local LLM serving, evaluate:
- **Ollama** — Simplest setup, good for development
- **llama.cpp** — Most flexible, best performance tuning
- **vLLM** — Best for high-throughput serving

**All LLM calls route through LiteLLM** — never hardwire a specific provider.

**Continue to Phase 4 when hardware is analyzed and model sizes selected.**

---

## PHASE 4: Implementation Plan

Create a detailed implementation guide written for a less experienced coder.

### Plan Document Structure

Create `/docs/ml-implementation-guides/[feature-name].md`:

```markdown
# [Feature Name] Implementation Guide

## Overview
- **Task**: [what this does]
- **ML Model**: [selected model]
- **LLM Enhancement**: [how LiteLLM improves results]
- **Target Hardware**: [where this runs]

## Prerequisites
- [ ] Dependencies installed
- [ ] LiteLLM configured
- [ ] Test data available

## Architecture

### Data Flow
[Diagram or description of how data flows]

### File Changes
| File | Change Type | Description |
|------|-------------|-------------|
| `src/main/services/...` | New | ML inference service |
| `src/shared/types/...` | Modify | Add new types |
| etc. | | |

## Step-by-Step Implementation

### Step 1: [First Step]
**Why**: [explain reasoning]
**What**: [specific changes]

```typescript
// Example code with comments explaining each part
```

### Step 2: [Second Step]
[continue pattern]

## Expected Results

### Success Criteria
- [ ] [Specific measurable outcome]
- [ ] [Performance target]
- [ ] [Accuracy target]

### Test Cases
| Input | Expected Output |
|-------|-----------------|
| [test image 1] | [expected tags/caption] |
| [test image 2] | [expected tags/caption] |

## Troubleshooting
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| [problem] | [cause] | [solution] |
```

**Continue to Phase 5 when plan document is complete.**

---

## PHASE 5: Audit Plan

Verify the plan before coding begins.

### Audit Checklist

#### vs Original Task Requirements
- [ ] Solves the stated problem
- [ ] Meets accuracy requirements
- [ ] Handles edge cases identified in discovery
- [ ] Output format matches Abandoned Archive data model

#### vs CLAUDE.md
- [ ] Follows project architecture patterns
- [ ] Uses established IPC patterns
- [ ] Matches existing service structure
- [ ] Follows error handling conventions
- [ ] Adheres to TypeScript conventions

#### vs Dependency Best Practices
- [ ] Dependencies are well-maintained
- [ ] No known security vulnerabilities
- [ ] License compatible (MIT/Apache preferred)
- [ ] Minimal dependency footprint
- [ ] Version pinned appropriately

#### vs LiteLLM Integration
- [ ] All LLM calls route through LiteLLM
- [ ] Model aliases used (not hardcoded model names)
- [ ] Fallback behavior defined
- [ ] Error handling for LLM failures

### Audit Output

```markdown
## Plan Audit Results

### Passed
- [x] [item]

### Failed (Must Fix)
- [ ] [item] — [what needs to change]

### Warnings (Consider)
- [item] — [suggestion]

### Fixes Applied
- [change made]
```

**Continue to Phase 6 when audit passes.**

---

## PHASE 6: Implementation

Code to the guide — follow it step by step.

### Implementation Rules

1. **Follow the guide literally** — Don't improvise
2. **One step at a time** — Complete each step before moving on
3. **Commit messages reference guide** — "Implement Step 3: Add ML service"
4. **Test as you go** — Don't wait until the end

### LiteLLM Integration Pattern

All LLM calls use this pattern:

```typescript
// src/main/services/ai/litellm-client.ts

interface LiteLLMConfig {
  baseUrl: string;  // Default: http://localhost:4000
  modelAlias: string;  // e.g., "local-vlm", "local-llm"
}

async function callLLM(
  prompt: string,
  options: { model?: string; images?: string[] }
): Promise<string> {
  // Route through LiteLLM proxy
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model || 'local-llm',
      messages: [{ role: 'user', content: prompt }],
      // images handled per LiteLLM vision docs
    }),
  });
  // ... handle response
}
```

**Continue to Phase 7 when implementation is complete.**

---

## PHASE 7: Audit Code

Verify code matches the implementation guide.

### Code Audit Checklist

- [ ] Every step in guide has corresponding code
- [ ] Code matches guide's patterns (not improvised alternatives)
- [ ] All TODO comments resolved
- [ ] No hardcoded values that should be configurable
- [ ] Error handling matches guide
- [ ] Types match guide's definitions

### Discrepancy Handling

If code differs from guide:

1. **Guide was wrong** → Update guide, document why
2. **Code deviated** → Fix code to match guide
3. **Better approach found** → Update both guide and code, document reasoning

**Continue to Phase 8 when code audit passes.**

---

## PHASE 8: Real-World Testing

Test with actual user data.

### Pre-Test Checklist

Ask user:
- [ ] Test data location (folder path)
- [ ] Expected results for sample images (ground truth)
- [ ] Any edge cases to specifically test
- [ ] Performance requirements (images/second)

### Test Protocol

```markdown
## Test Run: [Date]

### Environment
- Machine: [hardware]
- Model: [model name and quantization]
- LiteLLM config: [relevant settings]

### Test Cases

| Image | Expected | Actual | Pass/Fail | Notes |
|-------|----------|--------|-----------|-------|
| test1.jpg | [expected] | [actual] | ✅/❌ | |
| test2.jpg | [expected] | [actual] | ✅/❌ | |

### Performance
- Images processed: [n]
- Total time: [duration]
- Average per image: [duration]
- Memory peak: [MB]

### Issues Found
1. [issue description]
```

**Continue to Phase 9 when testing is complete.**

---

## PHASE 9: Scoring & Recommendations

Rate the implementation and suggest improvements.

### Scoring Rubric

| Dimension | Weight | Score (1-10) | Notes |
|-----------|--------|--------------|-------|
| **Accuracy** | 30% | | Results match expectations |
| **Performance** | 20% | | Speed meets requirements |
| **Code Quality** | 20% | | Clean, maintainable, documented |
| **Guide Adherence** | 15% | | Implementation matches plan |
| **Integration** | 15% | | Works well with existing codebase |

**Final Score**: `(Accuracy×0.3) + (Performance×0.2) + (Quality×0.2) + (Adherence×0.15) + (Integration×0.15)`

### Score Interpretation

| Score | Meaning |
|-------|---------|
| 9-10 | Production ready |
| 7-8 | Good, minor improvements possible |
| 5-6 | Functional, needs refinement |
| <5 | Significant issues, revisit earlier phases |

### Recommendations Format

```markdown
## Implementation Score: [X.X]/10

### Strengths
- [what worked well]

### Improvements Required
1. [Critical] [issue] — [suggested fix]
2. [Important] [issue] — [suggested fix]

### Future Enhancements
- [optimization opportunity]
- [feature extension]

### Lessons Learned
- [what to do differently next time]
```

---

## References

- `references/ml-tasks.md` — Detailed ML task specifications and model options
- `references/litellm-config.md` — LiteLLM configuration patterns
- `references/hardware-matrix.md` — Hardware compatibility and model sizing

---

## AI Source Attribution

All AI-generated content must include source attribution:

```typescript
interface AIResult {
  content: string;
  source: {
    model: string;        // e.g., "qwen2-vl:32b"
    provider: string;     // e.g., "ollama" (via LiteLLM)
    timestamp: Date;
    confidence?: number;  // if model provides it
  };
  safetyCheck: {
    reviewed: boolean;
    flags?: string[];
  };
}
```

Display attribution in UI per Braun design guidelines.
