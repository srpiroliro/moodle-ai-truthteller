document.addEventListener('DOMContentLoaded', function() {
  // DOM elements
  const settingsButton = document.getElementById('settingsButton');
  const settingsPanel = document.getElementById('settingsPanel');
  const saveSettingsButton = document.getElementById('saveSettings');
  const modelSelect = document.getElementById('modelSelect');
  const defaultModelSelect = document.getElementById('defaultModelSelect');
  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const moodleInfoToggle = document.getElementById('moodleInfoToggle');
  const moodleInfoPanel = document.getElementById('moodleInfoPanel');
  
  // Custom context elements
  const contextButton = document.getElementById('contextButton');
  const contextPanel = document.getElementById('contextPanel');
  const contextInput = document.getElementById('contextInput');
  const useContextToggle = document.getElementById('useContextToggle');
  const saveContextButton = document.getElementById('saveContext');
  const clearContextButton = document.getElementById('clearContext');
  const contextIndicator = document.getElementById('contextIndicator');
  const pdfFileUpload = document.getElementById('pdfFileUpload');
  const uploadInfo = document.getElementById('uploadInfo');
  const pdfList = document.getElementById('pdfList');

  // API Key input fields
  const openaiApiKeyInput = document.getElementById('openaiApiKey');
  const claudeApiKeyInput = document.getElementById('claudeApiKey');
  const grokApiKeyInput = document.getElementById('grokApiKey');

  // State variables
  let customContext = '';
  let useCustomContext = false;
  let uploadedPdfs = []; // Array to store uploaded PDF information
  
  // Initialize PDF.js worker
  if (window.pdfjsLib) {
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/lib/pdf.worker.min.js';
      console.log('TruthTeller: PDF.js worker initialized successfully');
    } catch (error) {
      console.error('TruthTeller: Failed to initialize PDF.js worker:', error);
    }
  } else {
    console.error('TruthTeller: PDF.js library not loaded');
  }

  // Add PDF file upload handler
  if (pdfFileUpload) {
    pdfFileUpload.addEventListener('change', handlePdfUpload);
  }

  // Handle PDF file upload
  async function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
      uploadInfo.textContent = 'Error: Only PDF files are supported.';
      uploadInfo.className = 'upload-info upload-error';
      return;
    }
    
    // Check if PDF.js is available
    if (!window.pdfjsLib) {
      uploadInfo.textContent = 'Error: PDF processing library not available. Please refresh the extension and try again.';
      uploadInfo.className = 'upload-info upload-error';
      console.error('TruthTeller: PDF.js library not available during upload attempt');
      return;
    }
    
    // Check if PDF with same name already exists
    const existingPdf = uploadedPdfs.find(pdf => pdf.name === file.name);
    if (existingPdf) {
      uploadInfo.textContent = `A PDF named "${file.name}" is already in your context.`;
      uploadInfo.className = 'upload-info upload-error';
      return;
    }
    
    uploadInfo.textContent = 'Reading PDF file...';
    uploadInfo.className = 'upload-info';
    
    try {
      const pdfText = await extractTextFromPdf(file);
      
      if (pdfText.trim() === '') {
        uploadInfo.textContent = 'Warning: No text could be extracted from the PDF. It may be an image-based PDF or secured.';
        uploadInfo.className = 'upload-info upload-error';
        return;
      }
      
      // Add to uploaded PDFs list
      const newPdf = {
        name: file.name,
        text: pdfText,
        size: file.size,
        uploadTime: new Date().toISOString()
      };
      
      uploadedPdfs.push(newPdf);
      
      // Update the PDF list display
      renderPdfList();
      
      // Update the context with all PDF content
      updateCombinedContext();
      
      // Auto-enable the context
      useContextToggle.checked = true;
      useCustomContext = true;
      updateContextIndicator();
      
      uploadInfo.textContent = `PDF "${file.name}" added (${Math.round(pdfText.length / 1024)} KB of text extracted)`;
      uploadInfo.className = 'upload-info upload-success';
      
      // Clear the file input for next upload
      pdfFileUpload.value = '';
      
    } catch (error) {
      console.error('PDF extraction error:', error);
      
      // Provide a more user-friendly error message
      let errorMessage = 'Error processing PDF. ';
      
      if (error.message.includes('PDF.js library not loaded')) {
        errorMessage += 'PDF processing library is not available. Please refresh the extension and try again.';
      } else if (error.message.includes('password')) {
        errorMessage += 'The PDF appears to be password-protected. Please remove the password protection and try again.';
      } else if (error.message.includes('corrupt')) {
        errorMessage += 'The PDF file appears to be corrupted.';
      } else {
        errorMessage += error.message;
      }
      
      uploadInfo.textContent = errorMessage;
      uploadInfo.className = 'upload-info upload-error';
    }
  }

  // Extract text from PDF
  async function extractTextFromPdf(file) {
    return new Promise((resolve, reject) => {
      if (!window.pdfjsLib) {
        console.error('TruthTeller: PDF.js library not available');
        reject(new Error('PDF.js library not loaded. Please refresh and try again.'));
        return;
      }
      
      console.log('TruthTeller: Starting PDF extraction for', file.name);
      const fileReader = new FileReader();
      
      fileReader.onload = async function(event) {
        try {
          const typedArray = new Uint8Array(event.target.result);
          console.log('TruthTeller: File read successfully, size:', typedArray.length, 'bytes');
          
          try {
            // Load the PDF file
            console.log('TruthTeller: Attempting to load PDF document');
            const loadingTask = window.pdfjsLib.getDocument({ data: typedArray });
            const pdf = await loadingTask.promise;
            
            console.log('TruthTeller: PDF loaded successfully, pages:', pdf.numPages);
            const numPages = pdf.numPages;
            let fullText = '';
            
            // Extract text from each page
            for (let i = 1; i <= numPages; i++) {
              console.log(`TruthTeller: Processing page ${i}/${numPages}`);
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              const pageText = content.items.map(item => item.str).join(' ');
              fullText += pageText + '\n\n';
            }
            
            console.log('TruthTeller: Text extraction complete, text length:', fullText.length);
            resolve(fullText);
          } catch (pdfError) {
            console.error('TruthTeller: PDF processing error:', pdfError);
            reject(new Error(`PDF processing error: ${pdfError.message}`));
          }
        } catch (error) {
          console.error('TruthTeller: Error processing file data:', error);
          reject(new Error(`Error processing file data: ${error.message}`));
        }
      };
      
      fileReader.onerror = function(error) {
        console.error('TruthTeller: FileReader error:', error);
        reject(new Error('Error reading file. Please try a different PDF.'));
      };
      
      fileReader.readAsArrayBuffer(file);
    });
  }
  
  // Render the list of uploaded PDFs
  function renderPdfList() {
    if (!pdfList) return;
    
    // Clear the current list
    pdfList.innerHTML = '';
    
    if (uploadedPdfs.length === 0) {
      const emptyMessage = document.createElement('li');
      emptyMessage.className = 'pdf-list-empty';
      emptyMessage.textContent = 'No PDFs uploaded';
      pdfList.appendChild(emptyMessage);
      return;
    }
    
    // Add each PDF to the list
    uploadedPdfs.forEach((pdf, index) => {
      const listItem = document.createElement('li');
      listItem.className = 'pdf-item';
      
      const icon = document.createElement('span');
      icon.className = 'pdf-icon';
      icon.textContent = '📄';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pdf-name';
      nameSpan.textContent = pdf.name;
      nameSpan.title = pdf.name;
      
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'pdf-size';
      sizeSpan.textContent = formatFileSize(pdf.size);
      
      const removeButton = document.createElement('button');
      removeButton.className = 'pdf-remove';
      removeButton.textContent = '×';
      removeButton.title = 'Remove this PDF';
      removeButton.dataset.index = index;
      removeButton.addEventListener('click', function() {
        removePdf(index);
      });
      
      listItem.appendChild(icon);
      listItem.appendChild(nameSpan);
      listItem.appendChild(sizeSpan);
      listItem.appendChild(removeButton);
      
      pdfList.appendChild(listItem);
    });
  }
  
  // Helper function to format file size
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  }
  
  // Remove a PDF from the list
  function removePdf(index) {
    if (index >= 0 && index < uploadedPdfs.length) {
      const removedPdf = uploadedPdfs[index];
      uploadedPdfs.splice(index, 1);
      
      // Update the context text
      updateCombinedContext();
      
      // Render the updated list
      renderPdfList();
      
      uploadInfo.textContent = `Removed "${removedPdf.name}" from context`;
      uploadInfo.className = 'upload-info';
      
      // Update the context indicator
      updateContextIndicator();
    }
  }
  
  // Update the combined context from all PDFs and manual input
  function updateCombinedContext() {
    let combinedText = '';
    
    // Add text from each PDF with a header
    uploadedPdfs.forEach(pdf => {
      combinedText += `=== PDF: ${pdf.name} ===\n${pdf.text}\n\n`;
    });
    
    // Add manual input text if it exists and is different from PDF content
    const manualText = contextInput.value.trim();
    if (manualText && !combinedText.includes(manualText)) {
      if (combinedText) {
        combinedText += '=== Manual Input ===\n';
      }
      combinedText += manualText;
    }
    
    // Update the context
    customContext = combinedText;
    
    // If manually entered text was the only context and we've now added PDFs,
    // update the textarea to show combined content
    if (uploadedPdfs.length > 0) {
      contextInput.value = combinedText;
    }
  }

  // Populate models dropdowns
  populateModelsDropdowns();
  
  // Load saved settings
  loadSettings();
  
  // Auto-resize textarea
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });

  // Toggle settings panel
  settingsButton.addEventListener('click', function() {
    settingsPanel.classList.toggle('visible');
    // Hide other panels if open
    if (moodleInfoPanel && moodleInfoPanel.classList.contains('visible')) {
      moodleInfoPanel.classList.remove('visible');
    }
    if (contextPanel && contextPanel.classList.contains('visible')) {
      contextPanel.classList.remove('visible');
    }
  });

  // Toggle Moodle info panel
  if (moodleInfoToggle) {
    moodleInfoToggle.addEventListener('click', function() {
      moodleInfoPanel.classList.toggle('visible');
      // Hide other panels if open
      if (settingsPanel.classList.contains('visible')) {
        settingsPanel.classList.remove('visible');
      }
      if (contextPanel && contextPanel.classList.contains('visible')) {
        contextPanel.classList.remove('visible');
      }
    });
  }

  // Toggle custom context panel
  if (contextButton) {
    contextButton.addEventListener('click', function() {
      contextPanel.classList.toggle('visible');
      // Hide other panels if open
      if (settingsPanel.classList.contains('visible')) {
        settingsPanel.classList.remove('visible');
      }
      if (moodleInfoPanel && moodleInfoPanel.classList.contains('visible')) {
        moodleInfoPanel.classList.remove('visible');
      }
    });
  }

  // Save settings
  saveSettingsButton.addEventListener('click', function() {
    saveSettings();
    settingsPanel.classList.remove('visible');
    // Add a confirmation message
    addMessageToChat('bot', 'Settings saved successfully. You can now use the selected model.');
  });

  // Save context
  saveContextButton.addEventListener('click', function() {
    // Update combined context in case manual text was edited
    updateCombinedContext();
    
    saveContext();
    contextPanel.classList.remove('visible');
    
    if (useCustomContext && customContext.trim() !== '') {
      let message = 'Custom context saved and activated.';
      
      if (uploadedPdfs.length > 0) {
        message += ` Using ${uploadedPdfs.length} PDF${uploadedPdfs.length > 1 ? 's' : ''} for context.`;
      } else if (contextInput.value.trim() !== '') {
        message += ' Using manual text input for context.';
      }
      
      addMessageToChat('bot', message);
    } else if (!useCustomContext) {
      addMessageToChat('bot', 'Custom context is disabled. Your questions will be answered without using the provided context.');
    } else {
      addMessageToChat('bot', 'No custom context provided. Please add some text or upload PDFs if you want to use custom context.');
    }
  });

  // Toggle custom context usage
  useContextToggle.addEventListener('change', function() {
    useCustomContext = this.checked;
    updateContextIndicator();
  });

  // Clear context button handler
  if (clearContextButton) {
    clearContextButton.addEventListener('click', clearContext);
  }
  
  // Clear all context data
  function clearContext() {
    // Clear the state variables
    uploadedPdfs = [];
    customContext = '';
    useCustomContext = false;
    
    // Clear the UI
    contextInput.value = '';
    useContextToggle.checked = false;
    renderPdfList();
    
    // Update the UI feedback
    uploadInfo.textContent = 'All context data cleared';
    uploadInfo.className = 'upload-info';
    
    // Save the cleared state to storage
    chrome.storage.sync.set({
      customContext: '',
      uploadedPdfs: [],
      useCustomContext: false
    }, function() {
      console.log('TruthTeller: Context cleared and saved to storage');
    });
    
    // Update the context indicator
    updateContextIndicator();
    
    // Close the context panel
    contextPanel.classList.remove('visible');
    
    // Show confirmation message
    addMessageToChat('bot', 'Context cleared. All uploaded PDFs and custom text have been removed.');
  }

  // Update textarea when context input changes
  contextInput.addEventListener('input', function() {
    // Check if we should update the custom context based on manual edits
    if (uploadedPdfs.length === 0) {
      // If no PDFs, directly update the custom context
      customContext = this.value;
    } else {
      // If we have PDFs, just append/update the manual section
      updateCombinedContext();
    }
  });

  // Send message when Send button is clicked
  sendButton.addEventListener('click', sendMessage);

  // Send message when Enter key is pressed (but allow Shift+Enter for new line)
  messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Populate both model dropdowns from the models.js list
  function populateModelsDropdowns() {
    const models = getAvailableModels();
    
    // Clear existing options in main model select
    modelSelect.innerHTML = '';
    defaultModelSelect.innerHTML = '';
    
    // Add options from the models list to both selects
    models.forEach(model => {
      // Add to main model select
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      modelSelect.appendChild(option);
      
      // Add to default model select
      const defaultOption = document.createElement('option');
      defaultOption.value = model.id;
      defaultOption.textContent = model.name;
      defaultModelSelect.appendChild(defaultOption);
    });
    
    // Get the current default model
    const currentDefaultModelId = getDefaultModelId();
    
    // Set the default model selection in the dropdown
    if (currentDefaultModelId) {
      defaultModelSelect.value = currentDefaultModelId;
    }
    
    // Set current model to default if not already selected
    if (modelSelect.value === '') {
      modelSelect.value = currentDefaultModelId;
    }
    
    console.log('TruthTeller: Models populated, current model:', modelSelect.value);
    console.log('TruthTeller: Default model:', defaultModelSelect.value);
  }

  // Load saved settings from Chrome storage
  function loadSettings() {
    chrome.storage.sync.get(
      ['openaiApiKey', 'claudeApiKey', 'grokApiKey', 'selectedModel', 'defaultModel', 'customContext', 'useCustomContext', 'uploadedPdfs'], 
      function(result) {
        if (result.openaiApiKey) openaiApiKeyInput.value = result.openaiApiKey;
        if (result.claudeApiKey) claudeApiKeyInput.value = result.claudeApiKey;
        if (result.grokApiKey) grokApiKeyInput.value = result.grokApiKey;
        
        // Load uploaded PDFs if available
        if (result.uploadedPdfs && Array.isArray(result.uploadedPdfs)) {
          uploadedPdfs = result.uploadedPdfs;
          renderPdfList();
        }
        
        // Load custom context settings
        if (result.customContext) {
          customContext = result.customContext;
          contextInput.value = customContext;
        }
        
        if (result.useCustomContext !== undefined) {
          useCustomContext = result.useCustomContext;
          useContextToggle.checked = useCustomContext;
          updateContextIndicator();
        }
        
        // Set the selected model from storage
        if (result.selectedModel) {
          modelSelect.value = result.selectedModel;
        }
        
        // Set the default model from storage or use the one from models.js
        if (result.defaultModel) {
          defaultModelSelect.value = result.defaultModel;
        } else {
          // Use the default model from models.js
          defaultModelSelect.value = getDefaultModelId();
        }
        
        console.log('TruthTeller: Settings loaded', {
          openaiKey: result.openaiApiKey ? 'Set' : 'Not set',
          claudeKey: result.claudeApiKey ? 'Set' : 'Not set',
          grokKey: result.grokApiKey ? 'Set' : 'Not set',
          selectedModel: modelSelect.value || 'Not set',
          defaultModel: defaultModelSelect.value || 'Not set',
          customContext: customContext ? `Set (${customContext.length} chars)` : 'Not set',
          uploadedPdfs: uploadedPdfs.length > 0 ? `${uploadedPdfs.length} PDFs` : 'None',
          useCustomContext: useCustomContext
        });
      }
    );
  }

  // Save settings to Chrome storage
  function saveSettings() {
    const settings = {
      openaiApiKey: openaiApiKeyInput.value,
      claudeApiKey: claudeApiKeyInput.value,
      grokApiKey: grokApiKeyInput.value,
      selectedModel: modelSelect.value,
      defaultModel: defaultModelSelect.value
    };
    
    // Save selected model in storage
    chrome.storage.sync.set(settings, function() {
      console.log('TruthTeller: Settings saved', {
        openaiKey: settings.openaiApiKey ? 'Set' : 'Not set',
        claudeKey: settings.claudeApiKey ? 'Set' : 'Not set',
        grokKey: settings.grokApiKey ? 'Set' : 'Not set',
        selectedModel: settings.selectedModel,
        defaultModel: settings.defaultModel
      });
    });
    
    // Update the default model in models.js
    if (settings.defaultModel) {
      setDefaultModelId(settings.defaultModel);
    }
  }

  // Save custom context to Chrome storage
  function saveContext() {
    const contextSettings = {
      customContext: customContext,
      useCustomContext: useCustomContext,
      uploadedPdfs: uploadedPdfs
    };
    
    chrome.storage.sync.set(contextSettings, function() {
      console.log('TruthTeller: Context settings saved', {
        customContext: customContext ? `${customContext.length} chars` : 'Not set',
        useCustomContext: useCustomContext,
        uploadedPdfs: uploadedPdfs.length > 0 ? `${uploadedPdfs.length} PDFs` : 'None'
      });
      
      updateContextIndicator();
    });
  }

  // Update the context indicator based on current state
  function updateContextIndicator() {
    if (useCustomContext && (customContext.trim() !== '' || uploadedPdfs.length > 0)) {
      contextIndicator.classList.add('active');
      
      // Update the title to show info about context sources
      let title = 'Custom context is active';
      
      if (uploadedPdfs.length > 0) {
        title += ` - Using ${uploadedPdfs.length} PDF${uploadedPdfs.length > 1 ? 's' : ''}`;
        if (uploadedPdfs.length <= 3) {
          title += ': ' + uploadedPdfs.map(pdf => pdf.name).join(', ');
        }
      }
      
      contextIndicator.title = title;
    } else {
      contextIndicator.classList.remove('active');
      contextIndicator.title = 'Custom context is inactive';
    }
  }

  // Send message function
  async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Add user message to chat
    addMessageToChat('user', message);
    
    // Clear input field and reset height
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    // Show typing indicator
    showTypingIndicator();
    
    try {
      // Get selected model ID and find model details
      const selectedModelId = modelSelect.value || getDefaultModelId();
      const selectedModel = getModelById(selectedModelId);
      
      console.log('TruthTeller: Using model', {
        id: selectedModelId,
        details: selectedModel ? {
          name: selectedModel.name,
          provider: selectedModel.provider,
          apiId: selectedModel.apiId
        } : 'Not found'
      });
      
      if (!selectedModel) {
        hideTypingIndicator();
        addMessageToChat('bot', 'Error: Unknown model selected. Please check your settings.');
        return;
      }
      
      // Get API key based on the provider
      const apiKey = getApiKeyForProvider(selectedModel.provider);
      
      console.log('TruthTeller: API key check', {
        provider: selectedModel.provider,
        keyAvailable: apiKey ? 'Yes' : 'No'
      });
      
      if (!apiKey) {
        hideTypingIndicator();
        addMessageToChat('bot', `Error: API key not set for ${selectedModel.name}. Please check your settings.`);
        return;
      }
      
      // Prepare the full message with context if enabled
      let fullMessage = message;
      
      if (useCustomContext && customContext.trim() !== '') {
        fullMessage = `IMPORTANT - CONTEXT INFORMATION (THIS MUST BE USED AS THE PRIMARY SOURCE OF INFORMATION):\n${customContext.trim()}\n\nYou MUST prioritize the above context when answering the question. Even if you think you know a different answer, use ONLY the information in the context. If a specific answer is mentioned in the context, use exactly that answer.\n\nQuestion: ${message}\n\n`;
        
        // Log context usage
        console.log('TruthTeller: Using custom context', {
          contextLength: customContext.length,
          useCustomContext: useCustomContext,
          pdfCount: uploadedPdfs.length
        });
      }
      
      // Log the full prompt for debugging
      console.log('TruthTeller: Full prompt for LLM:', fullMessage);
      
      // Call the appropriate API using the centralized function
      const apiCallFunction = getApiCallFunction(selectedModelId);
      const response = await apiCallFunction(fullMessage, selectedModelId, apiKey);
      
      // Log the response
      console.log('TruthTeller: LLM response:', response);
      
      // Remove typing indicator and add response to chat
      hideTypingIndicator();
      addMessageToChat('bot', response);
    } catch (error) {
      hideTypingIndicator();
      addMessageToChat('bot', `Error: ${error.message}`);
      console.error('API call error:', error);
    }
  }

  // Add a message to the chat
  function addMessageToChat(sender, text) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.classList.add(sender === 'user' ? 'user-message' : 'bot-message');
    
    // Format text with line breaks
    messageElement.innerHTML = text.replace(/\n/g, '<br>');
    
    // Add timestamp
    const timeElement = document.createElement('div');
    timeElement.classList.add('message-time');
    const now = new Date();
    timeElement.textContent = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    messageElement.appendChild(timeElement);
    
    chatContainer.appendChild(messageElement);
    
    // Scroll to bottom
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // Show typing indicator
  function showTypingIndicator() {
    const typingElement = document.createElement('div');
    typingElement.id = 'typingIndicator';
    typingElement.classList.add('typing-indicator');
    
    // Add three dots for animation
    for (let i = 0; i < 3; i++) {
      const dotElement = document.createElement('span');
      typingElement.appendChild(dotElement);
    }
    
    chatContainer.appendChild(typingElement);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    const typingElement = document.getElementById('typingIndicator');
    if (typingElement) {
      typingElement.remove();
    }
  }

  // Get API key for provider
  function getApiKeyForProvider(provider) {
    switch(provider) {
      case 'openai':
        return openaiApiKeyInput.value;
      case 'claude':
        return claudeApiKeyInput.value;
      case 'grok':
        return grokApiKeyInput.value;
      default:
        return null;
    }
  }

  // Add a welcome message when the extension loads
  addMessageToChat('bot', 'Welcome to TruthTeller LLM Chat! Set your API keys in the settings (⚙️) to get started.');
  
  // Initialize the PDF list display
  renderPdfList();
}); 