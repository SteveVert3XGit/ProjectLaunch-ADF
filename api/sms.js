// api/sms.js
// ─────────────────────────────────────────────────────────────────────────────
// ADF AI SMS Assistant — Twilio Webhook Handler
// Deploy this file to: /api/sms.js in your GitHub repo
// Vercel auto-deploys it as: https://project-launch-adf.vercel.app/api/sms
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a friendly, professional SMS assistant for Arbol De Fuego Services — a lawn and sprinkler care company in Denver Metro, CO. The owner is Ricardo.

YOUR ROLE:
- Answer questions about services, pricing, and service area
- Encourage potential customers to book an appointment on the website
- Keep all replies SHORT — this is SMS, so 1–3 sentences max per message
- Be warm, helpful, and professional
- Use plain text only — no markdown, no bullet points, no asterisks

SERVICES & PRICING:
- Sprinkler Turn-On (Spring startup): $89 flat — full zone test, head adjustment, controller check. Up to 10 zones.
- Sprinkler Winterization (Fall blowout): $89 flat — compressed-air blowout, water shutoff, backflow protection. Up to 10 zones.
- Lawn Mowing Recurring: $45/visit — weekly or bi-weekly, bag & haul clippings. Up to 5,000 sq ft.
- Lawn Mowing One-Time: $59 flat — single visit, edge & blow clean. Up to 5,000 sq ft.
- Edging & Trimming: $49 flat — string trimming around beds, fences, walkways, plus blade edging along curbs.
- Tree & Shrub Trimming: From $149 — free on-site estimate, pricing depends on size and scope.

SERVICE AREA: Aurora, Centennial, Parker, Englewood, Greenwood Village, Littleton, Highlands Ranch, Lone Tree (Denver Metro, CO)

BUSINESS HOURS: Monday through Saturday, 7AM to 5:30PM. Closed Sundays.

BOOKING WEBSITE: https://project-launch-adf.vercel.app
Tell customers they can book online in under 2 minutes at that URL.

CONTACT: Phone (720) 210-3718 | Email Appointment@ADFServices.com

RULES:
1. Keep every reply under 160 characters when possible — this is SMS.
2. If asked something you cannot confidently answer, say: "Great question! Ricardo will give you a call back to answer that personally."
3. Never make up prices or services not listed above.
4. If someone is ready to book, send them to: https://project-launch-adf.vercel.app
5. Be conversational and human — you represent Ricardo's small business.
6. Do not use emojis unless the customer uses them first.`;

// In-memory conversation store (works for demos; use a DB for production)
// Key: phone number, Value: array of { role, content } messages
const conversations = new Map();
const CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1 hour

export default async function handler(req, res) {
  // Only accept POST from Twilio
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const incomingMsg = (req.body?.Body || "").trim();
  const fromNumber = req.body?.From || "unknown";

  if (!incomingMsg) {
    return res.status(200).send(twiml("Sorry, I didn't receive your message. Please try again!"));
  }

  // ── Get or initialize conversation history for this phone number ──
  const now = Date.now();
  const convo = conversations.get(fromNumber) || { messages: [], lastActive: now };

  // Clear stale conversations (older than TTL)
  if (now - convo.lastActive > CONVERSATION_TTL_MS) {
    convo.messages = [];
  }

  // Add customer's new message
  convo.messages.push({ role: "user", content: incomingMsg });
  convo.lastActive = now;

  // Keep last 10 messages to stay within token limits
  if (convo.messages.length > 10) {
    convo.messages = convo.messages.slice(-10);
  }

  conversations.set(fromNumber, convo);

  // ── Call Claude API ──
  let reply;
  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: convo.messages
      })
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error("Claude API error:", data);
      throw new Error(data?.error?.message || "Claude API failed");
    }

    reply = data.content?.find(b => b.type === "text")?.text
      || "Ricardo will give you a call back shortly at (720) 210-3718!";

  } catch (err) {
    console.error("Error calling Claude:", err.message);
    reply = "Sorry, I'm having a moment. Ricardo will call you back shortly!";
  }

  // ── Add assistant reply to conversation history ──
  convo.messages.push({ role: "assistant", content: reply });
  conversations.set(fromNumber, convo);

  // ── Respond to Twilio with TwiML ──
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml(reply));
}

function twiml(message) {
  // Escape XML special characters
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${safe}</Message>
</Response>`;
}
