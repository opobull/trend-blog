#!/usr/bin/env node
/**
 * 블로그 이미지 수집 스크립트
 * 
 * 트렌드 블로그용 대표 이미지 1장 수집
 * 
 * 사용법:
 *   node collect-image.js search --keyword "검색어" --out ./work
 *   node collect-image.js download --selection 3 --work ./work --out ./images/featured.jpg
 * 
 * search 출력:
 *   work/grid-screenshot.png, search-result.json
 * 
 * download 출력:
 *   지정 경로에 리사이즈된 이미지 저장
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 설정 (블로그용 - 가로 이미지)
const CONFIG = {
  cdpUrl: 'http://localhost:18800',
  targetWidth: 1200,
  targetHeight: 630,  // OG 이미지 표준 비율
  minWidth: 600,
  minHeight: 400,
  maxCandidates: 15,
};

let browser = null;
let activePage = null;

/**
 * 브라우저 연결
 */
async function connectBrowser() {
  if (!browser) {
    browser = await puppeteer.connect({
      browserURL: CONFIG.cdpUrl,
      defaultViewport: null
    });
  }
  return browser;
}

/**
 * 키워드 검색 + 스크린샷
 */
async function searchKeyword(keyword, outputDir) {
  console.log(`\n🔍 검색: "${keyword}"`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const br = await connectBrowser();
  const page = await br.newPage();
  activePage = page;
  await page.setViewport({ width: 1400, height: 900 });
  
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&tbm=isch&hl=en&gl=us`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);
    
    // HTML에서 이미지 정보 추출
    const imageDataByDocid = await page.evaluate((minW, minH, maxCount) => {
      const html = document.body.innerHTML;
      const results = {};
      
      const regex = /\["(https:\/\/[^"]+)",(\d+),(\d+)\],\["(https:\/\/[^"]+)",(\d+),(\d+)\]/g;
      let match;
      
      while ((match = regex.exec(html)) !== null) {
        const [_, thumbUrl, thumbW, thumbH, origUrl, origW, origH] = match;
        const width = parseInt(origW);
        const height = parseInt(origH);
        
        if (origUrl.includes('encrypted-tbn') || width < minW || height < minH) continue;
        
        const start = Math.max(0, match.index - 300);
        const nearbyBefore = html.substring(start, match.index);
        const docidMatch = nearbyBefore.match(/\[0,"([A-Za-z0-9_-]{10,})"/g);
        
        if (docidMatch && docidMatch.length > 0) {
          const lastMatch = docidMatch[docidMatch.length - 1];
          const docid = lastMatch.match(/\[0,"([A-Za-z0-9_-]{10,})"/)[1];
          
          if (!results[docid]) {
            results[docid] = {
              url: origUrl,
              width,
              height,
              isHorizontal: width > height,
              ratio: (width / height).toFixed(2),
              megapixels: ((width * height) / 1000000).toFixed(1)
            };
          }
        }
      }
      
      return results;
    }, CONFIG.minWidth, CONFIG.minHeight, CONFIG.maxCandidates);
    
    // DOM 순서대로 썸네일 처리 + 번호 오버레이
    const imageData = await page.evaluate((imageDataByDocid, maxCount) => {
      const thumbnails = document.querySelectorAll('div[data-lpage]');
      const results = [];
      
      thumbnails.forEach((thumb, i) => {
        if (results.length >= maxCount) return;
        
        const docid = thumb.getAttribute('data-docid');
        if (!docid || !imageDataByDocid[docid]) return;
        
        const imgInfo = imageDataByDocid[docid];
        const index = results.length + 1;
        
        results.push({
          index,
          docid,
          ...imgInfo
        });
        
        const existingLabel = thumb.querySelector('.ai-label');
        if (existingLabel) existingLabel.remove();
        
        const label = document.createElement('div');
        label.className = 'ai-label';
        label.textContent = index.toString();
        label.style.cssText = `
          position: absolute;
          top: 4px;
          left: 4px;
          background: rgba(255, 0, 0, 0.9);
          color: white;
          font-size: 16px;
          font-weight: bold;
          padding: 4px 8px;
          border-radius: 4px;
          z-index: 9999;
          font-family: Arial, sans-serif;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `;
        
        thumb.style.position = 'relative';
        thumb.appendChild(label);
      });
      
      return results;
    }, imageDataByDocid, CONFIG.maxCandidates);
    
    console.log(`   📊 ${imageData.length}개 이미지 발견`);
    
    await sleep(500);
    
    const screenshotPath = path.join(outputDir, 'grid-screenshot.png');
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: false
    });
    console.log(`   📸 ${screenshotPath}`);
    
    const metadata = {
      keyword,
      timestamp: new Date().toISOString(),
      images: imageData,
      screenshotPath
    };
    
    const metadataPath = path.join(outputDir, 'search-result.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    
    // 요약 출력
    console.log(`\n📐 이미지 후보:`);
    imageData.slice(0, 10).forEach(img => {
      const hLabel = img.isHorizontal ? '가로✓' : '세로';
      console.log(`   ${img.index}: ${img.width}x${img.height} (${hLabel}, ${img.megapixels}MP)`);
    });
    
    console.log(`\n💡 선택: node collect-image.js download --selection [번호] --work ${outputDir} --out ./image.jpg`);
    
    await page.close();
    activePage = null;
    
    return metadata;
    
  } catch (err) {
    if (page) await page.close();
    activePage = null;
    throw err;
  }
}

/**
 * 선택된 이미지 다운로드
 */
async function downloadImage(selection, workDir, outPath) {
  console.log(`\n📥 이미지 다운로드: ${selection}번`);
  
  // 출력 경로를 항상 .jpg로 강제 (webp 등 다른 확장자 방지)
  const ext = path.extname(outPath).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') {
    outPath = outPath.slice(0, -ext.length) + '.jpg';
    console.log(`   📝 출력 형식: .jpg로 강제`);
  }
  
  const metadataPath = path.join(workDir, 'search-result.json');
  
  if (!fs.existsSync(metadataPath)) {
    console.error(`❌ 메타데이터 없음: ${metadataPath}`);
    process.exit(1);
  }
  
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  
  // 출력 디렉토리 생성
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  // 사용된 인덱스 추적
  const usedIndices = new Set([selection]);
  let success = false;
  let currentIdx = selection;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (!success && attempts < maxAttempts) {
    attempts++;
    const img = metadata.images.find(x => x.index === currentIdx);
    
    if (!img) {
      console.log(`   ⚠️ ${currentIdx}번 이미지 없음`);
      const alt = findAlternative(metadata.images, usedIndices);
      if (alt) {
        currentIdx = alt.index;
        usedIndices.add(currentIdx);
        continue;
      }
      break;
    }
    
    try {
      console.log(`   📥 ${currentIdx}번 다운로드 (시도 ${attempts})`);
      await download(img.url, outPath);
      
      const validation = validateImage(outPath);
      if (!validation.valid) {
        console.log(`      ⚠️ 검증 실패: ${validation.reason}`);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        
        const alt = findAlternative(metadata.images, usedIndices);
        if (alt) {
          currentIdx = alt.index;
          usedIndices.add(currentIdx);
          continue;
        }
        break;
      }
      
      await resizeImage(outPath, CONFIG.targetWidth, CONFIG.targetHeight);
      
      const postValidation = validateImage(outPath);
      if (!postValidation.valid) {
        console.log(`      ⚠️ 리사이즈 후 검증 실패`);
        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        
        const alt = findAlternative(metadata.images, usedIndices);
        if (alt) {
          currentIdx = alt.index;
          usedIndices.add(currentIdx);
          continue;
        }
        break;
      }
      
      console.log(`   ✅ 완료: ${outPath} (${postValidation.width}x${postValidation.height})`);
      success = true;
      
    } catch (err) {
      console.log(`      ❌ 실패: ${err.message}`);
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
      
      const alt = findAlternative(metadata.images, usedIndices);
      if (alt) {
        currentIdx = alt.index;
        usedIndices.add(currentIdx);
        continue;
      }
      break;
    }
  }
  
  if (!success) {
    console.error(`❌ 이미지 다운로드 최종 실패`);
    process.exit(1);
  }
}

/**
 * 대체 이미지 찾기 (가로 이미지 우선)
 */
function findAlternative(images, usedIndices) {
  const available = images.filter(img => !usedIndices.has(img.index));
  if (available.length === 0) return null;
  
  // 블로그용: 가로 이미지 우선, 고해상도 선호
  available.sort((a, b) => {
    if (a.isHorizontal && !b.isHorizontal) return -1;
    if (!a.isHorizontal && b.isHorizontal) return 1;
    return parseFloat(b.megapixels) - parseFloat(a.megapixels);
  });
  
  return available[0];
}

/**
 * 이미지 다운로드 (리다이렉트 최대 5회)
 */
function download(url, filepath, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  
  return new Promise((resolve, reject) => {
    if (redirectCount >= MAX_REDIRECTS) {
      reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
      return;
    }
    
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);
    
    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.google.com/'
      },
      timeout: 15000
    }, (res) => {
      // 301, 302, 307, 308 모두 처리
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without location header'));
          return;
        }
        download(redirectUrl, filepath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      reject(err);
    });
    
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

/**
 * 이미지 검증
 */
function validateImage(filepath) {
  if (!fs.existsSync(filepath)) {
    return { valid: false, reason: '파일 없음' };
  }
  
  const stats = fs.statSync(filepath);
  if (stats.size < 10 * 1024) {
    return { valid: false, reason: `파일 크기 너무 작음 (${stats.size} bytes)` };
  }
  
  try {
    const result = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${filepath}" 2>&1`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    
    if (!result || !result.match(/^\d+,\d+$/)) {
      return { valid: false, reason: 'ffprobe: 이미지 디코딩 실패' };
    }
    
    const [width, height] = result.split(',').map(Number);
    if (width < 100 || height < 100) {
      return { valid: false, reason: `이미지 너무 작음 (${width}x${height})` };
    }
    
    return { valid: true, width, height };
  } catch (err) {
    return { valid: false, reason: `ffprobe 에러: ${err.message}` };
  }
}

