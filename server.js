const express = require('express');
const axios = require('axios');
const cors = require('cors');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(cors());

const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const VIEW_ID = '19637';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

let cachedToken = null;
let tokenExpiry = 0;
let isFetching = false;

async function getCloudBrowserToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;
  if (isFetching) {
    await new Promise(r => setTimeout(r, 2000));
    if (cachedToken) return cachedToken;
  }

  isFetching = true;
  let browser = null;
  try {
    console.log('Launching serverless Chromium instance...');
    
    // Configure Chromium for cloud environments
    chromium.setHeadlessMode = true;
    chromium.setGraphicsMode = false;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    let capturedToken = null;

    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = req.url();
      if (url.includes('token=')) {
        const match = url.match(/token=([a-zA-Z0-9\._\-]+)/);
        if (match && match[1]) capturedToken = match[1];
      }
      req.continue();
    });

    await page.goto(`https://511ga.org/map/Cctv/${VIEW_ID}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await new Promise(r => setTimeout(r, 5000));

    if (!capturedToken) {
      const content = await page.content();
      const match = content.match(/token=([a-zA-Z0-9\._\-]+)/);
      if (match) capturedToken = match[1];
    }

    if (!capturedToken) throw new Error('Failed to intercept stream token.');

    cachedToken = capturedToken;
    tokenExpiry = now + 90000; // Cache for 90 seconds
    return cachedToken;
  } catch (err) {
    console.error('Chromium Token Error:', err.message);
    if (cachedToken) return cachedToken;
    throw err;
  } finally {
    isFetching = false;
    if (browser) await browser.close();
  }
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await getCloudBrowserToken();
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
    res.status(500).send(`Proxy Error: ${error.message}`);
  }
});

app.get('/', (req, res) => res.send('Sparticuz Chromium Proxy Active'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
