/**
 * TruthTeller Moodle Quiz Helper
 * This content script automatically detects Moodle quiz questions and
 * uses LLMs to mark the most probable correct answers without selecting them.
 */

(function() {
  // Store state
  const state = {
    isAnalyzing: new Map(), // Map to track analyzing state per question
    apiKeys: {
      openai: null,
      claude: null,
      grok: null
    },
    preferredModel: 'claude-3-7-sonnet', // Set Claude 3.7 Sonnet as the default model
    analyzedQuestions: new Map() // Map to store analysis results by question ID
  };

  // Initialize when DOM is ready
  window.addEventListener('load', initialize);

  /**
   * Initialize the extension functionality
   */
  function initialize() {
    // Check if we're on a Moodle quiz page
    if (isMoodlePage()) {
      console.log('TruthTeller: Moodle quiz page detected');
      
      // Load saved settings
      loadSettings().then(() => {
        // Add control panel to the page
        addControlPanel();
        
        // Add keyboard shortcut listener
        document.addEventListener('keydown', handleKeyboardShortcuts);
        
        // Log loaded API keys (without exposing full keys)
        console.log('TruthTeller: API keys loaded', {
          openai: state.apiKeys.openai ? 'Set' : 'Not set',
          claude: state.apiKeys.claude ? 'Set' : 'Not set',
          grok: state.apiKeys.grok ? 'Set' : 'Not set'
        });
      });
    }
  }

  /**
   * Check if the current page is a Moodle page with quiz elements
   */
  function isMoodlePage() {
    // Detect Moodle quiz features
    const hasMoodleElements = document.querySelector('.que') || 
                             document.querySelector('.quiz-navigation') ||
                             document.querySelector('.questionflagpostdata');
    
    return hasMoodleElements;
  }

  /**
   * Load saved settings from Chrome storage
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ['openaiApiKey', 'claudeApiKey', 'grokApiKey', 'selectedModel'],
        function(result) {
          state.apiKeys.openai = result.openaiApiKey || null;
          state.apiKeys.claude = result.claudeApiKey || null;
          state.apiKeys.grok = result.grokApiKey || null;
          
          // If a model is selected in storage, use it; otherwise use the default
          if (result.selectedModel) {
            state.preferredModel = result.selectedModel;
          } else {
            // Use the default model from models.js if available
            try {
              state.preferredModel = getDefaultModelId();
            } catch (e) {
              console.warn('Failed to get default model ID, using hardcoded default');
              // Fallback to hardcoded default if getDefaultModelId() is not available
              state.preferredModel = 'claude-3-7-sonnet';
            }
          }
          
          console.log('TruthTeller: Settings loaded', {
            selectedModel: state.preferredModel
          });
          
          resolve();
        }
      );
    });
  }

  /**
   * Add control panel to the page
   */
  function addControlPanel() {
    // Create global control panel
    const controlPanel = document.createElement('div');
    controlPanel.className = 'truthteller-controls';
    
    const clearButton = document.createElement('button');
    clearButton.className = 'truthteller-button';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', clearAnalysis);
    
    // Add shortcut hint
    const shortcutHint = document.createElement('div');
    shortcutHint.className = 'truthteller-shortcut-hint';
    shortcutHint.textContent = 'Press Alt+T to hide/show all results';
    
    controlPanel.appendChild(clearButton);
    controlPanel.appendChild(shortcutHint);
    document.body.appendChild(controlPanel);
    
    // Add individual analyze buttons to each question
    addAnalyzeButtonsToQuestions();
  }
  
  /**
   * Add analyze buttons to each question
   */
  function addAnalyzeButtonsToQuestions() {
    // Find all questions in the page
    const questions = findMoodleQuestions();
    
    questions.forEach(question => {
      // Get question ID
      const questionId = question.id || `q_${Math.random().toString(36).substring(2, 9)}`;
      
      // Create container for the analysis button
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'truthteller-question-controls';
      
      // Create buttons container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'truthteller-buttons-container';
      
      // Create analyze button for this question
      const analyzeButton = document.createElement('button');
      analyzeButton.className = 'truthteller-question-button';
      analyzeButton.textContent = '[ analyze ]';
      analyzeButton.type = 'button'; // Explicitly set button type to prevent form submission
      analyzeButton.dataset.questionId = questionId;
      analyzeButton.addEventListener('click', (e) => handleSingleQuestionAnalyzeClick(e, question));
      
      // Create toggle button (initially hidden until analysis is done)
      const toggleButton = document.createElement('button');
      toggleButton.className = 'truthteller-toggle-button';
      toggleButton.type = 'button';
      toggleButton.dataset.questionId = questionId;
      toggleButton.style.display = 'none'; // Initially hidden
      toggleButton.innerHTML = '[ hide ]';
      toggleButton.addEventListener('click', (e) => toggleAnalysisDisplay(e, questionId));
      
      // Create result display area
      const resultDisplay = document.createElement('div');
      resultDisplay.className = 'truthteller-result-display';
      resultDisplay.id = `truthteller-result-${questionId}`;
      resultDisplay.style.display = 'none';
      
      // Add elements to the container
      buttonsContainer.appendChild(analyzeButton);
      buttonsContainer.appendChild(toggleButton);
      buttonContainer.appendChild(buttonsContainer);
      buttonContainer.appendChild(resultDisplay);
      
      // Find a good place to insert the button (after the question text)
      const questionInfoEl = question.querySelector('.info');
      if (questionInfoEl && questionInfoEl.parentNode) {
        questionInfoEl.parentNode.insertBefore(buttonContainer, questionInfoEl.nextSibling);
      } else {
        // Fallback to prepending to the question element
        question.prepend(buttonContainer);
      }
    });
  }

  /**
   * Handle analyze button click for a single question
   */
  async function handleSingleQuestionAnalyzeClick(event, questionElement) {
    // Prevent the default action (form submission)
    event.preventDefault();
    event.stopPropagation();
    
    const questionId = event.target.dataset.questionId || questionElement.id;
    
    // Prevent analyzing if already in progress
    if (state.isAnalyzing.get(questionId)) {
      return;
    }
    
    // Find the selected model from the available models list
    let selectedModel = getModelById(state.preferredModel);
    
    // If model is not found, use the default model
    if (!selectedModel) {
      console.warn(`Model "${state.preferredModel}" not found, falling back to default model`);
      state.preferredModel = getDefaultModelId(); // Set to default model
      selectedModel = getModelById(state.preferredModel);
      
      if (!selectedModel) {
        alert('Unable to find an appropriate model. Please check your settings.');
        console.error('Both selected and default models not found');
        return;
      }
    }
    
    // Get the API key based on the model's provider
    const apiKey = state.apiKeys[selectedModel.provider];
    
    // Validate API key
    if (!apiKey) {
      alert(`No API key found for ${selectedModel.name}. Please add your API key in the extension popup.`);
      return;
    } else if (apiKey.trim() === '') {
      alert(`API key for ${selectedModel.name} is empty. Please add a valid API key in the extension popup.`);
      return;
    } else if (selectedModel.provider === 'claude' && !apiKey.startsWith('sk-')) {
      console.warn('Claude API key doesn\'t start with "sk-". This might cause issues.');
    }
    
    // Set analyzing state for this question
    state.isAnalyzing.set(questionId, true);
    
    // Update button to show loading state
    const analyzeButton = event.target;
    const originalText = analyzeButton.textContent;
    analyzeButton.innerHTML = '<div class="truthteller-loading"><div class="truthteller-spinner"></div>Analyzing...</div>';
    
    try {
      // Extract question data
      const questionData = extractQuestionData(questionElement);
      
      // Check if we got any options
      if (questionData.options.length === 0) {
        console.warn('No options found for question', questionId);
        alert('Unable to find answer options for this question. Please try a different question.');
        state.isAnalyzing.set(questionId, false);
        analyzeButton.textContent = originalText;
        return;
      }
      
      // Log what we're about to analyze
      console.log('Analyzing question:', {
        id: questionId,
        text: questionData.text,
        type: questionData.type,
        optionsCount: questionData.options.length
      });
      
      // Analyze question with LLM
      console.log('Calling API with model:', selectedModel.id);
      const analysis = await analyzeQuestion(questionData, state.preferredModel, apiKey);
      
      // Store analysis result
      state.analyzedQuestions.set(questionId, analysis);
      
      // Mark probable answers
      markProbableAnswers(questionElement, analysis);
      
      // Display result in the UI
      displayAnalysisResult(questionId, analysis);
      
    } catch (error) {
      console.error('Error analyzing question:', error);
      alert(`Error analyzing question: ${error.message}`);
    } finally {
      // Reset analyzing state for this question
      state.isAnalyzing.set(questionId, false);
      analyzeButton.textContent = originalText;
    }
  }

  /**
   * Display analysis result in the UI
   */
  function displayAnalysisResult(questionId, analysis) {
    const resultDisplay = document.getElementById(`truthteller-result-${questionId}`);
    if (!resultDisplay) return;
    
    // Clear previous content
    resultDisplay.innerHTML = '';
    
    // Create result content
    const resultContent = document.createElement('div');
    resultContent.className = 'truthteller-result-content';
    
    // If this is a mock response, show a warning
    if (analysis.isMockResponse) {
      const warningBanner = document.createElement('div');
      warningBanner.className = 'truthteller-mock-warning';
      warningBanner.textContent = `API connection failed: ${analysis.errorMessage}. Using mock data for demonstration.`;
      resultContent.appendChild(warningBanner);
    }
    
    // Add the probable answer(s)
    const answerHeading = document.createElement('h4');
    answerHeading.textContent = 'Most Probable Answer:';
    resultContent.appendChild(answerHeading);
    
    // Create answer display
    const answerDisplay = document.createElement('div');
    answerDisplay.className = `truthteller-answer truthteller-${analysis.confidence.toLowerCase()}-confidence`;
    
    if (analysis.probableAnswers.length > 0) {
      // Construct answer text
      const options = [];
      analysis.probableAnswers.forEach(index => {
        // Try multiple ways to find the option text
        const questionElem = document.getElementById(questionId);
        let optionText = `Option ${index + 1}`;
        
        // Try various selectors to find the option text
        const selectors = [
          `.answer div.r:nth-child(${index + 1}) label`,
          `.answer label:nth-of-type(${index + 1})`,
          `.answernumber:nth-of-type(${index + 1}) + div`,
          `.answer div:nth-of-type(${index + 1})`,
          `.ablock .answer div:nth-of-type(${index + 1})`
        ];
        
        // Try each selector
        for (const selector of selectors) {
          const optionElem = questionElem.querySelector(selector);
          if (optionElem) {
            const text = optionElem.textContent.trim();
            if (text) {
              // Clean up the text (remove letter prefixes like "a. ")
              optionText = text.replace(/^\s*[a-z]\.\s+/i, '');
              break;
            }
          }
        }
        
        options.push(optionText);
      });
      
      answerDisplay.textContent = options.join(', ');
    } else {
      answerDisplay.textContent = 'No clear answer identified';
    }
    
    resultContent.appendChild(answerDisplay);
    
    // Add confidence level
    const confidenceDisplay = document.createElement('div');
    confidenceDisplay.className = 'truthteller-confidence';
    confidenceDisplay.textContent = `Confidence: ${analysis.confidence}`;
    resultContent.appendChild(confidenceDisplay);
    
    // Add justification
    const justificationDisplay = document.createElement('div');
    justificationDisplay.className = 'truthteller-justification';
    justificationDisplay.textContent = `Justification: ${analysis.justification}`;
    resultContent.appendChild(justificationDisplay);
    
    // Add to result display
    resultDisplay.appendChild(resultContent);
    
    // Make toggle button visible
    const toggleButton = document.querySelector(`button.truthteller-toggle-button[data-question-id="${questionId}"]`);
    if (toggleButton) {
      toggleButton.style.display = 'flex';
    }
    
    // Check if the user had a previous preference for this question
    try {
      const displayPreference = sessionStorage.getItem(`truthteller-display-${questionId}`);
      if (displayPreference === 'hidden') {
        // User previously chose to hide this analysis
        resultDisplay.classList.add('hidden');
        resultDisplay.style.display = 'none';
        
        if (toggleButton) {
          toggleButton.innerHTML = '[ show ]';
          toggleButton.classList.add('hidden-state');
        }
      } else {
        // Show by default or if previously visible
        resultDisplay.classList.remove('hidden');
        resultDisplay.style.display = 'block';
      }
    } catch (e) {
      // Default to showing if storage access fails
      resultDisplay.classList.remove('hidden');
      resultDisplay.style.display = 'block';
    }
  }

  /**
   * Find all Moodle quiz questions on the page
   */
  function findMoodleQuestions() {
    let questionElements = [];
    
    // Approach 1: Look for standard Moodle question containers with class 'que'
    const standardQuestions = Array.from(document.querySelectorAll('.que'));
    if (standardQuestions.length > 0) {
      console.log('TruthTeller: Found questions using standard .que selector');
      questionElements = standardQuestions;
    }
    
    // If no questions found, try alternative selectors
    if (questionElements.length === 0) {
      // Approach 2: Look for form with questions inside
      const quizForm = document.querySelector('form#responseform, form[action*="quiz"], form[action*="attempt.php"]');
      if (quizForm) {
        console.log('TruthTeller: Found quiz form, searching for questions inside');
        
        // Try to find question containers within the form
        const formQuestions = Array.from(quizForm.querySelectorAll('div[id^="question"]'));
        if (formQuestions.length > 0) {
          console.log('TruthTeller: Found questions inside quiz form');
          questionElements = formQuestions;
        }
      }
    }
    
    // Approach 3: Look for common question identifiers if still no questions found
    if (questionElements.length === 0) {
      console.log('TruthTeller: Trying alternative question identifiers');
      
      // Try multiple selectors that might indicate a question
      const selectors = [
        // Common Moodle question containers
        '.questionflagsaveform .qn_buttons', 
        '.questionflagpostdata',
        '.formulation',
        '.content .formulation',
        // Questions with numbers
        'div[id^="q"][id$="question"]',
        // Questions with specific structure
        '.que .content',
        // Other common patterns
        '.question-text',
        '.question-container',
        '[data-region="question"]'
      ];
      
      // Try each selector
      for (const selector of selectors) {
        const elements = Array.from(document.querySelectorAll(selector));
        if (elements.length > 0) {
          console.log(`TruthTeller: Found potential questions using selector: ${selector}`);
          // For selectors that find parts of questions, find parent question containers
          questionElements = elements.map(el => {
            // Try to find the containing question by going up to parent elements
            let container = el;
            // Go up to 5 levels to find a suitable container
            for (let i = 0; i < 5; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              if (container.classList.contains('que') || 
                  container.id && container.id.includes('question') ||
                  container.className && container.className.includes('question')) {
                return container; // Found a question container
              }
            }
            return el.closest('div') || el; // Fallback
          });
          break;
        }
      }
    }
    
    // Approach 4: Last resort - look for any elements that contain both text and radio/checkbox inputs
    if (questionElements.length === 0) {
      console.log('TruthTeller: Using last resort approach to find questions');
      
      // Find all paragraphs that might be question text
      const possibleQuestionTexts = Array.from(document.querySelectorAll('p, div.text, .content p'));
      
      // For each possible text, look for nearby inputs
      questionElements = possibleQuestionTexts.filter(textEl => {
        // Check if there are inputs near this text (up to 3 parent levels up and then down)
        let container = textEl;
        for (let i = 0; i < 3; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          
          // Check if this container has inputs
          const hasInputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
          if (hasInputs) {
            return true;
          }
        }
        return false;
      }).map(textEl => {
        // Find the common container for the text and inputs
        let container = textEl;
        for (let i = 0; i < 3; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;
          if (container.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0) {
            return container;
          }
        }
        return textEl.closest('div') || textEl;
      });
    }
    
    // Remove duplicates
    questionElements = [...new Set(questionElements)];
    
    console.log(`TruthTeller: Found ${questionElements.length} quiz questions`);
    
    // Filter out any non-question elements - those without text or options
    const validQuestions = questionElements.filter(el => {
      // Check for question text - try multiple selectors
      const hasText = el.querySelector('.qtext, .text, .content p, p, .question-text') !== null;
      
      // Check for answer options - try multiple types of inputs and answer containers
      const hasOptions = 
        el.querySelector('.answer, .ablock, input[type="radio"], input[type="checkbox"], select, textarea') !== null;
      
      return hasText && hasOptions;
    });
    
    console.log(`TruthTeller: ${validQuestions.length} valid questions after filtering`);
    
    // If no valid questions found but we found elements, return the original set
    // This is a fallback to ensure we always return something if questions exist
    if (validQuestions.length === 0 && questionElements.length > 0) {
      console.log('TruthTeller: Returning unfiltered questions as fallback');
      return questionElements;
    }
    
    return validQuestions;
  }

  /**
   * Extract question data from a question element
   */
  function extractQuestionData(questionElement) {
    // Get question ID from element ID or data attribute
    const id = questionElement.id || `q_${Math.random().toString(36).substring(2, 9)}`;
    
    // Get question text - try multiple potential selectors
    const questionTextSelectors = [
      '.qtext', 
      '.question-text', 
      '.content p', 
      'p',
      '.text',
      '.formulation',
      '.stem',
      'h4 + div',
      '[data-region="question-text"]'
    ];
    
    let questionText = '';
    
    // Try each selector until we find text
    for (const selector of questionTextSelectors) {
      const textEl = questionElement.querySelector(selector);
      if (textEl && textEl.textContent.trim()) {
        questionText = textEl.textContent.trim();
        break;
      }
    }
    
    // If still no text found, try to get any text from the question
    if (!questionText) {
      // Extract all text nodes directly under the question element
      const textNodes = Array.from(questionElement.childNodes)
        .filter(node => node.nodeType === 3 && node.textContent.trim())
        .map(node => node.textContent.trim());
        
      if (textNodes.length > 0) {
        questionText = textNodes.join(' ');
      } else {
        // Last resort: just get all text content
        questionText = questionElement.textContent.trim().substring(0, 200);
      }
    }
    
    // Get question type
    let questionType = 'unknown';
    
    // Try to determine question type from class names or content
    if (questionElement.classList.contains('multichoice') || 
        questionElement.querySelectorAll('input[type="radio"]').length > 0) {
      questionType = 'single-choice';
    } else if (questionElement.classList.contains('multichoiceset') || 
               questionElement.querySelectorAll('input[type="checkbox"]').length > 0) {
      questionType = 'multiple-choice';
    } else if (questionElement.classList.contains('truefalse') || 
               questionElement.querySelector('.answer input[value="1"]') && 
               questionElement.querySelector('.answer input[value="0"]')) {
      questionType = 'true-false';
    } else if (questionElement.classList.contains('match') || 
               questionElement.querySelectorAll('select').length > 0) {
      questionType = 'matching';
    } else if (questionElement.classList.contains('essay') || 
               questionElement.querySelector('textarea')) {
      questionType = 'essay';
    } else if (questionElement.querySelectorAll('input[type="radio"]').length > 0) {
      // If we have radio buttons but no specific class, assume single choice
      questionType = 'single-choice';
    } else if (questionElement.querySelectorAll('input[type="checkbox"]').length > 0) {
      // If we have checkboxes but no specific class, assume multiple choice
      questionType = 'multiple-choice';
    }
    
    // Get answer options
    const options = [];
    
    if (questionType === 'single-choice' || questionType === 'multiple-choice' || questionType === 'true-false') {
      // Try different selectors for different Moodle themes/versions
      const optionSelectors = [
        '.answer div.r',                       // Common format
        '.answer label',                       // Alternative format
        '.answer div[id^="q"]',                // Another alternative
        '.ablock .answer div',                 // Yet another format
        '.answernumber',                       // Numbered format
        '.answer input[type="radio"]',         // Radio button format
        '.answer input[type="checkbox"]',      // Checkbox format
        'input[type="radio"]',                 // Any radio button within question
        'input[type="checkbox"]',              // Any checkbox within question
        '.option',                             // Generic option class
        '.choice',                             // Generic choice class
        'label',                               // Any label in question
        'div > input[type="radio"] + label',   // Input followed by label
        'div > input[type="checkbox"] + label' // Input followed by label
      ];
      
      // Try each selector until we find options
      let optionElements = [];
      for (const selector of optionSelectors) {
        optionElements = Array.from(questionElement.querySelectorAll(selector));
        if (optionElements.length > 1) { // Need at least 2 options to be valid
          break;
        }
      }
      
      // Process the option elements
      optionElements.forEach((optionEl, index) => {
        // First try to get text from a label element
        let optionText = '';
        let labelEl = null;
        
        if (optionEl.tagName === 'LABEL') {
          // The element itself is a label
          labelEl = optionEl;
        } else if (optionEl.tagName === 'INPUT') {
          // If it's an input, find associated label by for=id
          labelEl = document.querySelector(`label[for="${optionEl.id}"]`);
          
          // If no label found by ID, look for parent label or next sibling label
          if (!labelEl) {
            labelEl = optionEl.closest('label') || 
                      optionEl.nextElementSibling?.tagName === 'LABEL' ? optionEl.nextElementSibling : null;
          }
        } else {
          // Look for a label inside this element
          labelEl = optionEl.querySelector('label');
        }
        
        // Extract text from label if found
        if (labelEl) {
          optionText = labelEl.textContent.trim();
        } else {
          // Try to get text from various places
          const optionContentEl = optionEl.querySelector('.text, .content, p, div');
          if (optionContentEl) {
            optionText = optionContentEl.textContent.trim();
          } else {
            // Last resort: use the element's own text content
            optionText = optionEl.textContent.trim();
          }
        }
        
        // Get option value from input
        let value = '';
        let inputEl = null;
        
        if (optionEl.tagName === 'INPUT') {
          inputEl = optionEl;
        } else {
          inputEl = optionEl.querySelector('input') || questionElement.querySelector(`input[id$="${index}"]`);
        }
        
        if (inputEl) {
          value = inputEl.value;
        }
        
        // Clean up the option text (remove letter prefixes like "a. ")
        optionText = optionText.replace(/^\s*[a-z]\.\s+/i, '');
        optionText = optionText.replace(/^\s*\d+\.\s+/i, '');
        
        // Add option to list if we found some text
        if (optionText) {
          options.push({
            index,
            text: optionText,
            value,
            element: optionEl
          });
        }
      });
    }
    
    return {
      id,
      element: questionElement,
      text: questionText,
      type: questionType,
      options
    };
  }

  /**
   * Analyze a question using the selected LLM
   */
  async function analyzeQuestion(questionData, modelId, apiKey) {
    // Construct prompt for the LLM
    const prompt = constructQuestionPrompt(questionData);
    
    try {
      // Call the appropriate API based on the model
      let apiCallFunction = getApiCallFunction(modelId);
      let response = await apiCallFunction(prompt, modelId, apiKey);
      
      // Log the response for debugging (but don't store in state)
      console.log('LLM response:', response);
      
      // Parse the LLM response
      const analysis = parseAnalysisResponse(response, questionData);
      
      // Mark this as a real response
      analysis.isMockResponse = false;
      
      return analysis;
    } catch (error) {
      console.error('Error calling LLM API:', error);
      
      // Use mock response data when API calls fail
      console.log('Using mock response data as fallback');
      
      // Generate a mock response based on the question data
      const mockResponse = generateMockResponse(questionData);
      
      // Parse the mock response
      const analysis = parseAnalysisResponse(mockResponse, questionData);
      analysis.justification += ' (MOCK RESPONSE - API CALL FAILED)';
      analysis.isMockResponse = true;
      analysis.errorMessage = error.message;
      
      return analysis;
    }
  }

  /**
   * Generate a mock response for testing when API calls fail
   */
  function generateMockResponse(questionData) {
    // Randomly select an answer option
    let answerIndex = 1; // Default to first option
    
    if (questionData.options.length > 0) {
      answerIndex = Math.floor(Math.random() * questionData.options.length) + 1;
    }
    
    // Random confidence level
    const confidenceLevels = ['HIGH', 'MEDIUM', 'LOW'];
    const confidence = confidenceLevels[Math.floor(Math.random() * confidenceLevels.length)];
    
    // Generate mock response
    return `ANSWER: Option ${answerIndex}
CONFIDENCE: ${confidence}
JUSTIFICATION: This is a mock response generated when the API call failed. The extension is functioning but couldn't connect to the LLM API.`;
  }

  /**
   * Construct a prompt for analyzing a question
   */
  function constructQuestionPrompt(questionData) {
    let prompt = `You are an AI that helps students analyze quiz questions. For the following question, identify the most probable correct answer(s) with your confidence level. DO NOT explain the full reasoning process, just provide your answer analysis.

Question: ${questionData.text}

`;

    if (questionData.options.length > 0) {
      prompt += 'Options:\n';
      questionData.options.forEach((option, index) => {
        prompt += `${index + 1}. ${option.text}\n`;
      });
    }

    prompt += `
Question Type: ${questionData.type}

Your task:
1. Analyze the question and options carefully.
2. Identify which option(s) is/are most likely correct.
3. Assign a confidence level for each option: HIGH, MEDIUM, or LOW.
4. Provide a VERY BRIEF justification (1-2 sentences max).

Format your response as follows:
ANSWER: Option # (for single choice) or Options #,# (for multiple choice)
CONFIDENCE: HIGH/MEDIUM/LOW
JUSTIFICATION: Brief justification

Response:`;

    return prompt;
  }

  /**
   * Parse the LLM response to extract answer analysis
   */
  function parseAnalysisResponse(response, questionData) {
    // Initialize default analysis
    const analysis = {
      questionId: questionData.id,
      probableAnswers: [],
      confidence: 'LOW',
      justification: ''
    };
    
    try {
      // Extract answer, confidence, and justification using regex
      const answerMatch = response.match(/ANSWER:\s*(.*)/i);
      const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
      const justificationMatch = response.match(/JUSTIFICATION:\s*(.*)/i);
      
      if (answerMatch && answerMatch[1]) {
        const answerText = answerMatch[1].trim();
        
        // Handle multiple answers (comma-separated)
        if (answerText.includes(',')) {
          // Split by comma and handle "Option #" format
          const answerParts = answerText.split(',').map(part => part.trim());
          
          answerParts.forEach(part => {
            // Extract answer number
            const numMatch = part.match(/\d+/);
            if (numMatch) {
              const num = parseInt(numMatch[0]);
              if (num > 0 && num <= questionData.options.length) {
                analysis.probableAnswers.push(num - 1); // Convert to 0-based index
              }
            }
          });
        } else {
          // Handle single answer
          const numMatch = answerText.match(/\d+/);
          if (numMatch) {
            const num = parseInt(numMatch[0]);
            if (num > 0 && num <= questionData.options.length) {
              analysis.probableAnswers.push(num - 1); // Convert to 0-based index
            }
          }
        }
      }
      
      if (confidenceMatch && confidenceMatch[1]) {
        analysis.confidence = confidenceMatch[1].toUpperCase();
      }
      
      if (justificationMatch && justificationMatch[1]) {
        analysis.justification = justificationMatch[1].trim();
      }
    } catch (error) {
      console.error('Error parsing LLM response:', error);
    }
    
    return analysis;
  }

  /**
   * Mark probable answers in the UI
   */
  function markProbableAnswers(questionElement, analysis) {
    // Remove any existing indicators
    questionElement.querySelectorAll('.truthteller-indicator').forEach(el => el.remove());
    
    // Get all answer options
    const optionElements = questionElement.querySelectorAll('.answer div.r');
    
    // For each probable answer, add an indicator
    analysis.probableAnswers.forEach(answerIndex => {
      if (answerIndex >= 0 && answerIndex < optionElements.length) {
        const optionEl = optionElements[answerIndex];
        
        // Create indicator element
        const indicator = document.createElement('div');
        indicator.className = `truthteller-indicator truthteller-${analysis.confidence.toLowerCase()}-confidence`;
        
        // Show different icon based on confidence
        let confidenceIcon = '?';
        if (analysis.confidence === 'HIGH') {
          confidenceIcon = '✓';
        } else if (analysis.confidence === 'MEDIUM') {
          confidenceIcon = '!';
        }
        
        indicator.textContent = confidenceIcon;
        
        // Add tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'truthteller-tooltip';
        tooltip.textContent = `Confidence: ${analysis.confidence}\n${analysis.justification}`;
        indicator.appendChild(tooltip);
        
        // Position the indicator relative to the option element
        optionEl.style.position = 'relative';
        
        // Add the indicator to the option element
        optionEl.appendChild(indicator);
      }
    });
  }

  /**
   * Clear all analysis indicators and results from the page
   */
  function clearAnalysis() {
    // Remove all indicators
    document.querySelectorAll('.truthteller-indicator').forEach(el => el.remove());
    
    // Hide all toggle buttons and reset their state
    document.querySelectorAll('.truthteller-toggle-button').forEach(el => {
      el.style.display = 'none';
      el.innerHTML = '[ hide ]';
      el.classList.remove('hidden-state');
    });
    
    // Hide all result displays
    document.querySelectorAll('.truthteller-result-display').forEach(el => {
      el.style.display = 'none';
      el.innerHTML = '';
      el.classList.remove('hidden');
    });
    
    // Clear the analyzed questions map
    state.analyzedQuestions.clear();
    
    // Clear any saved display preferences
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('truthteller-display-')) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.warn('Unable to clear display preferences from session storage', e);
    }
  }

  /**
   * Toggle the visibility of analysis results
   */
  function toggleAnalysisDisplay(event, questionId) {
    const button = event.target.closest('button');
    const resultDisplay = document.getElementById(`truthteller-result-${questionId}`);
    
    if (!resultDisplay) return;
    
    // Check current visibility state
    const isHidden = resultDisplay.classList.contains('hidden');
    
    if (isHidden) {
      // Show the analysis
      resultDisplay.classList.remove('hidden');
      resultDisplay.style.display = 'block';
      button.innerHTML = '[ hide ]';
      button.classList.remove('hidden-state');
    } else {
      // Hide the analysis
      resultDisplay.classList.add('hidden');
      resultDisplay.style.display = 'none';
      button.innerHTML = '[ show ]';
      button.classList.add('hidden-state');
    }
    
    // Store preference in session storage
    try {
      sessionStorage.setItem(`truthteller-display-${questionId}`, isHidden ? 'visible' : 'hidden');
    } catch (e) {
      console.warn('Unable to store display preference in session storage', e);
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  function handleKeyboardShortcuts(event) {
    // Alt+T to toggle all analysis results
    if (event.altKey && event.key === 't') {
      toggleAllAnalysisResults();
    }
  }

  /**
   * Toggle visibility of all analysis results at once
   */
  function toggleAllAnalysisResults() {
    // Get all visible result displays
    const allResults = document.querySelectorAll('.truthteller-result-display');
    if (allResults.length === 0) return;
    
    // Check if any results are visible
    const anyVisible = Array.from(allResults).some(el => 
      el.style.display === 'block' && !el.classList.contains('hidden')
    );
    
    // Toggle based on current state
    allResults.forEach(result => {
      const questionId = result.id.replace('truthteller-result-', '');
      const toggleButton = document.querySelector(`button.truthteller-toggle-button[data-question-id="${questionId}"]`);
      
      if (anyVisible) {
        // Hide all results
        result.classList.add('hidden');
        result.style.display = 'none';
        
        if (toggleButton) {
          toggleButton.innerHTML = '[ show ]';
          toggleButton.classList.add('hidden-state');
        }
      } else {
        // Show all results
        result.classList.remove('hidden');
        result.style.display = 'block';
        
        if (toggleButton) {
          toggleButton.innerHTML = '[ hide ]';
          toggleButton.classList.remove('hidden-state');
        }
      }
    });
    
    // Save preferences
    try {
      sessionStorage.setItem('truthteller-all-hidden', anyVisible ? 'true' : 'false');
    } catch (e) {
      console.warn('Unable to store display preference in session storage', e);
    }
  }
})(); 