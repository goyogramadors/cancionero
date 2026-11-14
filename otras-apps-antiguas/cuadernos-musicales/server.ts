import "dotenv/config";
import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not set. AI Features will be disabled.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for JSON parsing
  app.use(express.json());

  // API Endpoints FIRST
  app.post("/api/ai/compose", async (req, res) => {
    try {
      const { vibe, key, keyType } = req.body;
      if (!vibe || !key || !keyType) {
        return res.status(400).json({ error: "Missing required parameters: vibe, key, keyType" });
      }

      if (!ai) {
        return res.status(503).json({ 
          error: "Gemini client is not initialized because the API Key is missing on the server. Please check the Secrets section in Settings." 
        });
      }

      const promptMsg = `Generate a creative 4-chord progression based on this vibe: "${vibe}". The current key context is ${key} ${keyType}.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: promptMsg,
        config: {
          systemInstruction: `You are an expert music theory tutor and professional songwriter.
Generate a creative, harmonically sound 4-chord progression in the Roman numeral system that matches the requested style or vibe.
The key context is ${key} ${keyType}.
- If the scale context is Major, typical degrees are: I, ii, iii, IV, V, vi, vii° (and variant modifications like V7, IV6, bVII).
- If the scale context is Minor, typical degrees are: i, ii°, III, iv, v, VI, VII (and variant modifications like V7, ii°7, bVI).
Borrow chords (e.g., secondary dominants or modal interchange chords) if the vibe explicitly demands it (like an 'exotic', 'cinematic' or 'jazz' vibe), but keep it practical for a standard chord pad UI.`,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              label: {
                type: Type.STRING,
                description: "A short, descriptive, poetic aesthetic name for the progression (maximum 15 characters, e.g., 'Sunset Chill', 'Graveyard Neo', 'Epic Quest')"
              },
              degrees: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING
                },
                description: "An array of exactly 4 Roman numeral chords matching the key (e.g. ['I', 'V', 'vi', 'IV'] or ['i', 'VI', 'III', 'VII'])"
              }
            },
            required: ["label", "degrees"]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response text generated from Gemini model.");
      }

      const parsedJSON = JSON.parse(responseText.trim());
      return res.json(parsedJSON);
    } catch (err: any) {
      console.error("AI Composer Error:", err);
      return res.status(500).json({ 
        error: "Failed to generate chord progression via Gemini AI.",
        details: err?.message || String(err)
      });
    }
  });

  // Serve static assets and handle routing
  if (process.env.NODE_ENV !== "production") {
    // In development mode, mount Vite middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production mode, serve built assets
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
