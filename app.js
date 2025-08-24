// LLM Agent POC - Main Application
import { getProfile } from "https://aipipe.org/aipipe.js";
import { openaiConfig } from "https://cdn.jsdelivr.net/npm/bootstrap-llm-provider@1.2";

class LLMAgent {
    constructor() {
        // --- Core Configuration ---
        this.API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6IjIzZjIwMDA3OTJAZHMuc3R1ZHkuaWl0bS5hYy5pbiJ9.oIy6j8weP5b1So9uKvJlklBHlCepxF_NRQZjqQK5jFg'; 
        this.BASE_URL = 'https://aipipe.org/openai/v1';
        this.SELECTED_MODEL = 'gpt-4o-mini';

        this.messages = [];
        this.isProcessing = false;
        this.config = null;
        this.userProfile = null;
        this.currentTheme = 'light';
        this.isAuthenticated = false;
        
        // --- Tool definitions ---
        this.tools = [
            {
                type: "function",
                function: {
                    name: "search_web",
                    description: "Search the web using Google search and return snippets and links",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query to execute"
                            },
                            num_results: {
                                type: "integer",
                                description: "Number of results to return (default: 5)",
                                default: 5
                            }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "execute_code",
                    description: "Execute JavaScript code in a sandboxed environment",
                    parameters: {
                        type: "object",
                        properties: {
                            code: {
                                type: "string",
                                description: "The JavaScript code to execute"
                            }
                        },
                        required: ["code"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "ai_pipe_request",
                    description: "Make a request to AI Pipe proxy for various AI workflows",
                    parameters: {
                        type: "object",
                        properties: {
                            endpoint: {
                                type: "string",
                                description: "The API endpoint to call"
                            },
                            method: {
                                type: "string",
                                description: "HTTP method (GET, POST, etc.)",
                                default: "GET"
                            },
                            data: {
                                type: "object",
                                description: "Request payload for POST requests"
                            }
                        },
                        required: ["endpoint"]
                    }
                }
            }
        ];

        this.codeExecutionPromise = null;
    }

    // --- Initialization and UI Setup ---
    async init() {
        try {
            // Set up UI event listeners
            this.setupEventListeners();
            
            // Add welcome message
            this.addMessage('assistant', 'Hello! I\'m your AI assistant with web search, code execution, and AI workflow capabilities. What can I help you with today?');
            
        } catch (error) {
            console.error('Initialization failed:', error);
            this.showError('Failed to initialize application. Please refresh the page.');
        }
    }

    setupEventListeners() {
        const sendBtn = document.getElementById('sendBtn');
        const userInput = document.getElementById('userInput');
        const clearChatBtn = document.getElementById('clearChat');
        const sampleQueries = document.querySelectorAll('.sample-query');
        
        sendBtn.addEventListener('click', () => this.handleUserInput());
        
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleUserInput();
            }
        });
        
        userInput.addEventListener('input', () => {
            sendBtn.disabled = this.isProcessing || userInput.value.trim() === '';
        });

        clearChatBtn.addEventListener('click', () => this.clearChat());
        
        sampleQueries.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const query = e.target.getAttribute('data-query');
                userInput.value = query;
                this.handleUserInput();
            });
        });

        // Set up sandboxed iframe communication
        window.addEventListener('message', (event) => {
            if (this.codeExecutionPromise && event.source === document.getElementById('codeExecutionFrame').contentWindow) {
                if (event.data.error) {
                    this.codeExecutionPromise.reject(new Error(event.data.error));
                } else {
                    this.codeExecutionPromise.resolve({
                        result: event.data.result,
                        output: event.data.output,
                        code: event.data.code
                    });
                }
                this.codeExecutionPromise = null;
            }
        });
    }

    clearChat() {
        this.messages = [];
        document.getElementById('chatMessages').innerHTML = '';
        this.addMessage('assistant', 'Chat cleared. How can I help you today?');
    }

    // --- Core Agent Logic ---
    async handleUserInput() {
        const userInput = document.getElementById('userInput');
        const userMessage = userInput.value.trim();

        if (!userMessage || this.isProcessing) return;

        // Clear input and update UI
        userInput.value = '';
        this.isProcessing = true;
        document.getElementById('sendBtn').disabled = true;

        this.addMessage('user', userMessage);

        try {
            this.messages.push({
                role: 'user',
                content: userMessage
            });

            await this.agentLoop();

        } catch (error) {
            console.error('Agent processing error:', error);
            this.showError(`Processing failed: ${error.message}`);
            this.addMessage('assistant', 'Sorry, I encountered an error processing your request. Please try again.');
        } finally {
            this.isProcessing = false;
            document.getElementById('sendBtn').disabled = false;
            userInput.focus();
        }
    }

    async agentLoop() {
        let maxIterations = 10;
        let iteration = 0;

        while (iteration < maxIterations) {
            iteration++;
            let assistantResponse = { content: '', tool_calls: [] };

            try {
                // LLM Call
                const response = await this.callLLM(this.messages);
                assistantResponse = response.choices[0].message;

                // Add assistant response to messages
                this.messages.push({
                    role: 'assistant',
                    content: assistantResponse.content || '',
                    tool_calls: assistantResponse.tool_calls || null
                });

                // Display assistant response
                if (assistantResponse.content) {
                    this.addMessage('assistant', assistantResponse.content);
                }

                // Check for tool calls
                if (assistantResponse.tool_calls && assistantResponse.tool_calls.length > 0) {
                    const toolResults = [];
                    for (const toolCall of assistantResponse.tool_calls) {
                        this.showToolExecution(toolCall.function.name);
                        
                        try {
                            const result = await this.executeTool(toolCall);
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                role: 'tool',
                                content: JSON.stringify(result)
                            });
                        } catch (error) {
                            console.error('Tool execution failed:', error);
                            toolResults.push({
                                tool_call_id: toolCall.id,
                                role: 'tool', 
                                content: JSON.stringify({ error: error.message })
                            });
                        }
                    }
                    this.messages.push(...toolResults);
                } else {
                    break;
                }

            } catch (error) {
                console.error('Agent loop error:', error);
                throw error;
            }
        }

        if (iteration >= maxIterations) {
            this.showError('Agent reached maximum iteration limit. The conversation may be incomplete.');
        }
    }

    async callLLM(messages) {
        const requestBody = {
            model: this.SELECTED_MODEL,
            messages: messages,
            tools: this.tools,
            tool_choice: 'auto'
        };

        const response = await fetch(`${this.BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`LLM API call failed: ${response.status} - ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        return data;
    }

    // --- Tool Execution Logic ---
    async executeTool(toolCall) {
        const { name, arguments: args } = toolCall.function;
        const parsedArgs = JSON.parse(args);

        switch (name) {
            case 'search_web':
                return this.executeWebSearch(parsedArgs);
            case 'execute_code':
                return this.executeCode(parsedArgs);
            case 'ai_pipe_request':
                return this.executeAIPipeRequest(parsedArgs);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async executeWebSearch(args) {
        console.log(`Executing search_web with query: ${args.query}`);
        // Mocking the search API response as per the original prompt
        return {
            results: [
                {
                    title: `Mock Search Result for "${args.query}"`,
                    url: "https://example.com/search-result",
                    snippet: `This is a demo search result for your query: "${args.query}". The agent would use a real search API here.`
                }
            ],
            query: args.query
        };
    }

    async executeCode(args) {
        console.log(`Executing code: ${args.code}`);
        return new Promise((resolve, reject) => {
            const iframe = document.getElementById('codeExecutionFrame');
            this.codeExecutionPromise = { resolve, reject };

            iframe.contentWindow.postMessage({
                type: 'execute',
                code: args.code
            }, '*');

            setTimeout(() => {
                if (this.codeExecutionPromise) {
                    this.codeExecutionPromise.reject(new Error('Code execution timed out after 10 seconds.'));
                    this.codeExecutionPromise = null;
                }
            }, 10000);
        });
    }

    async executeAIPipeRequest(args) {
        console.log(`Executing AI Pipe request to: ${args.endpoint}`);
        const url = `https://aipipe.org${args.endpoint}`;
        const options = {
            method: args.method || 'GET',
            headers: {
                'Authorization': `Bearer ${this.API_KEY}`,
                'Content-Type': 'application/json'
            }
        };

        if (args.data && (args.method === 'POST' || args.method === 'PUT')) {
            options.body = JSON.stringify(args.data);
        }

        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`AI Pipe request failed: ${response.status}`);
        }
        const data = await response.json();
        return {
            success: true,
            data: data,
            endpoint: args.endpoint,
            status: response.status
        };
    }

    // --- UI/Helper Functions ---
    showToolExecution(toolName) {
    }

    addMessage(role, content) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        
        const roleClasses = { 'user': 'user-message', 'assistant': 'assistant-message' };
        const roleIcons = { 'user': 'bi-person-circle', 'assistant': 'bi-robot' };

        messageDiv.className = `message ${roleClasses[role] || 'assistant-message'}`;
        messageDiv.innerHTML = `
            <div class="message__avatar">
                <i class="bi ${roleIcons[role] || 'bi-robot'}"></i>
            </div>
            <div class="message__content">
                <div class="message__text">${this.formatMessage(content)}</div>
                <div class="message__time">${new Date().toLocaleTimeString()}</div>
            </div>
        `;

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    formatMessage(content) {
        return content
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/https?:\/\/[^\s]+/g, '<a href="$&" target="_blank">$&</a>');
    }

    showError(message) {
        this.showAlert(message, 'danger');
    }

    showSuccess(message) {
        this.showAlert(message, 'success');
    }

    showAlert(message, type) {
        const alertsContainer = document.getElementById('alerts');
        const alertDiv = document.createElement('div');
        
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        alertsContainer.appendChild(alertDiv);
        setTimeout(() => { if (alertDiv.parentNode) alertDiv.remove(); }, 5000);
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const agent = new LLMAgent();
    await agent.init();
});

// Code to be injected into the sandboxed iframe
const iframeCode = `
    window.addEventListener('message', (event) => {
        if (event.data.type === 'execute') {
            try {
                let output = [];
                const originalLog = console.log;
                console.log = (...args) => {
                    output.push(args.join(' '));
                };
                
                let result = eval(event.data.code);
                
                window.parent.postMessage({
                    type: 'executionResult',
                    result: result !== undefined ? result : 'undefined',
                    output: output.join('\\n')
                }, '*');
            } catch (error) {
                window.parent.postMessage({
                    type: 'executionResult',
                    error: error.message
                }, '*');
            }
        }
    });
`;
const iframe = document.getElementById('codeExecutionFrame');
iframe.srcdoc = `<script>${iframeCode}</script>`;