const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

app.get('/stream.m3u8', async (req, res) => {
  try {
    // 1. Get token from query param (e.g. /stream.m3u8?token=eyJ...)
    const token = req.query.token;

    if (!token) {
      return res.status(400).send('Missing token parameter. Append ?token=YOUR_JWT_TOKEN');
    }

    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const response = await axios.get(masterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://511ga.org/'
      }
    });

    let manifest = response.data;

    // 2. Rewrite relative sub-playlist lines (chunklist_...) to include token & absolute media path
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Stream Error:', error.message);
    res.status(500).send(`Error fetching stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA HLS Proxy Server Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));
