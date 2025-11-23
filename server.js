// -----------------------------
// Imports
// -----------------------------
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";

import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

// -----------------------------
// MongoDB Setup
// -----------------------------
const mongoClient = new MongoClient(process.env.MONGODB_URI);

let db, users, logs;

async function connectDB() {
    try {
        await mongoClient.connect();
        db = mongoClient.db(process.env.DB_NAME || "xferlogic");
        users = db.collection("users");
        logs = db.collection("usage_logs");

        console.log("✅ MongoDB Connected");
    } catch (err) {
        console.error("❌ MongoDB Error:", err);
    }
}

connectDB();

// -----------------------------
// JWT Authentication Middleware
// -----------------------------
function auth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Missing token" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // contains userId + email
        next();
    } catch (err) {
        return res.status(403).json({ error: "Invalid token" });
    }
}

// -----------------------------
// Register User
// -----------------------------
app.post("/api/register", async (req, res) => {
    const { email, password } = req.body;

    const existing = await users.findOne({ email });
    if (existing) return res.status(400).json({ error: "Email already exists" });

    const hash = bcrypt.hashSync(password, 10);

    await users.insertOne({
        email,
        password: hash,
        createdAt: new Date(),
    });

    res.json({ success: true });
});

// -----------------------------
// Login User
// -----------------------------
app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;

    const user = await users.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid email or password" });

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign(
        { userId: user._id.toString(), email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.json({ token });
});

// -----------------------------
// Current Logged-In User
// -----------------------------
app.get("/api/me", auth, async (req, res) => {
    const user = await users.findOne(
        { _id: new ObjectId(req.user.userId) },
        { projection: { password: 0 } }
    );
    res.json(user);
});

// -----------------------------
// Usage Logging
// -----------------------------
async function logUsage(userId, endpoint, tokens = 0, cost = 0) {
    await logs.insertOne({
        userId,
        endpoint,
        tokens,
        cost,
        createdAt: new Date(),
    });
}

// -----------------------------
// AI Clients
// -----------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// -----------------------------
// /api/text
// -----------------------------
app.post("/api/text", auth, async (req, res) => {
    const { prompt, model } = req.body;

    try {
        let output = "";
        let tokens = 0;
        let cost = 0;

        if (model === "openai") {
            const response = await openai.responses.create({
                model: "gpt-4.1",
                input: prompt,
            });

            output = response.output[0].content[0].text;
            tokens = response.usage.total_tokens;
            cost = tokens * 0.00001; // estimated
        } else {
            const completion = await anthropic.messages.create({
                model: "claude-3-sonnet-20240229",
                max_tokens: 1500,
                messages: [{ role: "user", content: prompt }],
            });

            output = completion.content[0].text;
            tokens = 1500; 
            cost = tokens * 0.000004;
        }

        await logUsage(req.user.userId, "/api/text", tokens, cost);

        res.json({ result: output });

    } catch (err) {
        console.error("❌ ERROR in /api/text:", err);
        res.status(500).json({ error: err.message });
    }
});

// -----------------------------
// /api/image
// -----------------------------
app.post("/api/image", auth, async (req, res) => {
    const { prompt } = req.body;

    try {
        const result = await openai.images.generate({
            model: "gpt-image-1",
            prompt,
            size: "1024x1024",
        });

        await logUsage(req.user.userId, "/api/image", 0, 0.001);

        res.json({ image: result.data[0].url });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// -----------------------------
// /api/pdf
// -----------------------------
app.post("/api/pdf", auth, async (req, res) => {
    const { text } = req.body;

    const doc = new PDFDocument();
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", async () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");

        await logUsage(req.user.userId, "/api/pdf");
        res.send(pdf);
    });

    doc.text(text);
    doc.end();
});

// -----------------------------
// /api/docx
// -----------------------------
app.post("/api/docx", auth, async (req, res) => {
    const { text } = req.body;

    const doc = new Document({
        sections: [{ children: [new Paragraph(text)] }],
    });

    const buffer = await Packer.toBuffer(doc);

    await logUsage(req.user.userId, "/api/docx");

    res.setHeader("Content-Type", "application/vnd.openxmlformats");
    res.send(buffer);
});

// -----------------------------
// /api/excel
// -----------------------------
app.post("/api/excel", auth, async (req, res) => {
    const { rows } = req.body;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    rows.forEach((r) => ws.addRow(r));

    const buffer = await wb.xlsx.writeBuffer();

    await logUsage(req.user.userId, "/api/excel");

    res.setHeader("Content-Type", "application/vnd.openxmlformats");
    res.send(buffer);
});

// -----------------------------
// /api/svg
// -----------------------------
app.post("/api/svg", auth, async (req, res) => {
    const { svg } = req.body;

    await logUsage(req.user.userId, "/api/svg");

    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
});

// -----------------------------
app.listen(3000, () =>
    console.log("🚀 XferLogic backend running on port 3000")
);
