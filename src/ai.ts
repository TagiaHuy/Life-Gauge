import { requestUrl } from 'obsidian';
import { ChatMessage } from './data';

export class AIService {
    static async generateResponse(settings: any, systemPrompt: string, history: ChatMessage[], currentPrompt: string, maxTokens: number = 100): Promise<string> {
        const { provider, apiKey, model } = settings.ai;
        if (!apiKey) return "API Key is missing. Please check settings.";

        try {
            if (provider === 'openai') {
                return await this.callOpenAI(apiKey, model, systemPrompt, history, currentPrompt, maxTokens);
            } else if (provider === 'gemini') {
                return await this.callGemini(apiKey, model, systemPrompt, history, currentPrompt, maxTokens);
            } else if (provider === 'openrouter') {
                return await this.callOpenRouter(apiKey, model, systemPrompt, history, currentPrompt, maxTokens);
            }
            return "Unsupported provider.";
        } catch (e: any) {
            console.error('Life Gauge AI Error:', e);
            return `Error: ${e.message || 'Failed to connect to AI'}`;
        }
    }

    private static async callOpenAI(apiKey: string, model: string, systemPrompt: string, history: ChatMessage[], currentPrompt: string, maxTokens: number) {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: currentPrompt }
        ];

        const response = await requestUrl({
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'gpt-3.5-turbo',
                messages: messages,
                max_tokens: maxTokens
            })
        });
        return response.json.choices[0].message.content;
    }

    private static async callGemini(apiKey: string, model: string, systemPrompt: string, history: ChatMessage[], currentPrompt: string, maxTokens: number) {
        // Gemini uses 'model' instead of 'assistant' for role
        const contents = history.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

        // Add current prompt
        // We include system prompt in the first user message for Gemini or as a separate system instruction if supported
        // For simplicity and compatibility, we'll prepended system prompt to the first message or current message if history is empty
        if (contents.length === 0) {
            contents.push({
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n${currentPrompt}` }]
            });
        } else {
            // Prepend system prompt to the first user message in history
            const firstUserMsg = contents.find(c => c.role === 'user');
            if (firstUserMsg) {
                firstUserMsg.parts[0].text = `${systemPrompt}\n\n${firstUserMsg.parts[0].text}`;
            }
            contents.push({
                role: 'user',
                parts: [{ text: currentPrompt }]
            });
        }

        const response = await requestUrl({
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-pro'}:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contents,
                generationConfig: {
                    maxOutputTokens: maxTokens
                }
            })
        });
        return response.json.candidates[0].content.parts[0].text;
    }

    private static async callOpenRouter(apiKey: string, model: string, systemPrompt: string, history: ChatMessage[], currentPrompt: string, maxTokens: number) {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: currentPrompt }
        ];

        const response = await requestUrl({
            url: 'https://openrouter.ai/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://obsidian.md',
                'X-Title': 'Life-Gauge'
            },
            body: JSON.stringify({
                model: model || 'openai/gpt-3.5-turbo',
                messages: messages,
                max_tokens: maxTokens
            })
        });
        return response.json.choices[0].message.content;
    }
}
