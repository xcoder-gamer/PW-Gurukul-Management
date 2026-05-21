import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = 3000;

// Lazy initialization helper for Gemini SDK
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// QBG AI tagging endpoint
app.post("/api/qbg/tag", async (req, res) => {
  try {
    const { questions, taxonomy } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: "Missing required parameter: 'questions' array" });
    }

    const ai = getGeminiClient();

    // Prepare taxonomy context to help Gemini align keywords to the user's master schemas perfectly
    const taxonomyContext = taxonomy && Array.isArray(taxonomy) && taxonomy.length > 0
      ? `Here is the existing Master QBG taxonomy of standard categories present in Firestore. 
Whenever possible, you MUST strictly match your classifications to these existing Subject, Chapter, Topic, and Subtopic names. If a question absolutely doesn't fit, only then suggest a new matching term:
${JSON.stringify(taxonomy.slice(0, 150), null, 2)}`
      : "No existing taxonomy provided. Generate standardized subject, chapter, topic, and subtopics based on general curricula (e.g. PCM, JEE/NEET, or general education).";

    const prompt = `You are an expert curriculum supervisor and question classifier. Your task is to tag multiple questions with appropriate metadata (Subject, Chapter, Topic, Subtopic, and Difficulty level).

${taxonomyContext}

For each of the following questions, analyze the context, formula, terms, and context and return a structured tagging proposal.

---
QUESTIONS TO TAG:
${questions.map((q, i) => `[Question #${i + 1}]:
${q}`).join("\n\n")}
---`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You strictly output a JSON array of parsed questions, ensuring every single question is classified into subject, chapter, topic, subtopic (can be empty string if not applicable), and difficulty (either 'Easy', 'Medium', or 'Hard'). Do not write any markdown wrappers or comments inside JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          description: "List of parsed and tagged questions",
          items: {
            type: Type.OBJECT,
            properties: {
              questionIndex: { type: Type.INTEGER, description: "1-based index of the processed question." },
              questionText: { type: Type.STRING, description: "A trimmed summary of the processed question." },
              subject: { type: Type.STRING, description: "Recommended subject (matched to master if possible)." },
              subjectId: { type: Type.STRING, description: "A standard capitalized abbreviation of the subject, e.g. PHY, CHE, MAT, BIO." },
              chapter: { type: Type.STRING, description: "Recommended chapter name (matched to master if possible)." },
              chapterId: { type: Type.STRING, description: "A short, unique code for the chapter, e.g. CH01, ELECT_01." },
              topic: { type: Type.STRING, description: "Recommended topic name." },
              topicId: { type: Type.STRING, description: "A unique key/ID for the topic." },
              subtopic: { type: Type.STRING, description: "Recommended sub-topic name." },
              subtopicId: { type: Type.STRING, description: "A unique key/ID for the sub-topic." },
              difficulty: { type: Type.STRING, description: "Assessed level of difficulty: 'Easy', 'Medium', or 'Hard'." },
              reasoning: { type: Type.STRING, description: "A very brief one-sentence reason of why this classification fits." }
            },
            required: ["questionIndex", "subject", "subjectId", "chapter", "chapterId", "topic", "topicId", "difficulty"]
          }
        }
      }
    });

    const parsedData = JSON.parse(response.text || "[]");
    return res.json({ result: parsedData });
  } catch (err: any) {
    console.error("Gemini tagging endpoint failed:", err);
    return res.status(500).json({ error: err.message || "AI Tagging failed" });
  }
});

// Setup Vite & Static Assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
