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
      grok: null,
      deepseek: null
    },
    preferredModel: 'claude-3-7-sonnet', // Set Claude 3.7 Sonnet as the default model
    analyzedQuestions: new Map(), // Map to store analysis results by question ID
    customContext: '', // Custom context text
    useCustomContext: false, // Whether to use custom context when analyzing questions
    uploadedPdfs: [] // Array to store uploaded PDF information
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
          grok: state.apiKeys.grok ? 'Set' : 'Not set',
          deepseek: state.apiKeys.deepseek ? 'Set' : 'Not set'
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
      // Load API keys and model preferences from sync storage
      chrome.storage.sync.get(
        ['openaiApiKey', 'claudeApiKey', 'grokApiKey', 'deepseekApiKey', 'selectedModel'],
        function(syncResult) {
          state.apiKeys.openai = syncResult.openaiApiKey || null;
          state.apiKeys.claude = syncResult.claudeApiKey || null;
          state.apiKeys.grok = syncResult.grokApiKey || null;
          state.apiKeys.deepseek = syncResult.deepseekApiKey || null;
          
          // If a model is selected in storage, use it; otherwise use the default
          if (syncResult.selectedModel) {
            state.preferredModel = syncResult.selectedModel;
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
          
          // Load larger context data from local storage
          chrome.storage.local.get(
            ['customContext', 'useCustomContext', 'uploadedPdfs'],
            function(localResult) {
              // If not found in local storage, check sync storage for legacy data
              if ((!localResult.customContext && !localResult.uploadedPdfs) || 
                  (localResult.uploadedPdfs && localResult.uploadedPdfs.length === 0)) {
                
                chrome.storage.sync.get(
                  ['customContext', 'useCustomContext', 'uploadedPdfs'],
                  function(legacyResult) {
                    loadContextData(legacyResult);
                    resolve();
                  }
                );
              } else {
                // Data is already in local storage
                loadContextData(localResult);
                resolve();
              }
            }
          );
        }
      );
    });
    
    // Helper function to load context data from storage result
    function loadContextData(result) {
      // Load custom context settings
      state.customContext = result.customContext || '';
      state.useCustomContext = result.useCustomContext || false;
      
      // Load uploaded PDFs if available
      if (result.uploadedPdfs && Array.isArray(result.uploadedPdfs)) {
        state.uploadedPdfs = result.uploadedPdfs;
      }
      
      console.log('TruthTeller: Settings loaded', {
        selectedModel: state.preferredModel,
        customContext: state.customContext ? `Set (${state.customContext.length} chars)` : 'Not set',
        useCustomContext: state.useCustomContext,
        uploadedPdfs: state.uploadedPdfs.length > 0 ? `${state.uploadedPdfs.length} PDFs` : 'None'
      });
    }
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
    
    // Add custom context indicator if enabled
    if (state.useCustomContext && state.customContext.trim() !== '') {
      const contextIndicator = document.createElement('div');
      contextIndicator.className = 'truthteller-context-indicator';
      
      if (state.uploadedPdfs.length > 0) {
        const pdfNames = state.uploadedPdfs.length <= 3 
          ? state.uploadedPdfs.map(pdf => pdf.name).join(', ')
          : `${state.uploadedPdfs.length} PDFs`;
          
        contextIndicator.innerHTML = `📄 Using context from ${pdfNames}`;
        contextIndicator.title = `Questions will be analyzed using context from ${state.uploadedPdfs.length} PDFs`;
      } else {
        contextIndicator.innerHTML = '📄 Using custom context';
        contextIndicator.title = 'Questions will be analyzed using your custom context';
      }
      
      controlPanel.appendChild(contextIndicator);
    }
    
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
      
      // Check if the question has valid content to analyze
      const isWrittenQuestion = questionData.type === 'essay' || questionData.type === 'short-answer';
      const hasOptions = questionData.options.length > 0;
      const hasQuestionText = questionData.text && questionData.text.trim().length > 0;
      
      if (!hasQuestionText) {
        console.warn('TruthTeller: No question text found', questionId);
        alert('Unable to find question text. Please try a different question.');
        state.isAnalyzing.set(questionId, false);
        analyzeButton.textContent = originalText;
        return;
      }
      
      // For multiple choice, we need options
      // For written questions, we don't need options
      if (!isWrittenQuestion && !hasOptions) {
        console.warn('TruthTeller: No options found for multiple-choice question', questionId);
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
        optionsCount: questionData.options.length,
        isWrittenQuestion: isWrittenQuestion
      });
      
      // Analyze question with LLM
      console.log('Calling API with model:', selectedModel.id);
      const analysis = await analyzeQuestion(questionData, state.preferredModel, apiKey);
      
      // Store analysis result
      state.analyzedQuestions.set(questionId, analysis);
      
      // Mark probable answers
      if (!isWrittenQuestion) {
        markProbableAnswers(questionElement, analysis);
      }
      
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
    
    // Get the question type from the element
    const questionElement = document.getElementById(questionId);
    const questionData = questionElement ? extractQuestionData(questionElement) : { type: 'unknown' };
    
    // For multiple choice questions
    if (questionData.type === 'single-choice' || questionData.type === 'multiple-choice' || questionData.type === 'true-false') {
      // Add the probable answer(s)
      const answerHeading = document.createElement('h4');
      answerHeading.textContent = analysis.isNegatedQuestion ? 'Incorrect Answer(s):' : 'Most Probable Answer:';
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
        
        // For negated questions, add a note that these are the incorrect options
        if (analysis.isNegatedQuestion) {
          const noteElem = document.createElement('div');
          noteElem.className = 'truthteller-negation-note';
          noteElem.textContent = 'Note: This question asks for the INCORRECT option(s).';
          resultContent.appendChild(noteElem);
        }
      } else {
        answerDisplay.textContent = 'No clear answer identified';
      }
      
      resultContent.appendChild(answerDisplay);
    }
    // For essay questions
    else if (questionData.type === 'essay') {
      // Add heading
      const essayHeading = document.createElement('h4');
      essayHeading.textContent = 'Essay Approach:';
      resultContent.appendChild(essayHeading);
      
      // Add key points
      if (analysis.keyPoints && analysis.keyPoints.length > 0) {
        const keyPointsContainer = document.createElement('div');
        keyPointsContainer.className = 'truthteller-key-points';
        
        const keyPointsHeading = document.createElement('div');
        keyPointsHeading.className = 'truthteller-subheading';
        keyPointsHeading.textContent = 'Key Points:';
        keyPointsContainer.appendChild(keyPointsHeading);
        
        const keyPointsList = document.createElement('ul');
        keyPointsList.className = 'truthteller-points-list';
        
        analysis.keyPoints.forEach(point => {
          const listItem = document.createElement('li');
          listItem.textContent = point;
          keyPointsList.appendChild(listItem);
        });
        
        keyPointsContainer.appendChild(keyPointsList);
        resultContent.appendChild(keyPointsContainer);
      }
      
      // Add structure
      if (analysis.structure) {
        const structureContainer = document.createElement('div');
        structureContainer.className = 'truthteller-structure';
        
        const structureHeading = document.createElement('div');
        structureHeading.className = 'truthteller-subheading';
        structureHeading.textContent = 'Structure:';
        structureContainer.appendChild(structureHeading);
        
        const structureText = document.createElement('div');
        structureText.className = 'truthteller-structure-text';
        structureText.textContent = analysis.structure;
        structureContainer.appendChild(structureText);
        
        resultContent.appendChild(structureContainer);
      }
      
      // Add concepts
      if (analysis.conceptsToInclude && analysis.conceptsToInclude.length > 0) {
        const conceptsContainer = document.createElement('div');
        conceptsContainer.className = 'truthteller-concepts';
        
        const conceptsHeading = document.createElement('div');
        conceptsHeading.className = 'truthteller-subheading';
        conceptsHeading.textContent = 'Key Concepts:';
        conceptsContainer.appendChild(conceptsHeading);
        
        const conceptsList = document.createElement('div');
        conceptsList.className = 'truthteller-concepts-list';
        conceptsList.textContent = analysis.conceptsToInclude.join(', ');
        conceptsContainer.appendChild(conceptsList);
        
        resultContent.appendChild(conceptsContainer);
      }
    }
    // For short answer questions
    else if (questionData.type === 'short-answer') {
      // Add heading
      const answerHeading = document.createElement('h4');
      answerHeading.textContent = 'Suggested Answer:';
      resultContent.appendChild(answerHeading);
      
      // Add model answer
      if (analysis.modelAnswer) {
        const answerDisplay = document.createElement('div');
        answerDisplay.className = `truthteller-answer truthteller-${analysis.confidence.toLowerCase()}-confidence`;
        answerDisplay.textContent = analysis.modelAnswer;
        resultContent.appendChild(answerDisplay);
      }
      
      // Add key terms
      if (analysis.conceptsToInclude && analysis.conceptsToInclude.length > 0) {
        const termsContainer = document.createElement('div');
        termsContainer.className = 'truthteller-key-terms';
        
        const termsHeading = document.createElement('div');
        termsHeading.className = 'truthteller-subheading';
        termsHeading.textContent = 'Key Terms:';
        termsContainer.appendChild(termsHeading);
        
        const termsList = document.createElement('div');
        termsList.className = 'truthteller-terms-list';
        termsList.textContent = analysis.conceptsToInclude.join(', ');
        termsContainer.appendChild(termsList);
        
        resultContent.appendChild(termsContainer);
      }
    }
    // For other question types
    else {
      // Default display for unknown question types
      // Add the approach heading
      const approachHeading = document.createElement('h4');
      approachHeading.textContent = 'Suggested Approach:';
      resultContent.appendChild(approachHeading);
      
      // Add approach text
      if (analysis.approach) {
        const approachDisplay = document.createElement('div');
        approachDisplay.className = 'truthteller-approach';
        approachDisplay.textContent = analysis.approach;
        resultContent.appendChild(approachDisplay);
      }
      
      // Add key points
      if (analysis.keyPoints && analysis.keyPoints.length > 0) {
        const keyPointsContainer = document.createElement('div');
        keyPointsContainer.className = 'truthteller-key-points';
        
        const keyPointsHeading = document.createElement('div');
        keyPointsHeading.className = 'truthteller-subheading';
        keyPointsHeading.textContent = 'Key Points:';
        keyPointsContainer.appendChild(keyPointsHeading);
        
        const keyPointsList = document.createElement('ul');
        keyPointsList.className = 'truthteller-points-list';
        
        analysis.keyPoints.forEach(point => {
          const listItem = document.createElement('li');
          listItem.textContent = point;
          keyPointsList.appendChild(listItem);
        });
        
        keyPointsContainer.appendChild(keyPointsList);
        resultContent.appendChild(keyPointsContainer);
      }
    }
    
    // Add confidence level for all question types
    const confidenceDisplay = document.createElement('div');
    confidenceDisplay.className = 'truthteller-confidence';
    confidenceDisplay.textContent = `Confidence: ${analysis.confidence}`;
    resultContent.appendChild(confidenceDisplay);
    
    // Add justification for all question types
    if (analysis.justification && analysis.justification !== analysis.modelAnswer) {
      const justificationDisplay = document.createElement('div');
      justificationDisplay.className = 'truthteller-justification';
      justificationDisplay.textContent = `Justification: ${analysis.justification}`;
      resultContent.appendChild(justificationDisplay);
    }
    
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
    
    // Look for any additional instructions or context
    let additionalContext = '';
    const contextSelectors = [
      '.info', 
      '.general', 
      '.specificfeedback',
      '.prompt',
      '.instruction',
      '.help',
      '.guidance'
    ];
    
    for (const selector of contextSelectors) {
      const contextEl = questionElement.querySelector(selector);
      if (contextEl && contextEl.textContent.trim()) {
        additionalContext += contextEl.textContent.trim() + '\n';
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
    } else if (questionElement.classList.contains('shortanswer') || 
               questionElement.querySelector('input[type="text"]')) {
      questionType = 'short-answer';
    } else if (questionElement.querySelectorAll('input[type="radio"]').length > 0) {
      // If we have radio buttons but no specific class, assume single choice
      questionType = 'single-choice';
    } else if (questionElement.querySelectorAll('input[type="checkbox"]').length > 0) {
      // If we have checkboxes but no specific class, assume multiple choice
      questionType = 'multiple-choice';
    } else if (questionElement.querySelector('textarea')) {
      // If there's a textarea, it's likely an essay question
      questionType = 'essay';
    } else if (questionElement.querySelector('input[type="text"]')) {
      // If there's a text input, it's likely a short answer question
      questionType = 'short-answer';
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
    
    // For essay or short-answer questions, look for hints, word limits, or example answers
    let answerHints = '';
    
    if (questionType === 'essay' || questionType === 'short-answer') {
      // Try to find word count or character limits
      const limitSelectors = [
        '.wordcount', 
        '.charactercount',
        '.limit',
        'div[id*="word_count"]',
        'span[id*="word_count"]',
        'div[id*="character_count"]',
        'span[id*="character_count"]'
      ];
      
      for (const selector of limitSelectors) {
        const limitEl = questionElement.querySelector(selector);
        if (limitEl && limitEl.textContent.trim()) {
          answerHints += "Word/character limit: " + limitEl.textContent.trim() + "\n";
        }
      }
      
      // Try to find any hints or instructions
      const hintSelectors = [
        '.hint',
        '.instruction',
        '.note',
        '.answerformat',
        '.guidelines'
      ];
      
      for (const selector of hintSelectors) {
        const hintEl = questionElement.querySelector(selector);
        if (hintEl && hintEl.textContent.trim()) {
          answerHints += "Hint: " + hintEl.textContent.trim() + "\n";
        }
      }
      
      // Check for a placeholder in the textarea
      const textarea = questionElement.querySelector('textarea');
      if (textarea && textarea.placeholder) {
        answerHints += "Placeholder: " + textarea.placeholder + "\n";
      }
      
      // Check for any info about acceptable formats
      const formatInfo = questionElement.querySelector('.filemanager, .formats, .attachments');
      if (formatInfo && formatInfo.textContent.trim()) {
        answerHints += "Format info: " + formatInfo.textContent.trim() + "\n";
      }
    }
    
    return {
      id,
      element: questionElement,
      text: questionText,
      type: questionType,
      options,
      additionalContext: additionalContext.trim(),
      answerHints: answerHints.trim()
    };
  }

  /**
   * Analyze a question using the selected LLM
   */
  async function analyzeQuestion(questionData, modelId, apiKey) {
    // Construct prompt for the LLM
    const prompt = constructQuestionPrompt(questionData);
    
    // Log if using custom context
    if (state.useCustomContext && state.customContext.trim() !== '') {
      console.log('TruthTeller: Using custom context for question analysis', {
        contextLength: state.customContext.length,
        usingCustomContext: state.useCustomContext,
        pdfCount: state.uploadedPdfs.length,
        contextSource: state.uploadedPdfs.length > 0 
          ? `${state.uploadedPdfs.length} PDFs: ${state.uploadedPdfs.map(pdf => pdf.name).join(', ')}` 
          : 'Manual text input'
      });
    }
    
    // Log the full prompt for debugging
    console.log('TruthTeller: Full prompt for LLM:', prompt);
    
    try {
      // Call the appropriate API based on the model
      let apiCallFunction = getApiCallFunction(modelId);
      
      // Log the prompt metadata for debugging
      console.log('TruthTeller: Sending prompt to LLM', {
        questionType: questionData.type,
        promptLength: prompt.length,
        usingCustomContext: state.useCustomContext
      });
      
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
    let prompt = '';
    
    // Check if the question is negated (asking for what is NOT correct)
    const isNegatedQuestion = checkIfNegatedQuestion(questionData.text);
    
    // Add custom context if enabled
    let customContextPrefix = '';
    if (state.useCustomContext && state.customContext.trim() !== '') {
      customContextPrefix = `IMPORTANT - CONTEXT INFORMATION (THIS MUST BE USED AS THE PRIMARY SOURCE OF INFORMATION):\n${state.customContext.trim()}\n\nYou MUST prioritize the above context when answering the question. Even if you think you know a different answer, use ONLY the information in the context. If a specific answer is mentioned in the context, use exactly that answer.\n\n`;
    }
    
    // For multiple choice questions
    if (questionData.type === 'single-choice' || questionData.type === 'multiple-choice' || questionData.type === 'true-false') {
      prompt = `${customContextPrefix}You are an AI that helps students analyze quiz questions. For the following question, identify the ${isNegatedQuestion ? 'INCORRECT' : 'most probable correct'} answer(s) with your confidence level. DO NOT explain the full reasoning process, just provide your answer analysis.

Question: ${questionData.text}

`;

      if (questionData.additionalContext) {
        prompt += `Additional context: ${questionData.additionalContext}\n\n`;
      }

      if (questionData.options.length > 0) {
        prompt += 'Options:\n';
        questionData.options.forEach((option, index) => {
          prompt += `${index + 1}. ${option.text}\n`;
        });
      }

      prompt += `
Question Type: ${questionData.type}
${isNegatedQuestion ? 'IMPORTANT: This is a NEGATED question asking for what is NOT correct/true/accurate.' : ''}

Your task:
1. Analyze the question and options carefully.
2. ${isNegatedQuestion ? 'Identify which option(s) is/are INCORRECT/FALSE/NOT TRUE.' : 'Identify which option(s) is/are most likely correct.'}
3. Assign a confidence level for each option: HIGH, MEDIUM, or LOW.
4. Provide a VERY BRIEF justification (1-2 sentences max).

Format your response as follows:
${isNegatedQuestion ? 'INCORRECT ANSWER' : 'ANSWER'}: Option # (for single choice) or Options #,# (for multiple choice)
CONFIDENCE: HIGH/MEDIUM/LOW
JUSTIFICATION: Brief justification

Response:`;
    }
    // For essay questions
    else if (questionData.type === 'essay') {
      prompt = `${customContextPrefix}You are an AI that helps students understand how to approach essay questions. For the following essay question, provide a brief outline of how to answer it effectively. DO NOT write a full essay response.

Essay Question: ${questionData.text}

`;

      if (questionData.additionalContext) {
        prompt += `Additional context: ${questionData.additionalContext}\n\n`;
      }

      if (questionData.answerHints) {
        prompt += `Answer guidelines: ${questionData.answerHints}\n\n`;
      }

      prompt += `
Your task:
1. Analyze the essay question carefully.
2. Identify 3-5 key points that should be addressed in an answer.
3. Suggest a clear structure for the essay response.
4. Mention any key terms, concepts, or references that should be included.

Format your response as follows:
KEY POINTS: List the 3-5 main points that should be addressed
STRUCTURE: Suggest a brief outline structure (intro, body paragraphs, conclusion)
IMPORTANT CONCEPTS: Mention any key terms or concepts to include
APPROACH: Give a BRIEF suggestion on how to approach this essay (1-2 sentences)

Response:`;
    }
    // For short answer questions
    else if (questionData.type === 'short-answer') {
      prompt = `${customContextPrefix}You are an AI that helps students analyze short answer questions. For the following question, provide a concise model answer. Keep it brief but complete.

Question: ${questionData.text}

`;

      if (questionData.additionalContext) {
        prompt += `Additional context: ${questionData.additionalContext}\n\n`;
      }

      if (questionData.answerHints) {
        prompt += `Answer guidelines: ${questionData.answerHints}\n\n`;
      }
      
      // Check if this appears to be a one-word answer request
      const isOneWordAnswer = questionData.text.toLowerCase().includes("one word") || 
                             questionData.text.toLowerCase().includes("single word") ||
                             (questionData.answerHints && questionData.answerHints.toLowerCase().includes("one word"));
      
      if (isOneWordAnswer && state.useCustomContext) {
        prompt += `
CRITICAL INSTRUCTION: This question requires a ONE WORD answer. If the answer is specified in the context, use EXACTLY that word. DO NOT improvise or use synonyms. The exact word from the context must be your answer.

`;
      }

      prompt += `
Your task:
1. Analyze the question carefully.
2. Provide a concise, accurate answer that directly addresses the question.
3. Keep your answer brief but include all necessary information.
4. Use clear, precise language.
${isOneWordAnswer ? '5. Provide EXACTLY the answer specified in the context if available.' : ''}

Format your response as follows:
ANSWER: ${isOneWordAnswer ? 'Just one word as specified in the context' : 'Your concise model answer'}
CONFIDENCE: HIGH/MEDIUM/LOW (how confident you are in this answer)
KEY TERMS: List any key terms or concepts that should be included in the answer

Response:`;
    }
    // For other question types or unknown types
    else {
      prompt = `${customContextPrefix}You are an AI that helps students analyze quiz questions. For the following question, provide guidance on how to approach it.

Question: ${questionData.text}

`;

      if (questionData.additionalContext) {
        prompt += `Additional context: ${questionData.additionalContext}\n\n`;
      }

      prompt += `
Question Type: ${questionData.type || 'Unknown'}

Your task:
1. Analyze the question carefully.
2. Explain how to approach answering this type of question.
3. Provide key information that would be relevant to include in an answer.

Format your response as follows:
APPROACH: Brief explanation of how to tackle this question
KEY POINTS: List essential information to include
CONFIDENCE: HIGH/MEDIUM/LOW
JUSTIFICATION: Brief explanation of your confidence level

Response:`;
    }

    return prompt;
  }

  /**
   * Checks if a question is negated (asking for what is NOT correct/true)
   */
  function checkIfNegatedQuestion(questionText) {
    // Convert to lowercase for easier matching
    const text = questionText.toLowerCase();
    
    // Check for common negation patterns
    const negationPatterns = [
      /\bnot\b.*\bcorrect\b/,
      /\bincorrect\b/,
      /\bnot\b.*\btrue\b/,
      /\bfalse\b.*\bstatement\b/,
      /\bnot\b.*\baccurate\b/,
      /\binaccurate\b/,
      /\bnot\b.*\bvalid\b/,
      /\binvalid\b/,
      /\bnot\b.*\bright\b/,
      /\bwrong\b/,
      /\bnot\b.*\bappropriate\b/,
      /\binappropriate\b/,
      /\bnot\b.*\bgood\b/,
      /\bbad\b/,
      /\bnot\b.*\bsuitable\b/,
      /\bunsuitable\b/,
      /\bnot\b.*\bproper\b/,
      /\bimproper\b/,
      /\bnot\b.*\btruthful\b/,
      /\buntruthful\b/,
      /which.*\bnot\b/
    ];
    
    // Check each pattern
    for (const pattern of negationPatterns) {
      if (pattern.test(text)) {
        console.log('TruthTeller: Detected negated question');
        return true;
      }
    }
    
    return false;
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
      keyPoints: [],
      structure: '',
      conceptsToInclude: [],
      approach: '',
      modelAnswer: '',
      isNegatedQuestion: checkIfNegatedQuestion(questionData.text)
    };
    
    try {
      // For multiple choice questions
      if (questionData.type === 'single-choice' || questionData.type === 'multiple-choice' || questionData.type === 'true-false') {
        // Extract answer, confidence, and justification using regex
        // For negated questions, look for "INCORRECT ANSWER" instead of "ANSWER"
        const answerMatch = analysis.isNegatedQuestion 
          ? response.match(/INCORRECT ANSWER:\s*(.*)/i) || response.match(/ANSWER:\s*(.*)/i)
          : response.match(/ANSWER:\s*(.*)/i);
          
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
      }
      // For essay questions
      else if (questionData.type === 'essay') {
        // Extract key points, structure, concepts, and approach
        const keyPointsMatch = response.match(/KEY POINTS:\s*([\s\S]*?)(?=STRUCTURE:|IMPORTANT CONCEPTS:|APPROACH:|$)/i);
        const structureMatch = response.match(/STRUCTURE:\s*([\s\S]*?)(?=KEY POINTS:|IMPORTANT CONCEPTS:|APPROACH:|$)/i);
        const conceptsMatch = response.match(/IMPORTANT CONCEPTS:\s*([\s\S]*?)(?=KEY POINTS:|STRUCTURE:|APPROACH:|$)/i);
        const approachMatch = response.match(/APPROACH:\s*([\s\S]*?)(?=KEY POINTS:|STRUCTURE:|IMPORTANT CONCEPTS:|$)/i);
        
        // Process and store key points
        if (keyPointsMatch && keyPointsMatch[1]) {
          const keyPointsText = keyPointsMatch[1].trim();
          // Split by bullet points, numbers, or new lines
          analysis.keyPoints = keyPointsText
            .split(/\n|•|\*|\d+\.\s+/)
            .map(point => point.trim())
            .filter(point => point.length > 0);
        }
        
        // Store structure
        if (structureMatch && structureMatch[1]) {
          analysis.structure = structureMatch[1].trim();
        }
        
        // Process and store concepts
        if (conceptsMatch && conceptsMatch[1]) {
          const conceptsText = conceptsMatch[1].trim();
          // Split by bullet points, numbers, or new lines
          analysis.conceptsToInclude = conceptsText
            .split(/\n|•|\*|\d+\.\s+/)
            .map(concept => concept.trim())
            .filter(concept => concept.length > 0);
        }
        
        // Store approach
        if (approachMatch && approachMatch[1]) {
          analysis.approach = approachMatch[1].trim();
        }
        
        // Set confidence based on content quality
        if (analysis.keyPoints.length > 3 && analysis.structure && analysis.conceptsToInclude.length > 0) {
          analysis.confidence = 'HIGH';
        } else if (analysis.keyPoints.length > 1) {
          analysis.confidence = 'MEDIUM';
        }
        
        // Create justification from approach
        analysis.justification = analysis.approach || 'Follow the structure and include the key points listed.';
      }
      // For short answer questions
      else if (questionData.type === 'short-answer') {
        // Extract answer, confidence, and key terms
        const answerMatch = response.match(/ANSWER:\s*([\s\S]*?)(?=CONFIDENCE:|KEY TERMS:|$)/i);
        const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
        const keyTermsMatch = response.match(/KEY TERMS:\s*([\s\S]*?)(?=ANSWER:|CONFIDENCE:|$)/i);
        
        // Store model answer
        if (answerMatch && answerMatch[1]) {
          analysis.modelAnswer = answerMatch[1].trim();
        }
        
        // Store confidence
        if (confidenceMatch && confidenceMatch[1]) {
          analysis.confidence = confidenceMatch[1].toUpperCase();
        }
        
        // Process and store key terms
        if (keyTermsMatch && keyTermsMatch[1]) {
          const keyTermsText = keyTermsMatch[1].trim();
          // Split by bullet points, numbers, or new lines
          analysis.conceptsToInclude = keyTermsText
            .split(/\n|•|\*|\d+\.\s+|,/)
            .map(term => term.trim())
            .filter(term => term.length > 0);
        }
        
        // Use model answer as justification
        analysis.justification = analysis.modelAnswer;
      }
      // For other question types
      else {
        // Extract approach, key points, confidence, and justification
        const approachMatch = response.match(/APPROACH:\s*([\s\S]*?)(?=KEY POINTS:|CONFIDENCE:|JUSTIFICATION:|$)/i);
        const keyPointsMatch = response.match(/KEY POINTS:\s*([\s\S]*?)(?=APPROACH:|CONFIDENCE:|JUSTIFICATION:|$)/i);
        const confidenceMatch = response.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
        const justificationMatch = response.match(/JUSTIFICATION:\s*([\s\S]*?)(?=APPROACH:|KEY POINTS:|CONFIDENCE:|$)/i);
        
        // Store approach
        if (approachMatch && approachMatch[1]) {
          analysis.approach = approachMatch[1].trim();
        }
        
        // Process and store key points
        if (keyPointsMatch && keyPointsMatch[1]) {
          const keyPointsText = keyPointsMatch[1].trim();
          // Split by bullet points, numbers, or new lines
          analysis.keyPoints = keyPointsText
            .split(/\n|•|\*|\d+\.\s+/)
            .map(point => point.trim())
            .filter(point => point.length > 0);
        }
        
        // Store confidence
        if (confidenceMatch && confidenceMatch[1]) {
          analysis.confidence = confidenceMatch[1].toUpperCase();
        }
        
        // Store justification
        if (justificationMatch && justificationMatch[1]) {
          analysis.justification = justificationMatch[1].trim();
        } else if (analysis.approach) {
          // Use approach as fallback justification
          analysis.justification = analysis.approach;
        }
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