/**
 * 이미지 리사이즈 (블로그용 - 가로 이미지 최적화)
 */
async function resizeImage(filepath, targetW, targetH) {
  // 모든 확장자 처리 (jpg, jpeg, png, webp 등)
  const ext = path.extname(filepath).toLowerCase();
  const base = filepath.slice(0, -ext.length);
  const tempPath = `${base}-temp.jpg`;
  
  // 중앙 크롭으로 1200x630에 맞춤, 출력은 항상 jpg
  const cmd = `ffmpeg -y -i "${filepath}" -vf "scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH}" -q:v 2 "${tempPath}" 2>/dev/null`;
  execSync(cmd);
  
  // 원본이 jpg가 아니면 삭제하고 jpg로 대체
  if (ext !== '.jpg' && ext !== '.jpeg') {
    fs.unlinkSync(filepath);
    const newPath = `${base}.jpg`;
    fs.renameSync(tempPath, newPath);
    return newPath;
  }
  
  fs.renameSync(tempPath, filepath);
  return filepath;
}

// Cleanup
const cleanup = async () => {
  if (activePage) {
    try { await activePage.close(); } catch (e) {}
    activePage = null;
  }
  if (browser) {
    try { browser.disconnect(); } catch (e) {}
    browser = null;
  }
};

