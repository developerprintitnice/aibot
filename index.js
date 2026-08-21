require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const OpenAI = require('openai');

// 1. Structure the enquiry as a JSON object
const enquiry = {
  customerName: "Kedarnath Jimage",
  contact: "9881177140",
  requirement: "Bulk quote for Corporate Drinkware",
  quantity: "10+",
  productUrl: "https://printitnice.com/product-category/corporate-gifting/corporate-drinkware/"
};

async function getLLMResponse(enquiryData) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey || apiKey === 'your_moonshot_api_key_here') {
    console.error("\n❌ Error: MOONSHOT_API_KEY is missing or invalid in the .env file.");
    process.exit(1);
  }

  // Moonshot (Kimi) is OpenAI API compatible! 
  // We use the OpenAI SDK but point it to Moonshot's base URL.
  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: "https://api.moonshot.ai/v1",
  });

  // System instruction defining the agent's behavior
  const systemInstruction = `
You are a PrintItNice enquiry-handling assistant.
Your job:
- Understand the customer's enquiry.
- Generate a natural first response for a phone conversation.
- Ask only useful questions needed to understand the requirement.
- Never invent prices, availability, MOQ, delivery dates, or product details.
- If information is not available, say that a quotation/team member will confirm it.
- Keep the response short and suitable for speaking over a phone call.
- VERY IMPORTANT: Speak in a natural conversational mix of Hindi and English (Hinglish), just like a real Indian sales executive. For example start with something like "Hello Kedarnath, PrintItNice se baat kar rahi hu..."
  `;

  const prompt = `Here is the customer enquiry:\n\n${JSON.stringify(enquiryData, null, 2)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "moonshot-v1-8k", // Standard Moonshot Kimi model
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt }
      ],
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("\n❌ Moonshot/Kimi API Error:", error.message);
    process.exit(1);
  }
}

async function generateSpeech(textToSpeak) {
  const apiKey = process.env.FISH_API_KEY;
  if (!apiKey || apiKey === 'your_fish_audio_api_key_here') {
    console.error("\n❌ Error: FISH_API_KEY is missing or invalid in the .env file.");
    process.exit(1);
  }

  try {
    const response = await axios({
      method: "POST",
      url: "https://api.fish.audio/v1/tts",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "model": "s2.1-pro-free" // Utilizing the free developer tier
      },
      data: {
        text: textToSpeak,
        format: "mp3",
        ...(process.env.FISH_REFERENCE_ID && { reference_id: process.env.FISH_REFERENCE_ID })
      },
      responseType: "arraybuffer" // Safer for binary data
    });

    fs.writeFileSync("test.mp3", response.data);
    return Promise.resolve();

  } catch (error) {
    console.error("\n❌ Fish Audio API error:");
    if (error.response && error.response.data) {
      // If it's a stream, we might need to listen to data to log the error message
      console.error(error.response.data.toString());
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}

async function run() {
  console.log("\n=================================");
  console.log("      VOICE BOT PIPELINE");
  console.log("=================================\n");

  // Step 1: Enquiry
  console.log("1️⃣  CUSTOMER ENQUIRY");
  console.log("----------------------");
  console.log(JSON.stringify(enquiry, null, 2));
  console.log("\n          ↓\n");

  // Step 2: LLM (Moonshot Kimi)
  console.log("2️⃣  KIMI (MOONSHOT) RESPONSE");
  console.log("----------------------");
  const aiText = await getLLMResponse(enquiry);
  console.log(`"${aiText}"`);
  console.log("\n          ↓\n");

  // Step 3: Fish Audio
  console.log("3️⃣  FISH AUDIO");
  console.log("----------------------");
  console.log("Generating speech using s2.1-pro-free model...");
  await generateSpeech(aiText);
  console.log("\n          ↓\n");

  // Step 4: Output
  console.log("4️⃣  AUDIO FILE GENERATED");
  console.log("----------------------");
  console.log("✅ Saved to: test.mp3\n");
}

run();
