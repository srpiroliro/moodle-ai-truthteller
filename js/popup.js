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
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    // Track upload statistics
    let uploadStats = {
      successful: 0,
      failed: 0,
      duplicate: 0,
      totalFiles: files.length
    };

    uploadInfo.textContent = `Processing ${files.length} file(s)...`;
    uploadInfo.className = 'upload-info';
    
    // Process each file in sequence
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      // Update progress during multiple file upload
      if (files.length > 1) {
        uploadInfo.textContent = `Processing file ${i+1}/${files.length}...`;
      }
      
      if (file.type !== 'application/pdf') {
        uploadInfo.textContent = `Error: Only PDF files are supported. "${file.name}" is not a PDF.`;
        uploadInfo.className = 'upload-info upload-error';
        uploadStats.failed++;
        continue;
      }
      
      // Check file size limits - warn for large files over 5MB
      if (file.size > 5 * 1024 * 1024) {
        console.warn(`TruthTeller: PDF "${file.name}" is very large (${formatFileSize(file.size)}), may cause storage issues`);
        uploadInfo.textContent = `Warning: "${file.name}" is very large (${formatFileSize(file.size)}). Extracting text...`;
        uploadInfo.className = 'upload-info';
      }
      
      // Check if PDF.js is available
      if (!window.pdfjsLib) {
        uploadInfo.textContent = 'Error: PDF processing library not available. Please refresh the extension and try again.';
        uploadInfo.className = 'upload-info upload-error';
        console.error('TruthTeller: PDF.js library not available during upload attempt');
        uploadStats.failed += (files.length - i);
        break; // No need to continue if the library isn't available
      }
      
      // Check if PDF with same name already exists
      const existingPdf = uploadedPdfs.find(pdf => pdf.name === file.name);
      if (existingPdf) {
        console.log(`TruthTeller: A PDF named "${file.name}" is already in context.`);
        uploadStats.duplicate++;
        continue;
      }
      
      try {
        const pdfText = await extractTextFromPdf(file);
        
        if (pdfText.trim() === '') {
          console.log(`TruthTeller: No text could be extracted from "${file.name}". It may be an image-based PDF or secured.`);
          uploadStats.failed++;
          continue;
        }
        
        // Add to uploaded PDFs list
        const newPdf = {
          name: file.name,
          text: pdfText,
          size: file.size,
          uploadTime: new Date().toISOString()
        };
        
        uploadedPdfs.push(newPdf);
        uploadStats.successful++;
        
      } catch (error) {
        console.error(`TruthTeller: PDF extraction error for "${file.name}":`, error);
        uploadStats.failed++;
      }
    }
    
    // Update the PDF list display
    renderPdfList();
    
    // Update the context with all PDF content
    updateCombinedContext();
    
    // Auto-enable the context
    useContextToggle.checked = true;
    useCustomContext = true;
    updateContextIndicator();
    
    // Show final status message
    if (files.length === 1) {
      if (uploadStats.successful === 1) {
        uploadInfo.textContent = `PDF "${files[0].name}" added successfully.`;
        uploadInfo.className = 'upload-info upload-success';
      } else if (uploadStats.duplicate === 1) {
        uploadInfo.textContent = `A PDF named "${files[0].name}" is already in your context.`;
        uploadInfo.className = 'upload-info upload-error';
      } else {
        uploadInfo.textContent = `Error processing PDF "${files[0].name}". It may be corrupted or secured.`;
        uploadInfo.className = 'upload-info upload-error';
      }
    } else {
      // Multiple files status summary
      uploadInfo.textContent = `Processed ${files.length} files: ${uploadStats.successful} added successfully, ${uploadStats.duplicate} duplicates, ${uploadStats.failed} failed.`;
      if (uploadStats.successful > 0) {
        uploadInfo.className = 'upload-info upload-success';
      } else {
        uploadInfo.className = 'upload-info upload-error';
      }
    }
    
    // Clear the file input for next upload
    pdfFileUpload.value = '';
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
    
    // Check context size and show warning if needed
    checkContextSize();
  }
  
  // Check the size of the context and display warnings if needed
  function checkContextSize() {
    if (!customContext || customContext.length === 0) return;
    
    const characterCount = customContext.length;
    const wordCount = customContext.trim().split(/\s+/).length;
    const estimatedSizeKB = Math.round(JSON.stringify({
      customContext: customContext,
      uploadedPdfs: uploadedPdfs
    }).length / 1024);
    
    const MAX_SAFE_SIZE_KB = 4000; // 4MB, leaving buffer below Chrome's 5MB limit
    const WARNING_SIZE_KB = 3000;  // 3MB, start warning at this size
    
    // Update the context size indicator in the UI
    const contextSizeIndicator = document.createElement('div');
    contextSizeIndicator.className = 'context-size-indicator';
    contextSizeIndicator.textContent = `Context size: ${estimatedSizeKB}KB (${wordCount.toLocaleString()} words, ${characterCount.toLocaleString()} chars)`;
    
    // Remove any existing size indicator
    const existingIndicator = document.querySelector('.context-size-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // Add the new indicator after the context input
    contextInput.parentNode.insertBefore(contextSizeIndicator, contextInput.nextSibling);
    
    // Style based on size
    if (estimatedSizeKB > MAX_SAFE_SIZE_KB) {
      contextSizeIndicator.classList.add('size-danger');
      uploadInfo.textContent = `Warning: Context size (${estimatedSizeKB}KB / ${wordCount.toLocaleString()} words) exceeds safe limit. Remove some PDFs before saving.`;
      uploadInfo.className = 'upload-info upload-error';
    } else if (estimatedSizeKB > WARNING_SIZE_KB) {
      contextSizeIndicator.classList.add('size-warning');
      uploadInfo.textContent = `Note: Context size (${estimatedSizeKB}KB / ${wordCount.toLocaleString()} words) is getting large. Consider removing unused PDFs.`;
      uploadInfo.className = 'upload-info';
    }
    
    return {
      sizeKB: estimatedSizeKB,
      wordCount: wordCount,
      characterCount: characterCount
    };
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
  
  // Clear custom context
  function clearContext() {
    // Clear the context input
    contextInput.value = '';
    customContext = '';
    
    // Clear uploaded PDFs
    uploadedPdfs = [];
    renderPdfList();
    
    // Disable context toggle
    useContextToggle.checked = false;
    useCustomContext = false;
    
    // Update the context indicator
    updateContextIndicator();
    
    // Remove any size indicator
    const existingIndicator = document.querySelector('.context-size-indicator');
    if (existingIndicator) {
      existingIndicator.remove();
    }
    
    // Clear any upload info messages
    uploadInfo.textContent = '';
    uploadInfo.className = 'upload-info';
    
    // Save the cleared state
    saveContext();
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
    // Load API keys and model preferences from sync storage (smaller data)
    chrome.storage.sync.get(
      ['openaiApiKey', 'claudeApiKey', 'grokApiKey', 'selectedModel', 'defaultModel'], 
      function(syncResult) {
        if (syncResult.openaiApiKey) openaiApiKeyInput.value = syncResult.openaiApiKey;
        if (syncResult.claudeApiKey) claudeApiKeyInput.value = syncResult.claudeApiKey;
        if (syncResult.grokApiKey) grokApiKeyInput.value = syncResult.grokApiKey;
        
        // Set the selected model from storage
        if (syncResult.selectedModel) {
          modelSelect.value = syncResult.selectedModel;
        }
        
        // Set the default model from storage or use the one from models.js
        if (syncResult.defaultModel) {
          defaultModelSelect.value = syncResult.defaultModel;
        } else {
          // Use the default model from models.js
          defaultModelSelect.value = getDefaultModelId();
        }
        
        // Load larger context data from local storage
        chrome.storage.local.get(
          ['customContext', 'useCustomContext', 'uploadedPdfs'],
          function(localResult) {
            // Handle case where data might still be in sync storage from previous versions
            if (!localResult.customContext && !localResult.uploadedPdfs) {
              chrome.storage.sync.get(
                ['customContext', 'useCustomContext', 'uploadedPdfs'],
                function(legacyResult) {
                  loadContextData(legacyResult);
                  
                  // If we found data in sync storage, migrate it to local storage
                  if (legacyResult.customContext || (legacyResult.uploadedPdfs && legacyResult.uploadedPdfs.length > 0)) {
                    console.log('TruthTeller: Migrating context data from sync to local storage');
                    chrome.storage.local.set({
                      customContext: legacyResult.customContext || '',
                      useCustomContext: legacyResult.useCustomContext || false,
                      uploadedPdfs: legacyResult.uploadedPdfs || []
                    });
                    
                    // Clear from sync storage after migration to avoid redundancy
                    chrome.storage.sync.remove(['customContext', 'useCustomContext', 'uploadedPdfs']);
                  }
                }
              );
            } else {
              // Data is already in local storage
              loadContextData(localResult);
            }
          }
        );
      }
    );
  }
  
  // Helper function to load context data from storage result
  function loadContextData(result) {
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
  }

  // Save settings to Chrome storage
  function saveSettings() {
    const settings = {
      openaiApiKey: openaiApiKeyInput.value.trim(),
      claudeApiKey: claudeApiKeyInput.value.trim(),
      grokApiKey: grokApiKeyInput.value.trim(),
      selectedModel: modelSelect.value,
      defaultModel: defaultModelSelect.value
    };
    
    chrome.storage.sync.set(settings, function() {
      if (chrome.runtime.lastError) {
        console.error('TruthTeller: Error saving settings:', chrome.runtime.lastError);
        return;
      }
      
      console.log('TruthTeller: Settings saved', {
        openaiKey: settings.openaiApiKey ? 'Set' : 'Not set',
        claudeKey: settings.claudeApiKey ? 'Set' : 'Not set',
        grokKey: settings.grokApiKey ? 'Set' : 'Not set',
        selectedModel: settings.selectedModel || 'Not set',
        defaultModel: settings.defaultModel || 'Not set'
      });
      
      // Close the settings panel
      settingsPanel.classList.remove('visible');
    });
  }

  // Save custom context to Chrome storage
  function saveContext() {
    // Calculate estimated size of context data
    const characterCount = customContext.length;
    const wordCount = customContext.trim().split(/\s+/).length;
    const contextJSON = JSON.stringify({
      customContext: customContext,
      useCustomContext: useCustomContext,
      uploadedPdfs: uploadedPdfs
    });
    
    const estimatedSizeKB = Math.round(contextJSON.length / 1024);
    const MAX_SAFE_SIZE_KB = 4000; // 4MB, leaving buffer below Chrome's 5MB limit
    
    if (estimatedSizeKB > MAX_SAFE_SIZE_KB) {
      uploadInfo.textContent = `Warning: Context size (${estimatedSizeKB}KB / ${wordCount.toLocaleString()} words) exceeds safe limit (${MAX_SAFE_SIZE_KB}KB). Some PDFs may need to be removed.`;
      uploadInfo.className = 'upload-info upload-error';
      
      // Still attempt to save, but user has been warned
      console.warn(`TruthTeller: Context size (${estimatedSizeKB}KB / ${wordCount.toLocaleString()} words / ${characterCount.toLocaleString()} chars) is very large and may exceed Chrome storage limits`);
    }
    
    const contextSettings = {
      customContext: customContext,
      useCustomContext: useCustomContext,
      uploadedPdfs: uploadedPdfs
    };
    
    // Use storage.local instead of storage.sync for much higher storage limits
    chrome.storage.local.set(contextSettings, function() {
      if (chrome.runtime.lastError) {
        console.error('TruthTeller: Error saving context:', chrome.runtime.lastError);
        uploadInfo.textContent = `Error saving context: ${chrome.runtime.lastError.message || 'Storage limit exceeded'}. Try removing some PDFs.`;
        uploadInfo.className = 'upload-info upload-error';
        return;
      }
      
      console.log('TruthTeller: Context settings saved', {
        customContext: customContext ? `${wordCount.toLocaleString()} words / ${characterCount.toLocaleString()} chars (${estimatedSizeKB}KB)` : 'Not set',
        useCustomContext: useCustomContext,
        uploadedPdfs: uploadedPdfs.length > 0 ? `${uploadedPdfs.length} PDFs (${estimatedSizeKB}KB)` : 'None'
      });
      
      updateContextIndicator();
      
      // Show success message
      uploadInfo.textContent = `Context saved successfully (${estimatedSizeKB}KB / ${wordCount.toLocaleString()} words / ${characterCount.toLocaleString()} chars).`;
      uploadInfo.className = 'upload-info upload-success';
    });
  }

  // Update the context indicator based on current state
  function updateContextIndicator() {
    if (useCustomContext && (customContext.trim() !== '' || uploadedPdfs.length > 0)) {
      contextIndicator.classList.add('active');
      
      // Update the title to show info about context sources
      let title = 'Custom context is active';
      
      if (customContext && customContext.length > 0) {
        const wordCount = customContext.trim().split(/\s+/).length;
        title += ` - ${wordCount.toLocaleString()} words, ${customContext.length.toLocaleString()} characters`;
      }
      
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