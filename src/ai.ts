import { requestUrl } from 'obsidian';

export class AIService {
    static async generateResponse(settings: any, context: string): Promise<string> {
        const { provider, apiKey, model } = settings.ai;
        if (!apiKey) return "API Key is missing. Please check settings.";

        try {
            if (provider === 'openai') {
                return await this.callOpenAI(apiKey, model, context);
            } else if (provider === 'gemini') {
                return await this.callGemini(apiKey, model, context);
            } else if (provider === 'openrouter') {
                return await this.callOpenRouter(apiKey, model, context);
            }
            return "Unsupported provider.";
        } catch (e: any) {
            console.error('Life Gauge AI Error:', e);
            return `Error: ${e.message || 'Failed to connect to AI'}`;
        }
    }

    private static async callOpenAI(apiKey: string, model: string, context: string) {
        const response = await requestUrl({
            url: 'https://api.openai.com/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: context }],
                max_tokens: 50
            })
        });
        return response.json.choices[0].message.content;
    }

    private static async callGemini(apiKey: string, model: string, context: string) {
        const response = await requestUrl({
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-pro'}:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: context }] }],
                generationConfig: {
                    maxOutputTokens: 50
                }
            })
        });
        return response.json.candidates[0].content.parts[0].text;
    }

    private static async callOpenRouter(apiKey: string, model: string, context: string) {
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
                messages: [{ role: 'user', content: context }],
                max_tokens: 50
            })
        });
        return response.json.choices[0].message.content;
    }
}
