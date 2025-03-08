/**
 * TruthTeller Models API
 * Centralized functions for calling different LLM APIs
 */

// Hardcoded default model to use as fallback
const FALLBACK_DEFAULT_MODEL_ID = 'claude-3-7-sonnet';

// Current default model ID (to be updated from chrome.storage)
let currentDefaultModelId = FALLBACK_DEFAULT_MODEL_ID;

// List of available models with their proper API identifiers
const AVAILABLE_MODELS = [
  {
    id: 'gpt-4',           // Internal ID used for selection and storage
    name: 'OpenAI GPT-4',  // Display name 
    provider: 'openai',    // Provider name for API key lookup
    apiId: 'gpt-4'         // Actual model ID to send to the API
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'OpenAI GPT-3.5 Turbo',
    provider: 'openai',
    apiId: 'gpt-3.5-turbo'
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    provider: 'claude',
    apiId: 'claude-3-opus-20240229'
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'claude',
    apiId: 'claude-3-5-sonnet-latest'
  },
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'claude',
    apiId: 'claude-3-7-sonnet-latest'
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'claude',
    apiId: 'claude-3.5-haiku-latest'
  },
  {
    id: 'grok-1',
    name: 'Grok 1',
    provider: 'grok',
    apiId: 'grok-1'
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    provider: 'deepseek',
    apiId: 'deepseek-chat'
  }
];

// Initialize by loading the default model from storage
(function initDefaultModel() {
  try {
    chrome.storage.sync.get(['defaultModel'], function(result) {
      if (result.defaultModel) {
        currentDefaultModelId = result.defaultModel;
        console.log('TruthTeller: Loaded default model from storage:', currentDefaultModelId);
      } else {
        console.log('TruthTeller: No default model in storage, using fallback:', FALLBACK_DEFAULT_MODEL_ID);
      }
    });
  } catch (e) {
    console.warn('TruthTeller: Failed to load default model from storage:', e);
  }
})();

// Get the API model ID for a given model ID
function getApiModelId(modelId) {
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  return model ? model.apiId : modelId; // Fallback to original ID if not found
}

/**
 * Makes an API call to an LLM service through the background script
 * @param {string} type - The type of API call (openai_api_call, claude_api_call, grok_api_call)
 * @param {string} url - The API endpoint URL
 * @param {Object} headers - Request headers
 * @param {Object} body - Request body as a JavaScript object (will be stringified)
 * @param {Function} responseParser - Function to parse the successful response
 * @returns {Promise<string>} - The text response from the LLM
 */
async function makeApiCall(type, url, headers, body, responseParser) {
  try {
    // Create the request payload
    const requestData = {
      type: type,
      url: url,
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    };
    
    // Send the request through the Chrome runtime messaging API
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(requestData, function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!response) {
            reject(new Error('No response received from background script'));
            return;
          }
          
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          
          try {
            const data = JSON.parse(response.data);
            resolve(responseParser(data));
          } catch (error) {
            reject(new Error(`Error parsing ${type} response: ${error.message}`));
          }
        });
      } catch (sendError) {
        reject(new Error(`Error sending message to background script: ${sendError.message}`));
      }
    });
  } catch (error) {
    throw new Error(`${type} error: ${error.message}`);
  }
}

// OpenAI API call function
async function callOpenAI(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  return makeApiCall(
    'openai_api_call',
    'https://api.openai.com/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    {
      model: apiModelId,
      messages: [
        { role: 'user', content: message }
      ],
      temperature: 0.7
    },
    (data) => data.choices[0].message.content
  );
}

// Claude API call function
async function callClaude(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  return makeApiCall(
    'claude_api_call',
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    {
      model: apiModelId,
      max_tokens: 1024,
      messages: [
        { role: 'user', content: message }
      ]
    },
    (data) => {
      if (data && data.content && Array.isArray(data.content) && data.content.length > 0) {
        return data.content[0].text;
      } else {
        throw new Error('Unexpected Claude API response format');
      }
    }
  );
}

// Grok API call function
async function callGrok(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  try {
    return makeApiCall(
      'grok_api_call',
      'https://api.grok.ai/v1/chat/completions',
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      {
        model: apiModelId,
        messages: [
          { role: 'user', content: message }
        ],
        temperature: 0.7
      },
      (data) => data.choices[0].message.content
    );
  } catch (error) {
    // For now, return a notice about Grok API being a placeholder
    return "Note: The Grok API implementation is currently a placeholder. Please check if X (Twitter) has released their Grok API publicly yet.";
  }
}

// DeepSeek API call function
async function callDeepSeek(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  return makeApiCall(
    'deepseek_api_call',
    'https://api.deepseek.com/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    {
      model: apiModelId,
      messages: [
        { role: 'user', content: message }
      ],
      temperature: 0.7
    },
    (data) => data.choices[0].message.content
  );
}

// Function to get the appropriate API call based on model
function getApiCallFunction(modelId) {
  // Find the model in our list
  const model = AVAILABLE_MODELS.find(m => m.id === modelId);
  
  if (!model) {
    console.error(`Unknown model ID: ${modelId}, using default model`);
    // Get the default model as fallback
    const defaultModel = getModelById(currentDefaultModelId);
    if (!defaultModel) {
      throw new Error(`Unknown model: ${modelId} and default model not found`);
    }
    // Use provider from default model
    switch (defaultModel.provider) {
      case 'openai': return callOpenAI;
      case 'claude': return callClaude;
      case 'grok': return callGrok;
      case 'deepseek': return callDeepSeek;
      default: throw new Error(`Unknown provider: ${defaultModel.provider}`);
    }
  }
  
  // Determine which API function to use based on provider
  switch (model.provider) {
    case 'openai': return callOpenAI;
    case 'claude': return callClaude;
    case 'grok': return callGrok;
    case 'deepseek': return callDeepSeek;
    default: throw new Error(`Unknown provider: ${model.provider}`);
  }
}

// Get model information by ID
function getModelById(modelId) {
  return AVAILABLE_MODELS.find(model => model.id === modelId) || 
         AVAILABLE_MODELS.find(model => model.id === currentDefaultModelId);
}

// Get all available models
function getAvailableModels() {
  return AVAILABLE_MODELS;
}

// Get default model ID
function getDefaultModelId() {
  return currentDefaultModelId;
}

// Set the default model ID and save to storage
function setDefaultModelId(modelId) {
  // Verify the model exists
  const modelExists = AVAILABLE_MODELS.some(model => model.id === modelId);
  if (!modelExists) {
    console.error(`Cannot set default model to "${modelId}" - model not found`);
    return false;
  }
  
  // Update the current default
  currentDefaultModelId = modelId;
  
  // Save to storage
  try {
    chrome.storage.sync.set({ defaultModel: modelId }, function() {
      console.log('TruthTeller: Default model saved to storage:', modelId);
    });
    return true;
  } catch (e) {
    console.error('TruthTeller: Failed to save default model to storage:', e);
    return false;
  }
} 