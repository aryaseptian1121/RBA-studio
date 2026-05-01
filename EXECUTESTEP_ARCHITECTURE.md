╔═══════════════════════════════════════════════════════════════════════════╗
║                   EXECUTESTEP FUNCTION - ARCHITECTURE GUIDE               ║
║                                                                           ║
║  A comprehensive refactoring of runWorkflow() into modular executeStep()  ║
╚═══════════════════════════════════════════════════════════════════════════╝

OVERVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The executeStep() function extracts ALL step-handling logic from runWorkflow
and centralizes it into a single, testable, reusable function.

Current State:     runWorkflow() contains 265 lines (2050-2315) of switch logic
Refactored State:  executeStep() handles all cases cleanly
Benefit:           Testable, maintainable, extensible


KEY ARCHITECTURE DECISIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. FIVE CORE SECTIONS (always in this order)
   ├─ SECTION 1: INITIALIZATION & LOGGING
   │  └─ Set up step metadata, timestamps, logging entry
   ├─ SECTION 2: VARIABLE SUBSTITUTION
   │  └─ Replace all \ with actual values
   ├─ SECTION 3: SWITCH STATEMENT (main router)
   │  └─ Branch to appropriate handler per step.type
   ├─ SECTION 4: SUCCESS PATH
   │  └─ Mark complete, log, return
   └─ SECTION 5: ERROR HANDLING
      └─ Catch exceptions, log, decide to continue/retry/throw

2. MULTIPLE HANDLER PATTERNS
   ├─ Pattern A: Simple (delay, screenshot, markers)
   ├─ Pattern B: Selector-based (click, type, wait)
   ├─ Pattern C: Data extraction (extract-text, api-request)
   ├─ Pattern D: Conditional (if-condition) - returns conditionResult
   ├─ Pattern E: Mobile (mobile-tap, mobile-swipe)
   └─ Pattern F: File operations (read-csv, write-csv)

3. RETURN VALUE SEMANTICS
   ├─ if-condition: MUST return { conditionResult: boolean }
   └─ Other steps: return { conditionResult: null }

4. STATUS TRACKING LIFECYCLE
   └─ pending → running → (success | error)

5. COMPREHENSIVE LOGGING WITH PREFIXES
   └─ [EXECUTE_STEP], [STEP_<TYPE>], [STEP_SUCCESS], [STEP_ERROR]


FILES PROVIDED (3 documents)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 executeStep_skeleton.js (364 lines)
   ├─ Complete function skeleton with all cases defined
   ├─ Comments explaining each section
   ├─ Empty case handlers with logging setup
   ├─ Patterns for common operations
   ├─ Error handling wrapper
   └─ Reference helper functions needed

   USE THIS: As your starting template - copy and fill in the logic

📄 executeStep_implementation_guide.js (326 lines)
   ├─ Detailed explanation of each section's purpose
   ├─ Step-by-step implementation checklist
   ├─ 6 concrete handler patterns with complete code
   ├─ Validation examples for each pattern
   ├─ Error handling strategies
   ├─ Dependencies and helper functions
   └─ Suggested implementation order

   USE THIS: As reference while implementing each case

📄 executeStep_flow_diagram.txt (213 lines)
   ├─ ASCII flowchart of execution flow
   ├─ Switch router showing all case types
   ├─ Variable storage/retrieval flow
   ├─ Error handling decision tree
   ├─ Step status lifecycle
   ├─ Logging structure
   └─ Key variables reference

   USE THIS: To understand the big picture and architecture


RECOMMENDED IMPLEMENTATION ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 1: Foundation (Copy & Setup)
  1. Copy executeStep_skeleton.js to your project
  2. Implement SECTION 1 (initialization)
  3. Implement SECTION 2 (interpolation setup)
  4. Implement SECTION 4 (success path)
  5. Implement SECTION 5 (error handling)
  ✓ Test: Basic flow without any step handlers

Phase 2: Control Flow (Low-risk cases)
  6. Implement: start, delay
  7. Implement: repeat-start, repeat-end
  ✓ Test: Can execute timing-based steps

