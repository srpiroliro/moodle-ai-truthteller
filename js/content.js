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
    clearButton.textContent = 'Clear All Analysis';
    clearButton.addEventListener('click', clearAnalysis);
    
    controlPanel.appendChild(clearButton);
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
      
      // Create analyze button for this question
      const analyzeButton = document.createElement('button');
      analyzeButton.className = 'truthteller-question-button';
      analyzeButton.textContent = 'Analyze This Question';
      analyzeButton.type = 'button'; // Explicitly set button type to prevent form submission
      analyzeButton.dataset.questionId = questionId;
      analyzeButton.addEventListener('click', (e) => handleSingleQuestionAnalyzeClick(e, question));
      
      // Create result display area
      const resultDisplay = document.createElement('div');
      resultDisplay.className = 'truthteller-result-display';
      resultDisplay.id = `truthteller-result-${questionId}`;
      resultDisplay.style.display = 'none';
      
      // Add elements to the container
      buttonContainer.appendChild(analyzeButton);
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
    
    console.log('TruthTeller: Analyze button clicked for question', questionId);
    
    // Prevent analyzing if already in progress
    if (state.isAnalyzing.get(questionId)) {
      console.log('TruthTeller: Analysis already in progress for question', questionId);
      return;
    }
    
    // Find the selected model from the available models list
    let selectedModel = getModelById(state.preferredModel);
    
    // If model is not found, use the default model
    if (!selectedModel) {
      console.warn(`TruthTeller: Model "${state.preferredModel}" not found, falling back to default model`);
      state.preferredModel = getDefaultModelId(); // Set to default model
      selectedModel = getModelById(state.preferredModel);
      
      if (!selectedModel) {
        alert('Unable to find an appropriate model. Please check your settings.');
        console.error('TruthTeller: Both selected and default models not found');
        return;
      }
    }
    
    // Get the API key based on the model's provider
    const apiKey = state.apiKeys[selectedModel.provider];
    
    console.log('TruthTeller: Selected model and API key', {
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      provider: selectedModel.provider,
      apiKeyAvailable: apiKey ? 'Yes' : 'No'
    });
    
    // Validate API key
    if (!apiKey) {
      alert(`No API key found for ${selectedModel.name}. Please add your API key in the extension popup.`);
      return;
    } else if (apiKey.trim() === '') {
      alert(`API key for ${selectedModel.name} is empty. Please add a valid API key in the extension popup.`);
      return;
    } else if (selectedModel.provider === 'claude' && !apiKey.startsWith('sk-')) {
      console.warn('TruthTeller: Claude API key doesn\'t start with "sk-". This might cause issues.');
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
        console.warn('TruthTeller: No options found for question', questionId);
        alert('Unable to find answer options for this question. Please try a different question.');
        state.isAnalyzing.set(questionId, false);
        analyzeButton.textContent = originalText;
        return;
      }
      
      // Log what we're about to send to the LLM
      console.log('TruthTeller: Analyzing question', {
        id: questionId,
        text: questionData.text,
        type: questionData.type,
        options: questionData.options.map(o => o.text)
      });
      
      // Construct prompt and log it
      const prompt = constructQuestionPrompt(questionData);
      console.log('TruthTeller: Prompt sent to LLM:', prompt);
      
      // Analyze question with LLM
      console.log('TruthTeller: Calling API with model', selectedModel.id);
      const analysis = await analyzeQuestion(questionData, state.preferredModel, apiKey);
      
      // Log the response from the LLM
      console.log('TruthTeller: LLM response:', analysis.rawResponse);
      console.log('TruthTeller: Parsed analysis:', analysis);
      
      // Store analysis result
      state.analyzedQuestions.set(questionId, analysis);
      
      // Mark probable answers
      markProbableAnswers(questionElement, analysis);
      
      // Display result in the UI
      displayAnalysisResult(questionId, analysis);
      
      console.log('TruthTeller: Analysis complete for question', questionId);
      
    } catch (error) {
      console.error('TruthTeller: Error analyzing question:', error);
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
    resultDisplay.style.display = 'block';
  }

  /**
   * Find all Moodle quiz questions on the page
   */
  function findMoodleQuestions() {
    // Typical Moodle question container has class 'que'
    const questionElements = Array.from(document.querySelectorAll('.que'));
    
    // Filter out any non-question elements
    return questionElements.filter(el => {
      // Make sure it has a question text and options
      return el.querySelector('.qtext') && 
             (el.querySelector('.answer') || el.querySelector('.ablock'));
    });
  }

  /**
   * Extract question data from a question element
   */
  function extractQuestionData(questionElement) {
    // Get question ID from element ID or data attribute
    const id = questionElement.id || `q_${Math.random().toString(36).substring(2, 9)}`;
    
    // Get question text
    const questionTextEl = questionElement.querySelector('.qtext');
    const questionText = questionTextEl ? questionTextEl.textContent.trim() : '';
    
    // Get question type
    let questionType = 'unknown';
    
    if (questionElement.classList.contains('multichoice')) {
      questionType = questionElement.querySelector('input[type="radio"]') ? 'single-choice' : 'multiple-choice';
    } else if (questionElement.classList.contains('truefalse')) {
      questionType = 'true-false';
    } else if (questionElement.classList.contains('match')) {
      questionType = 'matching';
    } else if (questionElement.classList.contains('essay')) {
      questionType = 'essay';
    }
    
    // Get answer options
    const options = [];
    
    if (questionType === 'single-choice' || questionType === 'multiple-choice' || questionType === 'true-false') {
      // Try different selectors for different Moodle themes/versions
      const optionSelectors = [
        '.answer div.r',                 // Common format
        '.answer label',                 // Alternative format
        '.answer div[id^="q"]',          // Another alternative
        '.ablock .answer div',           // Yet another format
        '.answernumber',                 // Numbered format
        '.answer input[type="radio"]',   // Radio button format
        '.answer input[type="checkbox"]' // Checkbox format
      ];
      
      // Try each selector until we find options
      let optionElements = [];
      for (const selector of optionSelectors) {
        optionElements = Array.from(questionElement.querySelectorAll(selector));
        if (optionElements.length > 0) {
          console.log('TruthTeller: Found options using selector:', selector);
          break;
        }
      }
      
      // Process the option elements
      optionElements.forEach((optionEl, index) => {
        // First try to get text from a label element
        let optionText = '';
        let labelEl = optionEl.querySelector('label');
        
        if (labelEl) {
          optionText = labelEl.textContent.trim();
        } else if (optionEl.tagName === 'LABEL') {
          // The element itself is a label
          optionText = optionEl.textContent.trim();
        } else {
          // Try getting text from adjacent elements
          const nextDiv = optionEl.querySelector('div');
          if (nextDiv) {
            optionText = nextDiv.textContent.trim();
          } else {
            // Last resort: get all text content
            optionText = optionEl.textContent.trim();
          }
        }
        
        // Get option value from input
        let value = '';
        const inputEl = optionEl.querySelector('input') || 
                        (optionEl.tagName === 'INPUT' ? optionEl : null);
        
        if (inputEl) {
          value = inputEl.value;
        }
        
        // Clean up the option text
        optionText = optionText.replace(/^\s*[a-z]\.\s+/i, ''); // Remove "a. " prefix
        
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
    console.log(`TruthTeller: Starting analysis with model ${modelId}`);
    
    // Construct prompt for the LLM
    const prompt = constructQuestionPrompt(questionData);
    
    try {
      // Call the appropriate API based on the model
      console.log(`TruthTeller: Getting API call function for model ${modelId}`);
      let apiCallFunction = getApiCallFunction(modelId);
      
      console.log('TruthTeller: Calling API function with prompt');
      let response = await apiCallFunction(prompt, modelId, apiKey);
      
      console.log('TruthTeller: API call successful, response received');
      
      // Parse the LLM response
      console.log('TruthTeller: Parsing response');
      const analysis = parseAnalysisResponse(response, questionData);
      
      // Store the raw response for logging
      analysis.rawResponse = response;
      
      // Mark this as a real response
      analysis.isMockResponse = false;
      
      console.log('TruthTeller: Analysis completed successfully');
      return analysis;
    } catch (error) {
      console.error('TruthTeller: Error calling LLM API:', error);
      
      // Use mock response data when API calls fail
      console.log('TruthTeller: Using mock response data as fallback');
      
      // Generate a mock response based on the question data
      const mockResponse = generateMockResponse(questionData);
      
      // Parse the mock response
      const analysis = parseAnalysisResponse(mockResponse, questionData);
      analysis.rawResponse = mockResponse;
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
      justification: '',
      rawResponse: response
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
    
    // Hide all result displays
    document.querySelectorAll('.truthteller-result-display').forEach(el => {
      el.style.display = 'none';
      el.innerHTML = '';
    });
    
    // Clear the analyzed questions map
    state.analyzedQuestions.clear();
  }
})(); 