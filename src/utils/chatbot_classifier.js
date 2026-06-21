/**
 * Custom NLP Intent Classifier (Naive Bayes + Keyword Overlap Hybrid)
 * For MediMonitor Hospital Chatbot
 */

class ChatbotClassifier {
    constructor() {
        this.vocabulary = new Set();
        this.intents = {}; // Maps intent -> { category, response, redirect_url, wordCounts, totalWords, phraseCount }
        this.totalPhrasesCount = 0;
        this.isTrained = false;
        this.trainingPhrasesList = []; // Array of { intent, tokens } for Jaccard overlap checking
    }

    // Basic tokenization: lowercase, remove special characters, split into words
    tokenize(text) {
        if (!text || typeof text !== 'string') return [];
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.trim().length > 0);
    }

    // Train the classifier on an array of intents
    train(data) {
        console.log('[Chatbot Model] Starting model training...');
        
        // Reset state
        this.vocabulary.clear();
        this.intents = {};
        this.totalPhrasesCount = 0;
        this.trainingPhrasesList = [];

        data.forEach(item => {
            const { intent, category, response, redirect_url, training_phrases } = item;
            
            // split by semicolon
            const phrases = training_phrases.split(';').map(p => p.trim()).filter(p => p.length > 0);
            
            if (!this.intents[intent]) {
                this.intents[intent] = {
                    category,
                    response,
                    redirect_url,
                    wordCounts: {},
                    totalWords: 0,
                    phraseCount: 0
                };
            }

            const intentInfo = this.intents[intent];

            phrases.forEach(phrase => {
                const tokens = this.tokenize(phrase);
                if (tokens.length === 0) return;

                intentInfo.phraseCount += 1;
                this.totalPhrasesCount += 1;
                
                this.trainingPhrasesList.push({ intent, tokens });

                tokens.forEach(token => {
                    this.vocabulary.add(token);
                    intentInfo.wordCounts[token] = (intentInfo.wordCounts[token] || 0) + 1;
                    intentInfo.totalWords += 1;
                });
            });
        });

        this.isTrained = true;
        console.log(`[Chatbot Model] Training finished! Total intents: ${Object.keys(this.intents).length}, Phrases: ${this.totalPhrasesCount}, Vocabulary: ${this.vocabulary.size} words.`);
    }

    // Helper: Compute Jaccard Similarity between query tokens and training phrase tokens
    computeJaccardSimilarity(tokensA, tokensB) {
        const setA = new Set(tokensA);
        const setB = new Set(tokensB);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }

    // Classify user input and return the best matching intent
    classify(queryText) {
        if (!this.isTrained) {
            return {
                intent: 'unknown',
                category: 'faq',
                response: 'I am still learning! Please wait a moment while I prepare.',
                redirect_url: null,
                confidence: 0
            };
        }

        const queryTokens = this.tokenize(queryText);
        
        // 1. Fallback for empty queries
        if (queryTokens.length === 0) {
            return {
                intent: 'unknown',
                category: 'faq',
                response: 'Hello! I am your MediMonitor Assistant. How can I help you today? You can ask me questions about demo accounts, real-time alerts, roles, beds, security, or ask me to navigate to any page.',
                redirect_url: null,
                confidence: 0
            };
        }

        // 2. Compute Naive Bayes probabilities
        const nbScores = {};
        const vocabSize = this.vocabulary.size;

        Object.keys(this.intents).forEach(intent => {
            const intentInfo = this.intents[intent];
            
            // Prior probability: P(intent)
            let logProb = Math.log(intentInfo.phraseCount / this.totalPhrasesCount);

            // Conditional word probabilities: P(word | intent) with Laplace smoothing
            queryTokens.forEach(token => {
                // If token is in general vocabulary, calculate probability.
                // If it is completely out of vocabulary, we ignore it to avoid penalizing new words,
                // but we still smooth if it's inside the vocabulary but not this intent.
                if (this.vocabulary.has(token)) {
                    const count = intentInfo.wordCounts[token] || 0;
                    const wordProb = (count + 1) / (intentInfo.totalWords + vocabSize);
                    logProb += Math.log(wordProb);
                } else {
                    // Out-of-vocabulary penalty smoothing
                    const wordProb = 1 / (intentInfo.totalWords + vocabSize);
                    logProb += Math.log(wordProb) * 0.1; // lower weight penalty for unrecognized words
                }
            });

            nbScores[intent] = logProb;
        });

        // 3. Find intent with highest Naive Bayes score
        let bestIntent = null;
        let highestScore = -Infinity;

        Object.keys(nbScores).forEach(intent => {
            if (nbScores[intent] > highestScore) {
                highestScore = nbScores[intent];
                bestIntent = intent;
            }
        });

        // 4. Compute Jaccard Overlap to check for exact keyword matching (highly effective for short commands like "login", "pricing")
        let bestJaccardIntent = null;
        let maxJaccard = 0;

        this.trainingPhrasesList.forEach(item => {
            const similarity = this.computeJaccardSimilarity(queryTokens, item.tokens);
            if (similarity > maxJaccard) {
                maxJaccard = similarity;
                bestJaccardIntent = item.intent;
            }
        });

        // 5. Decision logic: Combine Jaccard similarity and Naive Bayes
        // If Jaccard overlap is very strong (e.g. >= 0.3) or the query is extremely short (1-2 words),
        // let the keyword overlap override Naive Bayes to prevent smoothing bias.
        let finalIntent = bestIntent;
        let confidence = 0.5; // base level

        const knownTokens = queryTokens.filter(token => this.vocabulary.has(token));
        const knownRatio = knownTokens.length / queryTokens.length;

        if (maxJaccard >= 0.3 && bestJaccardIntent) {
            finalIntent = bestJaccardIntent;
            confidence = 0.8 + (maxJaccard * 0.2);
        } else if (queryTokens.length <= 2 && maxJaccard > 0 && bestJaccardIntent) {
            finalIntent = bestJaccardIntent;
            confidence = 0.7;
        } else if (knownRatio < 0.25) {
            // If the query contains too many unrecognized words relative to recognized words,
            // classify as unknown to prevent random false-positive matches.
            finalIntent = 'unknown';
            confidence = 0;
        } else {
            if (knownTokens.length === 0) {
                finalIntent = 'unknown';
                confidence = 0;
            }
        }

        // Return matched intent payload or fallback
        if (finalIntent && finalIntent !== 'unknown' && this.intents[finalIntent]) {
            const matched = this.intents[finalIntent];
            return {
                intent: finalIntent,
                category: matched.category,
                response: matched.response,
                redirect_url: matched.redirect_url,
                confidence: confidence
            };
        }

        // Default Fallback Response
        return {
            intent: 'unknown',
            category: 'faq',
            response: "I'm sorry, I didn't quite catch that. Could you rephrase your question?<br><br>You can ask me questions like: <br>• <em>\"How do I log in?\"</em> (to get test credentials)<br>• <em>\"How do real-time alerts work?\"</em><br>• <em>\"Take me to the pricing page\"</em><br>• <em>\"Go to features\"</em>",
            redirect_url: null,
            confidence: 0
        };
    }
}

// Singleton classifier instance
const classifierInstance = new ChatbotClassifier();

module.exports = classifierInstance;
