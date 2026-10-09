const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

// Camera ID parameters from 511GA network trace
const IMAGE_ID = '19637'; 
const CAMERA_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

// Fetch fresh stream URL + dynamic token straight from 511GA's video token service
async function fetchStreamWithToken() {
  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://511ga.org/cctv',
    'X-Requested-With': 'XMLHttpRequest'
  };

  // 1. Hit the GetVideoUrl endpoint visible in your network dev tools
  const urlRes = await axios.get(`https://511ga.org/cctv/GetVideoUrl?imageId=${IMAGE_ID}&_=${Date.now()}`, {
    headers: customHeaders,
    timeout: 8000
  });

  // Extract stream URL or raw token from JSON response
  let streamUrl = typeof urlRes.data === 'string' ? urlRes.data : urlRes.data.url || urlRes.data.Url || urlRes.data.videoUrl;

  if (!streamUrl) {
    throw new Error('GetVideoUrl returned an empty response.');
  }

  // Extract token parameter from the returned stream URL
  const tokenMatch = streamUrl.match(/token=([a-zA-Z0-9\._\-]+)/);
  if (!tokenMatch) {
    throw new Error('Could not parse token from GetVideoUrl response.');
  }

  return tokenMatch[1];
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await fetchStreamWithToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    // Request the master playlist from GDOT using the fresh token
    const playlistResponse = await axios.get(masterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://511ga.org/'
      }
    });

    let manifest = playlistResponse.data;

    // Rewrite relative chunklist URLs to route directly to GDOT media server with active token
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error fetching live stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Stream Proxy Active. Request /stream.m3u8');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
