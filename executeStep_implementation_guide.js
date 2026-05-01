/**
 * EXECUTESTEP IMPLEMENTATION GUIDE
 * ================================
 * Detailed guidance for implementing each section
 */

// ================================================
// FUNCTION SIGNATURE
// ================================================
async function executeStep(step, device) {
  // Parameters:
  // - step: {
  //     id: string (unique identifier)
  //     type: string (see STEP TYPES below)
  //     status: 'pending'|'running'|'success'|'error'
  //     selector: string (optional, for web-based steps)
  //     x, y: number (optional, for mobile/coordinate steps)
  //     url: string (optional, for API/browser steps)
  //     text: string (optional, for type-into steps)
  //     condition: string (optional, for if-condition steps)
  //     filePath: string (optional, for file operations)
  //     variableName: string (optional, to store results)
  //     duration: number (optional, for delay steps)
  //     timeout: number (optional, max execution time)
  //     onError: 'throw'|'continue'|'retry' (error handling strategy)
  //     ... other type-specific properties
  //   }
  // - device: string (ADB device identifier like "emulator-5554" or "192.168.1.100:5037")
}

// ================================================
// SECTION 1: INITIALIZATION & LOGGING
// ================================================
Step 1.1: Extract basic info
  - step.id or generate if missing
  - step.type for identifying the action
  - Get current global variables object (passed from caller)

Step 1.2: Log entry point
  - Always log start: logger.info(\[EXECUTE_STEP] Starting step: \ (type: \)\)
  - This provides execution trace for debugging

Step 1.3: Update step metadata
  - step.status = 'running'
  - step.startTime = new Date()
  - This tracks execution state and allows timeout detection

// ================================================
// SECTION 2: VARIABLE SUBSTITUTION
// ================================================
Critical for handling dynamic values!

Pattern:
  if (step.selector) interpolatedSelector = interpolate(step.selector, variables);
  if (step.url) interpolatedUrl = interpolate(step.url, variables);
  if (step.text) interpolatedText = interpolate(step.text, variables);
  if (step.condition) interpolatedCondition = interpolate(step.condition, variables);

