const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());

const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const VIEW_ID = '19637';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

let cachedToken = null;
let tokenExpiry = 0;
let isFetching = false;

async function getBrowserToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }
  if (isFetching) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (cachedToken) return cachedToken;
  }

  isFetching = true;
  let browser = null;
  try {
    console.log('Launching headless browser to capture live 511GA token...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    let capturedToken = null;

    await page.setRequestInterception(true);
    page.on('request', interceptedRequest => {
      const url = interceptedRequest.url();
      if (url.includes('token=')) {
        const match = url.match(/token=([a-zA-Z0-9\._\-]+)/);
        if (match && match[1]) {
          capturedToken = match[1];
        }
      }
      interceptedRequest.continue();
    });

    await page.goto(`https://511ga.org/map/Cctv/${VIEW_ID}`, {
      waitUntil: 'networkidle2',
      timeout: 25000
    });

    // Wait for the video player network requests to fire
    await new Promise(resolve => setTimeout(resolve, 6000));

    if (!capturedToken) {
      const pageContent = await page.content();
      const match = pageContent.match(/token=([a-zA-Z0-9\._\-]+)/) || pageContent.match(/(eyJ[a-zA-Z0-9\._\-]+)/);
      if (match) {
        capturedToken = match[1] || match[0];
      }
    }

    if (!capturedToken) {
      throw new Error('Could not capture token via browser interception.');
    }

    cachedToken = capturedToken;
    tokenExpiry = now + 90000; // Cache valid for 90 seconds
    console.log('Successfully captured fresh video token.');
    return cachedToken;
  } catch (error) {
    console.error('Puppeteer Error:', error.message);
    if (cachedToken) return cachedToken;
    throw error;
  } finally {
    isFetching = false;
    if (browser) await browser.close();
  }
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await getBrowserToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const response = await axios.get(masterUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://511ga.org/' }
    });

    let manifest = response.data;
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error proxying stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('Puppeteer 511GA Video Proxy Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
