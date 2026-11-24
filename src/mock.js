"use strict";
// Used only when MOCK_AI=1 — lets you try the app end-to-end without an API key.
const mcq = (level, n) => ({ level, q: `[${level}] Sample question ${n}: choose option B ____`, options: ["Option A", "Option B (correct)", "Option C", "Option D"], answer: 1 });

async function respond(prompt) {
  await new Promise((r) => setTimeout(r, 300));
  if (prompt.includes("oral examiner")) {
    return { cefr: "B2", score: 66, criteria: { fluency: 65, grammar: 64, vocabulary: 68, coherence: 70 }, perPrompt: [{ cefr: "B1", comment: "Mock comment." }, { cefr: "B2", comment: "Mock comment." }, { cefr: "B2", comment: "Mock comment." }], feedback: "Mock feedback: speaking evaluation runs through Claude in production." };
  }
  if (prompt.includes('"grammar"')) {
    return {
      grammar: ["A1", "A1", "A2", "A2", "B1", "B1", "B2", "B2", "C1", "C1", "C2", "C2"].map((l, i) => mcq(l, i + 1)),
      reading: [
        { level: "B1", title: "Sample passage", passage: "This is a mock reading passage used for testing the application without an API key.", questions: [mcq("A2", 1), mcq("B1", 2), mcq("B1", 3), mcq("B1", 4)] },
        { level: "C1", title: "Workplace email", passage: "This is a second, longer mock passage. In production, Claude writes this in the candidate's chosen language.", questions: [mcq("B2", 1), mcq("C1", 2), mcq("C1", 3), mcq("C2", 4)] },
      ],
    };
  }
  if (prompt.includes('"listening"')) {
    return {
      listening: [
        { level: "B1", script: "Hello, this is a sample voicemail. Please call me back tomorrow morning.", questions: [mcq("A2", 1), mcq("B1", 2), mcq("B1", 3)] },
        { level: "C1", script: "Good morning team. Today we will review the quarterly results and agree next steps.", questions: [mcq("B2", 1), mcq("C1", 2), mcq("C1", 3)] },
      ],
      speaking: [
        { level: "A2", prompt: "Introduce yourself and describe your daily routine.", prompt_en: "Introduce yourself and describe your daily routine." },
        { level: "B2", prompt: "Describe a time you solved a difficult customer problem.", prompt_en: "Describe a time you solved a difficult customer problem." },
        { level: "C1", prompt: "Should companies allow fully remote work? Justify your view.", prompt_en: "Should companies allow fully remote work? Justify your view." },
      ],
    };
  }
  return { cefr: "B2", score: 66, criteria: { fluency: 65, grammar: 64, vocabulary: 68, coherence: 70 }, perPrompt: [{ cefr: "B1", comment: "Mock comment." }, { cefr: "B2", comment: "Mock comment." }, { cefr: "B2", comment: "Mock comment." }], feedback: "Mock feedback: speaking evaluation runs through Claude in production." };
}
module.exports = { respond };
