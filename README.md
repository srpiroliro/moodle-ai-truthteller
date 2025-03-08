# TruthTeller LLM Chat Extension

A browser extension that provides a chat interface to interact with various Large Language Models (LLMs) including OpenAI's GPT, Anthropic's Claude, and x.ai's Grok using your own API keys. It also includes a Moodle quiz helper that suggests the most probable correct answers for quiz questions.

## Features

- Clean and intuitive chat interface
- Support for multiple LLM providers:
  - OpenAI (GPT-3.5 Turbo, GPT-4)
  - Anthropic (Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku)
  - x.ai (Grok)
- Secure API key management (keys are stored in your browser's secure storage)
- Easy switching between different models
- Responsive design
- **Moodle Quiz Helper** - Analyze quiz questions and suggest probable correct answers

## Installation

### Developer Mode Installation

1. Clone this repository or download and extract the ZIP file
2. Open your browser and navigate to the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Firefox: `about:addons`
3. Enable "Developer mode"
4. Click "Load unpacked" (Chrome/Edge) or "Load Temporary Add-on" (Firefox)
5. Select the directory containing the extension files

## Usage

### Chat Interface

1. Click on the TruthTeller icon in your browser's extension toolbar
2. Click the settings icon (⚙️) to open the settings panel
3. Enter your API keys for the LLM providers you want to use
4. Select the LLM model you want to chat with from the dropdown
5. Type your message and press Enter or click the send button
6. Enjoy chatting with your chosen LLM!

### Moodle Quiz Helper

1. Make sure you have set up your API keys in the extension settings
2. Navigate to a Moodle quiz page
3. The extension will automatically detect quiz questions and add a floating control panel
4. Click the "Analyze Quiz Questions" button
5. Wait for the analysis to complete
6. The extension will mark the most probable correct answers with confidence indicators:
   - ✓ (Green) - High confidence
   - ! (Yellow) - Medium confidence
   - ? (Orange) - Low confidence
7. Hover over an indicator to see a brief justification
8. Important: The extension only suggests answers but does not select them for you

## API Keys

You will need to obtain API keys from the following providers to use their models:

- OpenAI API Key: [https://platform.openai.com/account/api-keys](https://platform.openai.com/account/api-keys)
- Anthropic Claude API Key: [https://console.anthropic.com/](https://console.anthropic.com/)
- Grok API Key: Not publicly available at the time of creation

## Privacy

Your API keys and chat history are stored locally in your browser's secure storage and are never sent to any server except the official API endpoints of the LLM providers.

## Development

### Project Structure

- `manifest.json`: Extension configuration
- `popup.html`: Main extension popup interface
- `css/style.css`: Styling for the popup
- `css/content.css`: Styling for the Moodle quiz helper
- `js/popup.js`: JavaScript for handling UI and API interactions in the popup
- `js/content.js`: Content script for detecting and analyzing Moodle quiz questions
- `icons/`: Extension icons

### Future Improvements

- Add conversation history storage
- Support for streaming responses
- Add more LLM providers
- Add support for system prompts and custom instructions
- Implement conversation context/memory
- Improve question detection for different Moodle themes and question types
- Add support for more learning management systems (LMS) beyond Moodle

## Legal Considerations

This extension is designed for educational purposes and to assist users in learning. Please be aware of the following considerations:

1. Academic Integrity: Using this tool to complete quizzes or exams may violate your institution's academic integrity policies.
2. Terms of Service: Using this tool may violate the terms of service of your educational institution or Moodle platform.

Users are responsible for ensuring their use of this extension complies with all applicable rules, regulations, and policies.

## License

MIT License

## Disclaimer

This extension is not affiliated with, endorsed by, or sponsored by OpenAI, Anthropic, x.ai, or Moodle. All trademarks and registered trademarks are the property of their respective owners. 