Phase 3: Web Interactions (Core functionality)
  8. Implement: open-browser, close-browser
  9. Implement: click, tap, type-into
  10. Implement: wait-element, scroll-page
  11. Implement: screenshot-page
  ✓ Test: Web automation flows

Phase 4: Data & Extraction (Report generation)
  12. Implement: extract-text, extract-table
  13. Implement: read-csv, write-csv
  ✓ Test: Data extraction and storage

Phase 5: API & Mobile (Advanced features)
  14. Implement: api-request
  15. Implement: mobile-tap, mobile-swipe
  ✓ Test: API calls and mobile interactions

Phase 6: Advanced Logic (Conditional execution)
  16. Implement: if-condition (special handling)
  17. Implement: retry-logic
  ✓ Test: Conditional branching and retries

Phase 7: Integration (Connect to workflow)
  18. Refactor runWorkflow() to call executeStep()
  19. Remove old switch logic from runWorkflow()
  20. Test full workflow execution
  ✓ Production ready


INTEGRATION WITH RUNWORKFLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Current runWorkflow pattern (lines 2050-2315):
  for (let step of workflow.steps) {
    switch(step.type) {
      case 'click': { /* 20+ lines */ }
      case 'type': { /* 20+ lines */ }
      // ... 265 lines total
    }
  }

Refactored pattern (using executeStep):
  for (let step of workflow.steps) {
    const result = await executeStep(step, device);
    if (step.type === 'if-condition' && !result.conditionResult) {
      // Skip next steps until repeat-end
    }
  }

BEFORE (in runWorkflow):
  ├─ 265 lines of switch logic
  ├─ Hard to test individual steps
  ├─ Hard to add new step types
  ├─ Error handling scattered
  └─ Difficult to understand flow

AFTER (using executeStep):
  ├─ 20 lines calling executeStep()
  ├─ Each step type tested independently
  ├─ New step types added in one place
  ├─ Centralized error handling
  ├─ Clear separation of concerns
  └─ Much more maintainable


FUNCTION SIGNATURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function executeStep(step, device) {
  // step: { id, type, selector, url, text, condition, ... }
  // device: 'emulator-5554' or 'device-id'
  // Returns: { conditionResult: boolean|null }
}

Parameters:
  step = {
    id: string                    // Unique identifier
    type: string                  // Step type (click, type, etc)
    status: 'pending'            // Updated to 'running'/'success'/'error'
    selector: string             // CSS selector for web elements
    url: string                  // URL for navigation/API
    text: string                 // Text for typing/matching
    condition: string            // JavaScript condition to evaluate
    x, y: number                 // Mobile tap coordinates
    variableName: string         // Where to store extracted data
    timeout: number              // Max execution time (ms)
    onError: 'throw'|'continue'|'retry'  // Error handling strategy
    ... additional type-specific fields
  }

  device = 'emulator-5554'       // ADB device identifier

Returns:
  {
    conditionResult: boolean | null
    // For if-condition: { conditionResult: true/false }
    // For others: { conditionResult: null }
  }


EXAMPLES OF HANDLER IMPLEMENTATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Example 1: SIMPLE DELAY
──────────────────────
case 'delay': {
  const durationMs = step.duration || 1000;
  logger.info(\[STEP_DELAY] Waiting \ms\);
  await new Promise(resolve => setTimeout(resolve, durationMs));
  break;
}

Example 2: CLICK ELEMENT
─────────────────────────
case 'click': {
  const selector = interpolate(step.selector, variables);
  logger.info(\[STEP_CLICK] Selector: \\);
  if (!selector) throw new Error('Selector required');
  
  await page.click(selector, { timeout: step.timeout || 5000 });
  
  if (step.delayAfter) {
    await new Promise(resolve => setTimeout(resolve, step.delayAfter));
  }
  break;
}

Example 3: EXTRACT TEXT
─────────────────────────
case 'extract-text': {
  const selector = interpolate(step.selector, variables);
  logger.info(\[STEP_EXTRACT_TEXT] Selector: \\);
  if (!selector) throw new Error('Selector required');
  
  const text = await page.\(selector, el => el.innerText);
  
  if (step.variableName) {
    variables[step.variableName] = text;
    logger.info(\[STEP_EXTRACT_TEXT] Stored as: \\);
  }
  break;
}

