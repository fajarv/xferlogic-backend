import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "20mb" }));

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY });
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

app.post("/api/text", async (req, res) => {
    const { prompt, model } = req.body;
    try {
        let output;
        if (model === "openai") {
            const completion = await openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [{ role: "user", content: prompt }],
            });
            output = completion.choices[0].message.content;
        } else {
            const completion = await anthropic.messages.create({
                model: "claude-3-sonnet-20240229",
                max_tokens: 1500,
                messages: [{ role: "user", content: prompt }],
            });
            output = completion.content[0].text;
        }
        res.json({ result: output });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/image", async (req, res) => {
    const { prompt } = req.body;
    try {
        const result = await openai.images.generate({
            model: "gpt-image-1",
            prompt,
            size: "1024x1024"
        });
        res.json({ image: result.data[0].url });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/pdf", async (req, res) => {
    const { text } = req.body;
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.send(pdf);
    });
    doc.text(text);
    doc.end();
});

app.post("/api/docx", async (req, res) => {
    const { text } = req.body;
    const doc = new Document({
        sections: [{ children: [new Paragraph(text)] }]
    });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats");
    res.send(buffer);
});

app.post("/api/excel", async (req, res) => {
    const { rows } = req.body;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    rows.forEach(r => ws.addRow(r));
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats");
    res.send(buffer);
});

app.post("/api/svg", async (req, res) => {
    const { svg } = req.body;
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
});

app.listen(3000, () => console.log("XferLogic backend running on port 3000"));
