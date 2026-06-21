/**
 * MediMonitor Chatbot Client Script
 * Handles UI interactions, message sending, and smart page redirection.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Only run the chatbot on the Home page (check path)
    const isHomePage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');
    if (!isHomePage) return;

    // Inject Chatbot HTML nodes dynamically
    injectChatbotMarkup();

    // Cache DOM Elements
    const launcher = document.getElementById('chatbot-launcher');
    const windowEl = document.getElementById('chatbot-window');
    const closeBtn = document.getElementById('chatbot-close');
    const messagesContainer = document.getElementById('chatbot-messages');
    const inputField = document.getElementById('chatbot-input');
    const sendBtn = document.getElementById('chatbot-send');
    const quickRepliesBox = document.getElementById('chatbot-quick-replies');

    let isFirstOpen = true;
    let redirectTimeout = null;

    // Toggle Chat Window
    launcher.addEventListener('click', () => {
        const isActive = windowEl.classList.contains('active');
        if (isActive) {
            windowEl.classList.remove('active');
        } else {
            windowEl.classList.add('active');
            launcher.classList.remove('pulse'); // stop pulsing once opened
            if (isFirstOpen) {
                showWelcomeSequence();
                isFirstOpen = false;
            }
            // Auto-focus input
            setTimeout(() => inputField.focus(), 150);
        }
    });

    closeBtn.addEventListener('click', () => {
        windowEl.classList.remove('active');
    });

    // Send Message on Enter
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    });

    // Send Message on Send Button Click
    sendBtn.addEventListener('click', () => {
        handleSendMessage();
    });

    // Inject the HTML markup into the body
    function injectChatbotMarkup() {
        // Chatbot Launcher Button
        const launcherDiv = document.createElement('div');
        launcherDiv.id = 'chatbot-launcher';
        launcherDiv.className = 'pulse';
        launcherDiv.innerHTML = '<i class="fas fa-comments"></i>';
        document.body.appendChild(launcherDiv);

        // Chatbot Drawer Window
        const windowDiv = document.createElement('div');
        windowDiv.id = 'chatbot-window';
        windowDiv.innerHTML = `
            <div class="chatbot-header">
                <div class="chatbot-header-info">
                    <div class="chatbot-avatar"><i class="fas fa-user-md"></i></div>
                    <div class="chatbot-title">
                        <h4>MediMonitor Assistant</h4>
                        <span class="chatbot-status">Online</span>
                    </div>
                </div>
                <button class="chatbot-close" id="chatbot-close" title="Close chat"><i class="fas fa-times"></i></button>
            </div>
            <div class="chatbot-messages" id="chatbot-messages"></div>
            <div class="quick-replies-container" id="chatbot-quick-replies"></div>
            <div class="chatbot-input-area">
                <input type="text" id="chatbot-input" placeholder="Ask a question or go to a page..." autocomplete="off">
                <button class="chatbot-send-btn" id="chatbot-send" title="Send message"><i class="fas fa-paper-plane"></i></button>
            </div>
        `;
        document.body.appendChild(windowDiv);
    }

    // Welcome sequence with quick replies
    function showWelcomeSequence() {
        addMessage("Hello there! I am your MediMonitor Virtual Assistant. 🏥", 'bot');
        setTimeout(() => {
            addMessage("I can answer your questions about our hospital platform, or directly guide you to any page! What would you like to do?", 'bot');
            renderQuickReplies([
                { label: '🔑 Demo Accounts', query: 'What are the demo login credentials?' },
                { label: '🚨 Emergency Alerts', query: 'How do real-time alerts work?' },
                { label: '💵 View Pricing', query: 'Take me to the pricing page' },
                { label: '⚙️ Explore Features', query: 'Show me features' }
            ]);
        }, 600);
    }

    // Append a message bubble to the messages list
    function addMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${sender}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerHTML = text;
        msgDiv.appendChild(bubble);

        // Add Timestamp
        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        const now = new Date();
        timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgDiv.appendChild(timeSpan);

        messagesContainer.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    // Scroll to the bottom of the message log
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Render quick reply chips
    function renderQuickReplies(items) {
        quickRepliesBox.innerHTML = '';
        items.forEach(item => {
            const chip = document.createElement('button');
            chip.className = 'quick-reply-chip';
            chip.textContent = item.label;
            chip.addEventListener('click', () => {
                inputField.value = item.query;
                handleSendMessage();
            });
            quickRepliesBox.appendChild(chip);
        });
    }

    // Show Typing Indicator
    function showTypingIndicator() {
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'chat-msg bot';
        indicatorDiv.id = 'chatbot-typing-indicator';
        indicatorDiv.innerHTML = `
            <div class="msg-bubble">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        messagesContainer.appendChild(indicatorDiv);
        scrollToBottom();
    }

    // Remove Typing Indicator
    function removeTypingIndicator() {
        const indicator = document.getElementById('chatbot-typing-indicator');
        if (indicator) indicator.remove();
    }

    // Core Send Message Action
    async function handleSendMessage() {
        const messageText = inputField.value.trim();
        if (!messageText) return;

        // Reset inputs and display user message
        inputField.value = '';
        addMessage(messageText, 'user');
        
        // Hide quick replies while loading
        quickRepliesBox.innerHTML = '';

        // Show typing dot animation
        showTypingIndicator();

        try {
            const response = await fetch('/api/chatbot/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText })
            });

            if (!response.ok) throw new Error('API Request Failed');
            const data = await response.json();

            // Simulate slight delay to feel natural
            setTimeout(() => {
                removeTypingIndicator();
                addMessage(data.response, 'bot');

                // If this is a navigation intent, assist the user
                if (data.redirect_url) {
                    showRedirectionCard(data.redirect_url);
                } else {
                    // Re-render standard FAQ quick replies
                    renderQuickReplies([
                        { label: '🔑 Demo Accounts', query: 'What are the demo login credentials?' },
                        { label: '🏥 Bed Occupancy', query: 'How does bed allocation work?' },
                        { label: '🛡️ Data Security', query: 'Is my data secure?' },
                        { label: '⚙️ Onboarding Steps', query: 'How does it work?' }
                    ]);
                }
            }, 500);

        } catch (err) {
            console.error('Chatbot fetch error:', err);
            setTimeout(() => {
                removeTypingIndicator();
                addMessage("I am experiencing connection issues. Please try again later.", 'bot');
            }, 500);
        }
    }

    // Renders the automatic countdown card for direct page navigation
    function showRedirectionCard(targetUrl) {
        // Clear any existing redirection timers
        if (redirectTimeout) clearTimeout(redirectTimeout);

        const card = document.createElement('div');
        card.className = 'nav-shortcut-card';
        card.innerHTML = `
            <div class="nav-shortcut-info">
                <i class="fas fa-route"></i>
                <span>Redirecting in 3 seconds...</span>
            </div>
            <div class="nav-countdown-bar-container">
                <div class="nav-countdown-bar" id="countdown-bar"></div>
            </div>
            <div class="nav-actions">
                <button class="nav-btn cancel" id="cancel-redirect">Cancel</button>
                <button class="nav-btn go" id="confirm-redirect">Go Now</button>
            </div>
        `;

        const botMsgDiv = document.createElement('div');
        botMsgDiv.className = 'chat-msg bot';
        botMsgDiv.appendChild(card);
        messagesContainer.appendChild(botMsgDiv);
        scrollToBottom();

        // 3-second redirect sequence
        redirectTimeout = setTimeout(() => {
            window.location.href = targetUrl;
        }, 3000);

        // Cancel Redirection handler
        card.querySelector('#cancel-redirect').addEventListener('click', () => {
            clearTimeout(redirectTimeout);
            redirectTimeout = null;
            
            // UI state change: disable buttons and show cancelled status
            card.querySelector('.nav-countdown-bar').style.animationPlayState = 'paused';
            card.querySelector('.nav-shortcut-info').innerHTML = '<i class="fas fa-times-circle" style="color: var(--danger-color)"></i> <span style="color: var(--danger-color)">Redirection cancelled.</span>';
            card.querySelector('.nav-actions').style.display = 'none';

            // Print normal suggestions back
            setTimeout(() => {
                addMessage("Staying on home page. How else can I assist you?", 'bot');
                renderQuickReplies([
                    { label: '🔑 Demo Accounts', query: 'What are the demo login credentials?' },
                    { label: '📞 Contact Sales', query: 'Contact sales' },
                    { label: '📖 User Guides', query: 'Go to documentation' }
                ]);
            }, 300);
        });

        // Go Now handler
        card.querySelector('#confirm-redirect').addEventListener('click', () => {
            clearTimeout(redirectTimeout);
            window.location.href = targetUrl;
        });
    }
});