Example 4: IF CONDITION (SPECIAL)
──────────────────────────────────
case 'if-condition': {
  const condition = interpolate(step.condition, variables);
  logger.info(\[STEP_IF_CONDITION] Evaluating: \\);
  
  const result = evaluateCondition(condition, variables);
  logger.info(\[STEP_IF_CONDITION] Result: \\);
  
  step.status = 'success';
  step.endTime = new Date();
  
  return { conditionResult: result };  // RETURN, don't break!
}

Example 5: API REQUEST
──────────────────────
case 'api-request': {
  const url = interpolate(step.url, variables);
  const method = step.method || 'GET';
  logger.info(\[STEP_API_REQUEST] \ \\);
  
  if (!url) throw new Error('URL required');
  
  const response = await fetch(url, {
    method,
    headers: step.headers || {},
    body: step.body ? JSON.stringify(step.body) : undefined
  });
  
  const data = await response.json();
  
  if (step.variableName) {
    variables[step.variableName] = data;
    logger.info(\[STEP_API_REQUEST] Response stored as: \\);
  }
  break;
}

Example 6: MOBILE TAP
─────────────────────
case 'mobile-tap': {
  logger.info(\[STEP_MOBILE_TAP] Device: \, X: \, Y: \\);
  if (!device) throw new Error('Device required');
  if (step.x === undefined || step.y === undefined) {
    throw new Error('Coordinates (x, y) required');
  }
  
  await executeAdbCommand(device, \shell input tap \ \\);
  
  if (step.delayAfter) {
    await new Promise(resolve => setTimeout(resolve, step.delayAfter));
  }
  break;
}


HELPER FUNCTIONS NEEDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You must implement/have these helpers:

1. interpolate(string, variables)
   └─ Replaces \ with variables[varName]
   └─ Called before using: selector, url, text, condition

2. interpolateObject(object, variables)
   └─ Recursively interpolates all strings in an object
   └─ Used for headers, body, etc.

3. evaluateCondition(conditionString, variables)
   └─ Evaluates JavaScript condition: \"variables['x'] > 10\"
   └─ Returns boolean
   └─ Must be safe (sandboxed) if user-provided

4. executeAdbCommand(device, command)
   └─ Executes ADB command on device
   └─ Used for mobile interactions

5. logger (with .info, .warn, .error methods)
   └─ Winston, Pino, or similar logging library

6. page (Puppeteer page object)
   └─ From: const page = await browser.newPage()
   └─ Used for web automation


ERROR HANDLING STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The function catches exceptions and decides action based on step.onError:

step.onError = 'throw' (DEFAULT)
  └─ Set status = 'error'
  └─ Log error
  └─ Throw exception (workflow stops)

step.onError = 'continue'
  └─ Set status = 'error'
  └─ Log warning
  └─ Return null (workflow continues with next step)

step.onError = 'retry'
  └─ Increment retryCount
  └─ If retries < maxAttempts: recursively call executeStep()
  └─ If retries exhausted: throw exception


TESTING STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Test each phase independently:

Phase 1 (Foundation):
  test('Should initialize step and log entry', async () => {
    const result = await executeStep(mockStep, mockDevice);
    expect(mockStep.status).toBe('running');
  });

Phase 2 (Delay):
  test('Should wait for specified duration', async () => {
    const start = Date.now();
    await executeStep({ type: 'delay', duration: 100 }, null);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

Phase 3 (Click):
  test('Should click element by selector', async () => {
    const mockPage = { click: jest.fn() };
    await executeStep({ 
      type: 'click', 
      selector: '.button' 
    }, null);
    expect(mockPage.click).toHaveBeenCalledWith('.button', expect.any(Object));
  });

And so on for each phase...


NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ✅ Review this document and the 3 supporting files
2. ✅ Understand the 5-section architecture
3. ✅ Plan implementation phases (Phase 1-7)
4. ✅ Copy skeleton.js to your project
5. ⏳ Implement SECTION 1-5 (foundation)
6. ⏳ Implement handlers by phase
7. ⏳ Test each phase
8. ⏳ Integrate with runWorkflow()
9. ⏳ Full workflow testing
10. ⏳ Production deployment

