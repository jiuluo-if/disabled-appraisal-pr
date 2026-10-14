const express = require('express');
const cors = require('cors');
const https = require('https'); 
const fs = require('fs');       
require('dotenv').config();
const app = express();

const PORT = Number(process.env.PORT || 3000);

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_API_URL = process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1/chat/completions';

if (!KIMI_API_KEY) {
    console.error('Set KIMI_API_KEY in the environment or gemini/.env before starting.');
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/analyze', async (req, res) => {
    try {
        console.log("收到前端请求，正在准备转发给 Kimi...");

        // 1. 解析前端发来的 Gemini 格式的数据
        const contents = req.body.contents;
        if (!contents || !contents[0] || !contents[0].parts) {
            return res.status(400).json({ error: "无效的请求格式" });
        }

        const parts = contents[0].parts;
        
        let hasImage = false;
        let kimiContentArray = [];
        let promptText = "";

        // 解析文本和图片内容
        for (const part of parts) {
            if (part.text) {
                promptText += part.text + "\n";
                kimiContentArray.push({
                    type: "text",
                    text: part.text
                });
            }
            if (part.inline_data) {
                hasImage = true;
                const mimeType = part.inline_data.mime_type || "image/jpeg";
                const base64Data = part.inline_data.data;
                kimiContentArray.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${mimeType};base64,${base64Data}`
                    }
                });
                console.log("检测到图片数据，准备调用 Kimi 视觉模型...");
            }
        }

        // 2. 构造 Kimi (Moonshot API) 需要的格式
        // 根据是否包含图片动态选择模型和 content 格式
        const targetModel = hasImage
            ? (process.env.KIMI_VISION_MODEL || 'moonshot-v1-8k-vision-preview')
            : (process.env.KIMI_TEXT_MODEL || 'moonshot-v1-8k');
        const finalUserContent = hasImage ? kimiContentArray : promptText.trim();

        const kimiPayload = {
            model: targetModel, 
            messages: [
                {
                    role: "system",
                    content: "你是一位资深的法医临床鉴定专家。请严格按照要求输出结构化的 JSON 数据。"
                },
                {
                    role: "user",
                    content: finalUserContent
                }
            ],
            temperature: 0.3 // 较低的温度使 JSON 输出更稳定
        };

        // 3. 发送请求给 Kimi
        const response = await fetch(KIMI_API_URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIMI_API_KEY}` // Kimi 使用 Bearer Token 认证
            },
            body: JSON.stringify(kimiPayload)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Kimi API 错误:", data);
            return res.status(response.status).json(data);
        }

        // 4. 将 Kimi 的返回结果转换为前端期望的 Gemini 格式
        const kimiResponseText = data.choices[0].message.content;
        
        const geminiFormatResponse = {
            candidates: [
                {
                    content: {
                        parts: [
                            { text: kimiResponseText }
                        ]
                    }
                }
            ]
        };

        console.log("Kimi 处理完成，已返回结果。");
        res.json(geminiFormatResponse);

    } catch (error) {
        console.error("服务器内部错误:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Kimi HTTPS Proxy is Running!');
});

// 读取证书文件启动 HTTPS
try {
    const httpsOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || 'gemini.lintsing.net.key'),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'gemini.lintsing.net.pem')
    };

    https.createServer(httpsOptions, app).listen(PORT, () => {
        console.log(`HTTPS Kimi 服务已启动: https://localhost:${PORT}`);
    });
} catch (e) {
    console.error('HTTPS startup failed:', e.message);
    process.exit(1);
}
