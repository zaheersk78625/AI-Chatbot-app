import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const generateAIResponse = async (
  prompt: string,
  image?: { data: string; mimeType: string },
  history: { role: 'user' | 'model'; parts: { text: string }[] }[] = []
) => {
  try {
    const model = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        ...history.map(h => ({ role: h.role, parts: h.parts })),
        {
          parts: [
            { text: prompt },
            ...(image ? [{ inlineData: { data: image.data, mimeType: image.mimeType } }] : [])
          ]
        }
      ],
      config: {
        systemInstruction: "You are an advanced AI assistant with vision capabilities. Provide helpful, accurate, and concise responses. If an image is provided, analyze it thoroughly including any text or objects visible.",
      }
    });

    const response = await model;
    return response.text || "I'm sorry, I couldn't generate a response.";
  } catch (error) {
    console.error("AI Generation Error:", error);
    throw error;
  }
};
