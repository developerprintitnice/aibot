require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const { DeepgramClient } = require('@deepgram/sdk');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const { WaveFile } = require('wavefile');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize API Clients
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const systemInstruction = `
You are a PrintItNice enquiry-handling assistant.
Your job:
- Ask the customer what they need.
- Generate a natural response for a phone conversation.
- Never invent prices or dates.
- Keep the response short (1-2 sentences).
- Speak in a natural conversational mix of Hindi and English (Hinglish), just like a real Indian sales executive.
`;

// Route 1: Trigger an outbound call
app.get('/make-call', async (req, res) => {
    try {
        const publicUrl = req.protocol + '://' + req.get('host');
        const call = await twilioClient.calls.create({
            url: `${publicUrl}/twiml`,
            to: process.env.MY_PHONE_NUMBER,
            from: process.env.TWILIO_PHONE_NUMBER
        });
        res.json({ message: 'Call initiated!', callSid: call.sid });
    } catch (error) {
        console.error("Error making call:", error);
        res.status(500).json({ error: error.message });
    }
});

// Route 2: Provide TwiML to Twilio when the call connects
app.post('/twiml', (req, res) => {
    const publicUrl = req.protocol + '://' + req.get('host');
    const wssUrl = publicUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    const twiml = new twilio.twiml.VoiceResponse();
    // We tell Twilio to connect directly to our WebSocket for live audio streaming
    const connect = twiml.connect();
    connect.stream({ url: `${wssUrl}/stream` });

    res.type('text/xml');
    res.send(twiml.toString());
});

// Route 3: Health check for Render
app.get('/', (req, res) => {
    res.send("✅ PrintItNice Voice Bot is running live on Render!");
});

// WebSocket Server: Handle live audio stream from Twilio
wss.on('connection', (ws, req) => {
    if (req.url !== '/stream') {
        ws.close();
        return;
    }
    
    console.log("\n☎️ Twilio Call Connected!");
    let streamSid = null;
    let dgConnection = null;

    // Helper to generate speech and send it back to Twilio
    async function playAudioToTwilio(text) {
        if (!streamSid) return;
        try {
            console.log(`🤖 Bot says: "${text}"`);
            
            // 1. Generate Speech via Fish Audio (as a WAV file)
            const response = await axios({
                method: "POST",
                url: "https://api.fish.audio/v1/tts",
                headers: {
                    "Authorization": `Bearer ${process.env.FISH_API_KEY}`,
                    "Content-Type": "application/json",
                    "model": "s2.1-pro-free"
                },
                data: {
                    text: text,
                    format: "wav",
                    ...(process.env.FISH_REFERENCE_ID && { reference_id: process.env.FISH_REFERENCE_ID })
                },
                responseType: "arraybuffer"
            });

            // 2. Twilio expects 8000Hz, mono, mu-law encoded base64 audio.
            // So we use WaveFile to convert the high-quality Fish Audio down to Twilio's required format.
            const wavBuffer = Buffer.from(response.data);
            const wav = new WaveFile(wavBuffer);
            
            wav.toSampleRate(8000); // Downsample to 8kHz
            wav.toMuLaw();          // Encode as mu-law (G.711)
            
            // Extract the raw audio bytes
            const ulawBytes = Buffer.from(wav.data.samples);
            
            // 3. Send back to Twilio
            const payload = ulawBytes.toString('base64');
            ws.send(JSON.stringify({
                event: "media",
                streamSid: streamSid,
                media: { payload: payload }
            }));

        } catch (err) {
            console.error("❌ Audio generation error:", err.message);
        }
    }

    // Initialize Deepgram WebSocket to listen to the customer
    const setupDeepgram = async () => {
        try {
            dgConnection = await deepgram.listen.v1.createConnection({
                model: "nova-3",
                language: "hi", // Indian accented English + Hindi mix
                encoding: "mulaw",
                sample_rate: 8000,
                channels: 1,
                endpointing: 500,
            });

            dgConnection.on("open", () => {
                console.log("👂 Deepgram listening to customer...");
                playAudioToTwilio("Hello, Kedarnath, Print It Nice se baat kar rahi hu. How can I help you today?");
            });

            dgConnection.on("Results", async (data) => {
                if (!data.channel || !data.channel.alternatives[0]) return;
                
                const transcript = data.channel.alternatives[0].transcript;
                
                if (data.is_final && transcript.trim() !== "") {
                    console.log(`\n👤 Customer says: "${transcript}"`);
                    
                    const prompt = `Customer just said: "${transcript}". Reply to them following your system instructions.`;
                    try {
                        const aiResponse = await ai.models.generateContent({
                            model: 'gemini-3.6-flash',
                            contents: prompt,
                            config: { systemInstruction: systemInstruction }
                        });
                        const replyText = aiResponse.text;
                        await playAudioToTwilio(replyText);
                    } catch (err) {
                        console.error("❌ Gemini Error:", err.message);
                    }
                }
            });

            dgConnection.on("error", (err) => {
                console.error("❌ Deepgram Error:", err);
            });

            dgConnection.connect();
            await dgConnection.waitForOpen();
            
        } catch (err) {
            console.error("Deepgram Connection Error:", err);
        }
    };
    
    setupDeepgram();

    // Handle incoming audio from the customer's phone
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.event === 'start') {
            streamSid = data.start.streamSid;
            console.log(`\n📡 Stream started. Stream SID: ${streamSid}`);
        }
        
        if (data.event === 'media') {
            // Forward raw audio from the phone directly into Deepgram
            const audioPayload = Buffer.from(data.media.payload, 'base64');
            if (dgConnection && dgConnection.getReadyState() === 1) {
                dgConnection.send(audioPayload);
            }
        }
        
        if (data.event === 'stop') {
            console.log("📡 Stream stopped (Call ended).");
            if (dgConnection) dgConnection.finish();
        }
    });

    ws.on('close', () => {
        console.log("❌ Twilio WebSocket closed.");
        if (dgConnection) dgConnection.finish();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
