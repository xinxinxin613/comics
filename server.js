/**
 * 英文绘本漫画 - 后端服务
 * 部署到 Vercel / Netlify / 自己的服务器即可
 * 环境变量：ARK_API_KEY（火山引擎方舟 API Key）
 */
const express = require('express');
const path = require('path');
const https = require('https');
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const API_KEY = process.env.ARK_API_KEY || '';

// 调用火山引擎 Chat API
function callChat(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'doubao-seed-1-6-250615', // 可换成你开通的模型
      messages,
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });
    const url = new URL(ARK_BASE + '/chat/completions');
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Chat API 解析失败: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 调用火山引擎图片生成 API
function callImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'doubao-seedream-5-0-flash',
      prompt: prompt,
      size: '1024x1024',
      response_format: 'url'
    });
    const url = new URL(ARK_BASE + '/images/generations');
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Image API 解析失败: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 主接口：生成绘本
app.post('/api/generate', async (req, res) => {
  try {
    const { text, character } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: '请输入英文文本' });
    }
    if (!API_KEY) {
      return res.status(500).json({ error: '后端未配置 ARK_API_KEY 环境变量' });
    }

    // 主角描述（用户自定义，可选）
    const charDesc = character && character.trim()
      ? `主角固定设定：${character.trim()}。所有格子中主角外观必须完全一致。`
      : '主角外观在所有格子中保持一致即可。';

    // 第1步：让大模型拆故事成分镜
    const chatResp = await callChat([
      {
        role: 'system',
        content: `你是绘本漫画编剧。把用户给的英文故事拆成4-6格分镜。
${charDesc}
严格输出 JSON：
{
  "panels": [
    {
      "original_text": "对应原文句子，一字不改",
      "scene_prompt": "英文画面描述，末尾加 cute hand-drawn style, bright warm colors, simple clean lines",
      "dialogue": "角色说的话，没有就留空字符串"
    }
  ]
}
要求：原文片段连起来必须等于用户输入；主角外观描述保持一致。`
      },
      { role: 'user', content: text }
    ]);

    const content = chatResp.choices?.[0]?.message?.content;
    if (!content) throw new Error('大模型未返回内容');
    const result = JSON.parse(content);

    // 第2步：逐格生成图片
    const panels = await Promise.all(
      (result.panels || []).map(async (p, idx) => {
        try {
          const imgResp = await callImage(p.scene_prompt);
          const url = imgResp.data?.[0]?.url || '';
          return { ...p, image_url: url, panel: idx + 1 };
        } catch (e) {
          return { ...p, image_url: '', panel: idx + 1, error: String(e) };
        }
      })
    );

    res.json({ panels });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server on http://localhost:' + PORT));
