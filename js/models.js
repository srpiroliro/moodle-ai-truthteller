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
    apiId: 'claude-3-5-sonnet-20241022'
  },
  {
    id: 'claude-3-7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'claude',
    apiId: 'claude-3-7-sonnet-20250219'
  },
  {
    id: 'claude-3-haiku',
    name: 'Claude 3 Haiku',
    provider: 'claude',
    apiId: 'claude-3-haiku-20240307'
  },
  {
    id: 'grok-1',
    name: 'Grok 1',
    provider: 'grok',
    apiId: 'grok-1'
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

// OpenAI API call function
async function callOpenAI(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  try {
    // Create the request payload
    const requestData = {
      type: 'openai_api_call',
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: apiModelId,
        messages: [
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    };
    
    // Force the API call to always proceed in extension environment
    console.log('TruthTeller: Making OpenAI API call to', apiModelId);
    
    // Send the request through the Chrome runtime messaging API
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(requestData, function(response) {
          if (chrome.runtime.lastError) {
            console.error('TruthTeller: Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!response) {
            console.error('TruthTeller: No response received from background script');
            reject(new Error('No response received from background script'));
            return;
          }
          
          if (response.error) {
            console.error('TruthTeller: Error in response:', response.error);
            reject(new Error(response.error));
            return;
          }
          
          try {
            const data = JSON.parse(response.data);
            console.log('TruthTeller: OpenAI API response received');
            resolve(data.choices[0].message.content);
          } catch (error) {
            console.error('TruthTeller: Error parsing OpenAI API response:', error, response.data);
            reject(new Error(`Error parsing OpenAI API response: ${error.message}`));
          }
        });
      } catch (sendError) {
        console.error('TruthTeller: Error sending message to background script:', sendError);
        reject(new Error(`Error sending message to background script: ${sendError.message}`));
      }
    });
  } catch (error) {
    console.error('TruthTeller: OpenAI API error:', error);
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

// Claude API call function
async function callClaude(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  try {
    // Create the request payload
    const requestData = {
      type: 'claude_api_call',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: apiModelId,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: message }
        ]
      })
    };
    
    // Force the API call to always proceed in extension environment
    console.log('TruthTeller: Making Claude API call to', apiModelId);
    
    // Send the request through the Chrome runtime messaging API
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(requestData, function(response) {
          if (chrome.runtime.lastError) {
            console.error('TruthTeller: Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!response) {
            console.error('TruthTeller: No response received from background script');
            reject(new Error('No response received from background script'));
            return;
          }
          
          if (response.error) {
            console.error('TruthTeller: Error in response:', response.error);
            reject(new Error(response.error));
            return;
          }
          
          try {
            const data = JSON.parse(response.data);
            console.log('TruthTeller: Claude API response received:', data);
            
            // Extract text content from the response
            if (data && data.content && Array.isArray(data.content) && data.content.length > 0) {
              resolve(data.content[0].text);
            } else {
              console.error('TruthTeller: Unexpected Claude API response format:', data);
              reject(new Error('Unexpected Claude API response format'));
            }
          } catch (error) {
            console.error('TruthTeller: Error parsing Claude API response:', error, response.data);
            reject(new Error(`Error parsing Claude API response: ${error.message}`));
          }
        });
      } catch (sendError) {
        console.error('TruthTeller: Error sending message to background script:', sendError);
        reject(new Error(`Error sending message to background script: ${sendError.message}`));
      }
    });
  } catch (error) {
    console.error('TruthTeller: Claude API error:', error);
    throw new Error(`Claude API error: ${error.message}`);
  }
}

// Grok API call function
async function callGrok(message, modelId, apiKey) {
  // Get the proper API model ID
  const apiModelId = getApiModelId(modelId);
  
  try {
    // Create the request payload
    const requestData = {
      type: 'grok_api_call',
      url: 'https://api.grok.ai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: apiModelId,
        messages: [
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    };
    
    // Force the API call to always proceed in extension environment
    console.log('TruthTeller: Making Grok API call to', apiModelId);
    
    // Send the request through the Chrome runtime messaging API
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(requestData, function(response) {
          if (chrome.runtime.lastError) {
            console.error('TruthTeller: Chrome runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (!response) {
            console.error('TruthTeller: No response received from background script');
            reject(new Error('No response received from background script'));
            return;
          }
          
          if (response.error) {
            console.error('TruthTeller: Error in response:', response.error);
            reject(new Error(response.error));
            return;
          }
          
          try {
            const data = JSON.parse(response.data);
            console.log('TruthTeller: Grok API response received');
            resolve(data.choices[0].message.content);
          } catch (error) {
            console.error('TruthTeller: Error parsing Grok API response:', error, response.data);
            reject(new Error(`Error parsing Grok API response: ${error.message}`));
          }
        });
      } catch (sendError) {
        console.error('TruthTeller: Error sending message to background script:', sendError);
        reject(new Error(`Error sending message to background script: ${sendError.message}`));
      }
    });
  } catch (error) {
    console.error('TruthTeller: Grok API error:', error);
    // For now, return a notice about Grok API being a placeholder
    return "Note: The Grok API implementation is currently a placeholder. Please check if X (Twitter) has released their Grok API publicly yet.";
  }
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
      default: throw new Error(`Unknown provider: ${defaultModel.provider}`);
    }
  }
  
  // Determine which API function to use based on provider
  switch (model.provider) {
    case 'openai': return callOpenAI;
    case 'claude': return callClaude;
    case 'grok': return callGrok;
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