Important notes:
  - Interpolate BEFORE using values (selector, URL, text, conditions)
  - Store interpolated values for logging (don't log original with variables)
  - The interpolate() function should replace \ with variables[variableName]
  - Handle nested variables and complex expressions if needed

// ================================================
// SECTION 3: SWITCH STATEMENT ORGANIZATION
// ================================================

GROUPING SUGGESTIONS:
  
Group 1: CONTROL FLOW
  - start, delay, repeat-start, repeat-end, retry-logic

Group 2: WEB INTERACTIONS
  - click/tap, type-into, scroll-page, wait-element

Group 3: DATA EXTRACTION
  - extract-text, extract-table, screenshot-page

Group 4: MOBILE INTERACTIONS
  - mobile-tap, mobile-swipe

Group 5: BROWSER CONTROL
  - open-browser, close-browser

Group 6: DATA & APIs
  - api-request, read-csv, write-csv

Group 7: CONDITIONAL LOGIC
  - if-condition

For each case:
  1. Log the action with interpolated values
  2. Validate required parameters
  3. Execute the action
  4. Handle response/result if applicable
  5. Store results in variables if step.variableName exists
  6. Break (except if-condition which returns)

// ================================================
// SECTION 4: POST-EXECUTION SUCCESS PATH
// ================================================
Execute ONLY if NO exceptions thrown:

  step.status = 'success'
  step.endTime = new Date()
  step.duration = step.endTime - step.startTime
  logger.info(\[STEP_SUCCESS] \ completed in \ms\)
  return { conditionResult: null }

For if-condition steps (DIFFERENT):
  - Return { conditionResult: boolean } directly
  - Do NOT set status here, set in the case handler

// ================================================
// SECTION 5: ERROR HANDLING
// ================================================
Wrapped in try-catch around entire function:

try {
  // ... all step logic ...
} catch (error) {
  step.status = 'error'
  step.endTime = new Date()
  step.duration = step.endTime - step.startTime
  step.errorMessage = error.message
  step.errorStack = error.stack
  
  logger.error(\[STEP_ERROR] Step \ failed: \\)
  
  // Check step configuration for error handling strategy
  if (step.onError === 'continue') {
    logger.warn(\[STEP_ERROR_CONTINUE] Continuing despite error\)
    return { conditionResult: null }
  } else if (step.onError === 'retry' && !step.retryAttempts) {
    logger.info(\[STEP_ERROR_RETRY] Retrying step\)
    step.retryAttempts = (step.retryAttempts || 0) + 1
    if (step.retryAttempts < 3) { // Default 3 retries
      return executeStep(step, device) // Recursive retry
    }
  }
  
  // Default: throw and stop workflow
  throw error
}

// ================================================
// CASE IMPLEMENTATION PATTERNS
// ================================================

PATTERN A: Simple Value Steps (delay, screenshot, repeat-markers)
---
case 'delay': {
  const durationMs = step.duration || 1000
  logger.info(\[STEP_DELAY] Waiting \ms\)
  await new Promise(resolve => setTimeout(resolve, durationMs))
  break
}

PATTERN B: Selector-Based Web Steps (click, type, wait-element)
---
case 'click': {
  const selector = interpolate(step.selector, variables)
  logger.info(\[STEP_CLICK] Selector: \\)
  
  // Validation
  if (!selector || typeof selector !== 'string') {
    throw new Error('Valid selector required for click step')
  }
  
  // Timeout handling
  const timeout = step.timeout || 5000
  try {
    await page.click(selector, { timeout })
  } catch (e) {
    if (e.message.includes('Timeout')) {
      throw new Error(\Element not found within \ms: \\)
    }
    throw e
  }
  
  // Optional delay after action
  if (step.delayAfter) {
    await new Promise(resolve => setTimeout(resolve, step.delayAfter))
  }
  
  break
}

PATTERN C: Data Extraction Steps (extract-text, api-request)
---
case 'extract-text': {
  const selector = interpolate(step.selector, variables)
  logger.info(\[STEP_EXTRACT_TEXT] Selector: \\)
  
  if (!selector) throw new Error('Selector required')
  
  const extractedText = await page.\(selector, el => el.innerText)
  logger.debug(\[STEP_EXTRACT_TEXT] Extracted: \\)
  
  // Store in variables
  if (step.variableName) {
    variables[step.variableName] = extractedText
    logger.info(\[STEP_EXTRACT_TEXT] Stored in '\'\)
  }
  
  break
}

PATTERN D: Conditional Steps (if-condition) - SPECIAL HANDLING
---
case 'if-condition': {
  const condition = interpolate(step.condition, variables)
  logger.info(\[STEP_IF_CONDITION] Evaluating: \\)
  
  // Evaluate condition against variables
  const conditionResult = evaluateCondition(condition, variables)
  logger.info(\[STEP_IF_CONDITION] Result: \\)
  
  step.status = 'success'
  step.endTime = new Date()
  
  // IMPORTANT: Return here, don't break
  return { conditionResult }
}

PATTERN E: Mobile Steps (mobile-tap, mobile-swipe)
---
case 'mobile-tap': {
  logger.info(\[STEP_MOBILE_TAP] Device: \, X: \, Y: \\)
  
  if (!device) throw new Error('Device required for mobile-tap')
  if (step.x === undefined || step.y === undefined) {
    throw new Error('Coordinates (x, y) required')
  }
  
  // Execute ADB command
  const command = \shell input tap \ \\
  await executeAdbCommand(device, command)
  
  if (step.delayAfter) {
    await new Promise(resolve => setTimeout(resolve, step.delayAfter))
  }
  
  break
}

PATTERN F: API Request Steps
---
case 'api-request': {
  const url = interpolate(step.url, variables)
  const method = step.method || 'GET'
  
  logger.info(\[STEP_API_REQUEST] \ \\)
  
  if (!url) throw new Error('URL required')
  
  const headers = step.headers ? interpolateObject(step.headers, variables) : {}
  const body = step.body ? interpolateObject(step.body, variables) : null
  
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  
  if (!response.ok) {
    throw new Error(\API request failed: \ \\)
  }
  
  const responseData = await response.json()
  
  if (step.variableName) {
    variables[step.variableName] = responseData
    logger.info(\[STEP_API_REQUEST] Response stored in '\'\)
  }
  
  break
}

// ================================================
// HELPER FUNCTIONS NEEDED (call these)
// ================================================

function interpolate(text, variables) {
  // Replaces \ with variables[varName]
  // Returns original text if no variables
}

function interpolateObject(obj, variables) {
  // Recursively interpolates all strings in an object
  // Used for headers, body, etc.
}

function evaluateCondition(condition, variables) {
  // Evaluates JavaScript condition string against variables
  // Example: "variables['result'] > 100" returns true/false
}

async function executeAdbCommand(device, command) {
  // Executes ADB command for mobile devices
  // Uses child_process.exec() or similar
}

// ================================================
// RETURN VALUE RULES
// ================================================

For if-condition steps:
  return { conditionResult: true } or { conditionResult: false }

For all other steps:
  return { conditionResult: null }

Success case (reached end of function):
  return { conditionResult: null }

Error case:
  throw error (unless onError='continue' then return null)

// ================================================
// STATUS TRACKING
// ================================================

step.status must be set to:
  - 'running' at start
  - 'success' at end (if no errors)
  - 'error' in catch block (if exception)

Additional tracking:
  - step.startTime: When step began
  - step.endTime: When step completed/failed
  - step.duration: Milliseconds elapsed
  - step.errorMessage: If status='error'
  - step.errorStack: Stack trace if status='error'

// ================================================
// LOGGING STANDARDS
// ================================================

Use structured log format:
  [LOG_PREFIX] Message with context

Prefixes:
  [EXECUTE_STEP] Function entry/exit
  [STEP_<TYPE>] Step-type specific actions
  [STEP_SUCCESS] Successful completion
  [STEP_ERROR] Errors
  [STEP_ERROR_CONTINUE] Continuing after error
  [STEP_ERROR_RETRY] Retrying step

Examples:
  logger.info(\[EXECUTE_STEP] Starting step: \ (type: \)\)
  logger.info(\[STEP_CLICK] Selector: \\)
  logger.info(\[STEP_SUCCESS] \ completed in \ms\)
  logger.error(\[STEP_ERROR] Step \ failed: \\)

// ================================================
// NEXT STEPS FOR IMPLEMENTATION
// ================================================

1. Copy the skeleton from executeStep_skeleton.js
2. Implement SECTION 1 (initialization)
3. Add helper functions (interpolate, evaluateCondition, etc.)
4. Implement each case in the switch statement
5. Test with simple cases first (delay, screenshot)
6. Add complex cases (click, type-into, extract)
7. Add mobile cases if needed
8. Add API request handling
9. Test error scenarios
10. Add logging throughout for debugging

Total estimated cases: 20-25 different step types
Suggested implementation order: control flow → web → data → mobile → api
