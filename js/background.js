/**
 * TruthTeller LLM Chat - Background Script
 * Handles API requests from content script to bypass CORS restrictions
 */

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // Handle different types of API requests
  if (request.type === 'openai_api_call' || 
      request.type === 'claude_api_call' || 
      request.type === 'grok_api_call') {
    
    // Make the API call
    makeApiRequest(request)
      .then(response => {
        sendResponse({ success: true, data: response });
      })
      .catch(error => {
        console.error('API request error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will call sendResponse asynchronously
    return true;
  } else {
    // Send a response even for unknown message types
    sendResponse({ success: false, error: 'Unknown message type' });
    return true;
  }
});

/**
 * Make an API request and return the response
 */
async function makeApiRequest(request) {
  try {
    // Make the fetch request
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    // Check if the response is OK
    if (!response.ok) {
      const errorText = await response.text();
      
      let errorMessage;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || `${response.status}: ${response.statusText}`;
      } catch {
        errorMessage = `${response.status}: ${response.statusText}`;
      }
      
      throw new Error(errorMessage);
    }
    
    // Return the response as text
    const responseText = await response.text();
    
    return responseText;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
} 