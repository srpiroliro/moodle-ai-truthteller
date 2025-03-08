/**
 * TruthTeller LLM Chat - Background Script
 * Handles API requests from content script to bypass CORS restrictions
 */

console.log('TruthTeller background script loaded');

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log('TruthTeller background: Message received', request.type);
  
  // Handle different types of API requests
  if (request.type === 'openai_api_call' || 
      request.type === 'claude_api_call' || 
      request.type === 'grok_api_call') {
    
    console.log(`TruthTeller background: Processing ${request.type} request`);
    
    // Make the API call
    makeApiRequest(request)
      .then(response => {
        console.log(`TruthTeller background: API request successful, response length: ${response.length} chars`);
        sendResponse({ success: true, data: response });
      })
      .catch(error => {
        console.error('TruthTeller background: API request error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we will call sendResponse asynchronously
    return true;
  } else {
    console.log('TruthTeller background: Unknown message type', request.type);
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
    console.log(`TruthTeller background: Making ${request.type} request to ${request.url}`);
    console.log('TruthTeller background: Request headers:', request.headers);
    console.log('TruthTeller background: Request body preview:', request.body.substring(0, 200) + '...');
    
    // Make the fetch request
    console.log('TruthTeller background: Sending fetch request...');
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    
    console.log('TruthTeller background: Fetch response received, status:', response.status);
    
    // Check if the response is OK
    if (!response.ok) {
      const errorText = await response.text();
      console.error('TruthTeller background: API request failed with status:', response.status, response.statusText);
      console.error('TruthTeller background: Error response:', errorText);
      
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
    
    console.log(`TruthTeller background: ${request.type} response received, length: ${responseText.length} chars`);
    console.log('TruthTeller background: Response preview:', responseText.substring(0, 100) + '...');
    
    return responseText;
  } catch (error) {
    console.error('TruthTeller background: API request failed:', error);
    throw error;
  }
} 