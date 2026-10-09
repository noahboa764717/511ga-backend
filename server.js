const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const IMAGE_ID = '19637'; 
const CAMERA_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

// Helper: Attempt to query GetVideoUrl across its possible relative paths
async function fetchTokenFromGetVideoUrl() {
  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://511ga.org/',
    'X-Requested-With': 'XMLHttpRequest'
  };

  // Paths to try in order based on DevTools trace
  const candidateUrls = [
    `https://511ga.org/GetVideoUrl?imageId=${IMAGE_ID}&_=${Date.now()}`,
    `https://511ga.org/map/GetVideoUrl?imageId=${IMAGE_ID}&_=${Date.now()}`,
    `https://511ga.org/cctv/GetVideoUrl?imageId=${IMAGE_ID}&_=${Date.now()}`
  ];

  for (const targetUrl of candidateUrls) {
    try {
      const response = await axios.get(targetUrl, { headers: customHeaders, timeout: 5000 });
      const responseData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

      const tokenMatch = responseData.match(/token=([a-zA-Z0-9\._\-]+)/i) || 
                         responseData.match(/eyJ[a-zA-Z0-9\._\-]+/);

      if (tokenMatch) {
        return tokenMatch[1] || tokenMatch[0];
      }
    } catch (err) {
      // Continue trying next candidate URL
      continue;
    }
  }

  throw new Error('GetVideoUrl returned 404 or missing token across all endpoints.');
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await fetchTokenFromGetVideoUrl();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const playlistResponse = await axios.get(masterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://511ga.org/'
      }
    });

    let manifest = playlistResponse.data;

    // Rewrite relative sub-playlists to route directly to GDOT with active token
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Stream Error:', error.message);
    res.status(500).send(`Error fetching live stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Stream Proxy Active. Request /stream.m3u8');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