process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
process.on('uncaughtException', async (err) => { 
  console.error('❌ Uncaught:', err.message);
  await cleanup(); 
  process.exit(1); 
});

// 인자 파싱
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    command: args[0],
    keyword: null,
    work: './work',
    out: './featured.jpg',
    selection: null
  };
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--keyword' || args[i] === '-k') {
      opts.keyword = args[++i];
    } else if (args[i] === '--work' || args[i] === '-w') {
      opts.work = args[++i];
    } else if (args[i] === '--out' || args[i] === '-o') {
      opts.out = args[++i];
    } else if (args[i] === '--selection' || args[i] === '-s') {
      opts.selection = parseInt(args[++i]);
    }
  }
  
  return opts;
}

function printHelp() {
  console.log(`
🖼️  블로그 이미지 수집 스크립트

사용법:
  node collect-image.js search --keyword "검색어" --work ./work
  node collect-image.js download --selection 3 --work ./work --out ./image.jpg

search 커맨드:
  --keyword, -k     검색어 (필수)
  --work, -w        작업 폴더 (기본: ./work)

download 커맨드:
  --selection, -s   선택 번호 (필수)
  --work, -w        작업 폴더 (기본: ./work)
  --out, -o         출력 파일 (기본: ./featured.jpg)

예시:
  node collect-image.js search -k "OpenAI GPT-5 announcement" -w ./work
  # → 스크린샷 확인 후 번호 선택
  node collect-image.js download -s 3 -w ./work -o ./content/posts/images/gpt5.jpg
`);
}

// 메인
async function main() {
  const opts = parseArgs();
  
  if (!opts.command || opts.command === '--help' || opts.command === '-h') {
    printHelp();
    process.exit(0);
  }
  
  if (opts.command === 'search') {
    if (!opts.keyword) {
      console.error('❌ --keyword 필수');
      process.exit(1);
    }
    await searchKeyword(opts.keyword, opts.work);
    
  } else if (opts.command === 'download') {
    if (!opts.selection) {
      console.error('❌ --selection 필수');
      process.exit(1);
    }
    await downloadImage(opts.selection, opts.work, opts.out);
    
  } else {
    console.error(`❌ 알 수 없는 명령: ${opts.command}`);
    printHelp();
    process.exit(1);
  }
}

// 3분 타임아웃
const TIMEOUT_MS = 3 * 60 * 1000;
const timeout = setTimeout(async () => {
  console.error('❌ 타임아웃 (3분)');
  await cleanup();
  process.exit(1);
}, TIMEOUT_MS);

main().then(async () => {
  clearTimeout(timeout);
  await cleanup();
}).catch(async (err) => {
  clearTimeout(timeout);
  console.error('❌ 에러:', err.message);
  await cleanup();
  process.exit(1);
});
