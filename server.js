const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

// ---------- DB CONNECT ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("Mongo ERR:", err));

// ---------- USER MODEL ----------
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    email: String,
    password: String
  })
);

// ---------- AUTH MIDDLEWARE ----------
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Missing token" });

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------- REGISTER ----------
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;

  let exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ error: "Email already exists" });

  const hashed = await bcrypt.hash(password, 10);

  await User.create({ email, password: hashed });

  res.json({ success: true });
});

// ---------- LOGIN ----------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  let user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

  res.json({ token });
});

// ---------- OPENAI + CLAUDE SETUP ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

// ---------- TEXT ----------
app.post("/api/text", auth, async (req, res) => {
  const { prompt, model } = req.body;

  try {
    let output;

    if (model === "openai") {
      const response = await openai.responses.create({
        model: "gpt-4.1",
        input: prompt
      });

      output = response.output[0].content[0].text;
    } else {
      const completion = await anthropic.messages.create({
        model: "claude-3-sonnet-20240229",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      });

      output = completion.content[0].text;
    }

    res.json({ result: output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- IMAGE ----------
app.post("/api/image", auth, async (req, res) => {
  const { prompt } = req.body;

  try {
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });

    res.json({ image: result.data[0].url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- SERVER ----------
app.listen(3000, () => console.log("XferLogic backend running on port 3000"));
