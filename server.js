const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.send('Proxy Gemini Ultra-Rápido Online!');
});

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const apiKey = authHeader.replace('Bearer ', '').trim() || process.env.GEMINI_API_KEY;
    const model = req.body.model;
    const isStream = req.body.stream === true;

        const contents = [];
    for (const m of req.body.messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += '\n\n' + m.content;
      } else {
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }
    if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
      contents.push({ role: 'user', parts: [{ text: 'Continue.' }] });
    }


    const systemInstruction = req.body.messages.find(m => m.role === 'system');

    const payload = {
      contents,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ],
        generationConfig: {
        temperature: req.body.temperature ?? 0.8,
        maxOutputTokens: (req.body.max_tokens && req.body.max_tokens > 0) ? req.body.max_tokens : 65536,
      }
    };

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction.content }] };
    }

    const endpoint = isStream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const baseUrl = ['https:/', 'generativelanguage' + '.googleapis.com', 'v1beta', 'models/'].join('/');
    const url = `${baseUrl}${model}:${endpoint}key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).send(errText);
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) {
                const openAiChunk = {
                  choices: [{ delta: { content: text } }]
                };
                res.write(`data: ${JSON.stringify(openAiChunk)}\n\n`);
              }
            } catch (e) {}
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      res.json({
        choices: [{ message: { role: 'assistant', content: text } }]
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
