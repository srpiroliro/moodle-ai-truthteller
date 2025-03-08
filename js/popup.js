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
  const contextIndicator = document.getElementById('contextIndicator');

  // API Key input fields
  const openaiApiKeyInput = document.getElementById('openaiApiKey');
  const claudeApiKeyInput = document.getElementById('claudeApiKey');
  const grokApiKeyInput = document.getElementById('grokApiKey');

  // State variables
  let customContext = '';
  let useCustomContext = false;

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
    saveContext();
    contextPanel.classList.remove('visible');
    
    if (useCustomContext && customContext.trim() !== '') {
      addMessageToChat('bot', 'Custom context saved and activated. Your questions will now be answered based on this context.');
    } else if (!useCustomContext) {
      addMessageToChat('bot', 'Custom context is disabled. Your questions will be answered without using the provided context.');
    } else {
      addMessageToChat('bot', 'No custom context provided. Please add some text if you want to use custom context.');
    }
  });

  // Toggle custom context usage
  useContextToggle.addEventListener('change', function() {
    useCustomContext = this.checked;
    updateContextIndicator();
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
      ['openaiApiKey', 'claudeApiKey', 'grokApiKey', 'selectedModel', 'defaultModel', 'customContext', 'useCustomContext'], 
      function(result) {
        if (result.openaiApiKey) openaiApiKeyInput.value = result.openaiApiKey;
        if (result.claudeApiKey) claudeApiKeyInput.value = result.claudeApiKey;
        if (result.grokApiKey) grokApiKeyInput.value = result.grokApiKey;
        
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
          customContext: customContext ? 'Set' : 'Not set',
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
    customContext = contextInput.value;
    useCustomContext = useContextToggle.checked;
    
    const contextSettings = {
      customContext: customContext,
      useCustomContext: useCustomContext
    };
    
    chrome.storage.sync.set(contextSettings, function() {
      console.log('TruthTeller: Context settings saved', {
        customContext: customContext ? 'Set' : 'Not set',
        useCustomContext: useCustomContext
      });
      
      updateContextIndicator();
    });
  }

  // Update the context indicator based on current state
  function updateContextIndicator() {
    if (useCustomContext && customContext.trim() !== '') {
      contextIndicator.classList.add('active');
    } else {
      contextIndicator.classList.remove('active');
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
          useCustomContext: useCustomContext
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
}); 