require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// The Twilio API Client
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Route 1: Trigger an outbound call
app.get('/make-call', async (req, res) => {
    try {
        const call = await twilioClient.calls.create({
            url: `${process.env.NGROK_URL}/twiml`, // Twilio will fetch TwiML from here when call answers
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
    // We tell Twilio to start a bi-directional WebSocket stream
    const wssUrl = process.env.NGROK_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    
    const twiml = new twilio.twiml.VoiceResponse();
    const connect = twiml.connect();
    connect.stream({ url: `${wssUrl}/stream` });

    res.type('text/xml');
    res.send(twiml.toString());
});

// WebSocket Server: Handle live audio stream from Twilio
wss.on('connection', (ws) => {
    console.log("WebSocket connected to Twilio stream!");

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        if (data.event === 'start') {
            console.log(`Stream started. Stream SID: ${data.start.streamSid}`);
        }
        
        if (data.event === 'media') {
            // Raw ulaw audio payload from the phone
            const audioPayload = data.media.payload;
            // TODO: Send this payload to Deepgram STT
        }
        
        if (data.event === 'stop') {
            console.log("Stream stopped.");
        }
    });

    ws.on('close', () => {
        console.log("WebSocket connection closed.");
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Make sure NGROK is running and points to this port.`);
});
