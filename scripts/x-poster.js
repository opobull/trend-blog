#!/usr/bin/env node
/**
 * X (Twitter) Auto Poster for Trend Blog
 * 
 * withintrend 블로그 포스트에서 상위 항목을 추출하여
 * X에 이미지 포함 트윗으로 자동 포스팅
 * 
 * 사용법:
 *   node x-poster.js                    # 최신 포스트에서 2~3개 트윗
 *   node x-poster.js --dry-run          # 실제 포스팅 없이 미리보기
 *   node x-poster.js --file path/to.md  # 특정 포스트 지정
 *   node x-poster.js --count 2          # 트윗 개수 지정 (1~4)
 *   node x-poster.js --delay 15         # 트윗 간 간격(분) 기본 10
 * 
 * 환경변수 (.env 또는 export):
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (선택: 알림용)
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── 설정 ───────────────────────────────────────────

const CONFIG = {
  postsDir: '/home/ubuntu/clawd/trend-blog/content/posts',
  imagesDir: '/home/ubuntu/clawd/trend-blog/static/images',
  stateFile: '/home/ubuntu/clawd/trend-blog/work/x-poster-state.json',
  defaultCount: 3,       // 포스트당 트윗 수
  defaultDelay: 10,      // 트윗 간 간격 (분)
  maxTweetLength: 280,
};

// ─── 환경변수 로드 (.env 파일 지원) ─────────────────

function loadEnv() {
  const envPath = path.join(path.dirname(CONFIG.stateFile), '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}
loadEnv();

const CREDS = {
  apiKey: process.env.X_API_KEY || '',
  apiSecret: process.env.X_API_SECRET || '',
  accessToken: process.env.X_ACCESS_TOKEN || '',
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
};

const TELEGRAM = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
};

// ─── 인자 파싱 ──────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    file: null,
    count: CONFIG.defaultCount,
    delay: CONFIG.defaultDelay,
    noImage: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--no-image') opts.noImage = true;
    else if (args[i] === '--file') opts.file = args[++i];
    else if (args[i] === '--count') opts.count = Math.min(4, Math.max(1, parseInt(args[++i]) || CONFIG.defaultCount));
    else if (args[i] === '--delay') opts.delay = parseInt(args[++i]) || CONFIG.defaultDelay;
  }
  return opts;
}

// ─── 포스트 파싱 ────────────────────────────────────

/**
 * 최신 포스트 .md 파일 경로 반환
 */
function findLatestPost() {
  if (!fs.existsSync(CONFIG.postsDir)) {
    throw new Error(`Posts directory not found: ${CONFIG.postsDir}`);
  }
  const files = fs.readdirSync(CONFIG.postsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      name: f,
      path: path.join(CONFIG.postsDir, f),
      mtime: fs.statSync(path.join(CONFIG.postsDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) throw new Error('No posts found');
  return files[0].path;
}

/**
 * 마크다운 frontmatter 파싱
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fm = {};
  const lines = match[1].split('\n');
  let currentKey = null;

  for (const line of lines) {
    // top-level key
    const kvMatch = line.match(/^(\w[\w.]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        fm[currentKey] = val.slice(1, -1);
      } else if (val === '') {
        fm[currentKey] = {};
      } else {
        fm[currentKey] = val;
      }
    }
    // nested key (2-space indent)
    const nestedMatch = line.match(/^\s{2,}(\w+)\s*:\s*(.*)$/);
    if (nestedMatch && currentKey && typeof fm[currentKey] === 'object') {
      let val = nestedMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      fm[currentKey][nestedMatch[1]] = val;
    }
  }

  return fm;
}

/**
 * 포스트에서 개별 항목(## 섹션) 추출
 */
function extractItems(content) {
  // frontmatter 제거
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');

  // ## 기준으로 분리
  const sections = body.split(/\n## /);
  const items = [];

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');

    // 제목 (## 뒤의 텍스트)
    const titleLine = lines[0].trim();
    // 번호 제거: "1. Scream 7 ..." → "Scream 7 ..."
    const title = titleLine.replace(/^\d+\.\s*/, '');

    // 이미지 경로 추출
    const imgMatch = section.match(/!\[.*?\]\((\/images\/[^\)]+)\)/);
    const imagePath = imgMatch ? imgMatch[1] : null;

    // 본문 추출 (이미지, 소스, 구분선 제외)
    const bodyLines = lines.slice(1).filter(line => {
      if (line.startsWith('![')) return false;
      if (line.startsWith('---')) return false;
      if (line.startsWith('**Sources:**')) return false;
      if (line.startsWith('- [')) return false;
      if (line.trim() === '') return false;
      return true;
    });

    // 핵심 문장 추출 (첫 2~3문장)
    const bodyText = bodyLines.join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [bodyText];
    const summary = sentences.slice(0, 2).join(' ').trim();

    // 메타 정보 추출 (Release Date, Premiere Date 등)
    const dateMatch = section.match(/\*\*(Release Date|Premiere Date|Final Episodes)\s*:\*\*\s*(.+)/);
    const releaseInfo = dateMatch ? dateMatch[2].trim() : null;

    // 캐스트 정보 (첫 3명만)
    const castMatch = section.match(/\*\*Cast:\*\*\s*(.+)/);
    let castShort = null;
    if (castMatch) {
      const names = castMatch[1].split(',').map(n => n.trim()).slice(0, 3);
      castShort = names.join(', ');
    }

    items.push({
      index: i,
      title,
      imagePath,
      summary,
      releaseInfo,
      castShort,
    });
  }

  return items;
}

// ─── 트윗 생성 (템플릿) ─────────────────────────────

/**
 * 항목에서 해시태그 생성
 * 전략: 제목에서 노이즈 제거 → 남는 핵심 명사구를 해시태그로
 */
function generateHashtags(title) {
  // 제목에서 제거할 패턴 (설명적 부분)
  const removePatterns = [
    /\bSuper Bowl\b/gi,
    /\bTrailer\b/gi, /\bTeaser\b/gi,
    /\bReleased?\b/gi, /\bRevealed?\b/gi, /\bConfirmed?\b/gi, /\bAnnounced?\b/gi,
    /\bOfficial\b/gi, /\bPremiere\b/gi,
    /\bDate\b/gi, /\bNew\b/gi,
    /\bFirst[-\s]Ever\b/gi,
    /\bEnding\b/gi, /\bAfter\b/gi,
    /\bIMAX\b/gi,
    /\bSeven Seasons?\b/gi,
    /\bSeason \d+\b/gi,
    /\bwith\b/gi, /\band\b/gi,
    /\bfrom\b/gi, /\bfor\b/gi,
    /\bHow to\b/gi,
    /[-–—]/g,
  ];

  let cleaned = title;
  for (const p of removePatterns) {
    cleaned = cleaned.replace(p, ' ');
  }

  // 연속 공백 정리
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 남은 부분을 주요 구문으로 분리
  const phrases = cleaned.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

  const tags = [];
  for (const phrase of phrases) {
    // 특수문자 제거 (콜론 등), 숫자는 보존
    const clean = phrase.replace(/[^a-zA-Z0-9\s]/g, '');
    // 소문자 불용어 제거
    const smallStopWords = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'is', 'it', 'or', 'by']);
    const words = clean.split(/\s+/).filter(w => w.length >= 2 && !smallStopWords.has(w.toLowerCase()));
    if (words.length === 0) continue;
    const tag = words.join('');
    if (tag.length >= 3 && tag.length <= 25) {
      tags.push(`#${tag}`);
    }
  }

  // 없으면 원본 제목에서 대문자 시작 연속 단어 2개 이상 조합
  if (tags.length === 0) {
    const capWords = title.match(/[A-Z][a-z]+/g) || [];
    if (capWords.length >= 2) {
      tags.push(`#${capWords.slice(0, 2).join('')}`);
    }
  }

  return [...new Set(tags)].sort((a, b) => b.length - a.length).slice(0, 2).join(' ');
}

/**
 * 항목 → 트윗 텍스트 변환
 */
function composetweet(item, blogUrl) {
  const parts = [];

  // 제목 (핵심만)
  parts.push(item.title);
  parts.push('');

  // 요약 (280자 맞추기 위해 조절)
  if (item.summary) {
    parts.push(item.summary);
  }

  // 날짜 정보
  if (item.releaseInfo) {
    parts.push('');
    parts.push(`📅 ${item.releaseInfo}`);
  }

  // 해시태그
  const hashtags = generateHashtags(item.title);
  if (hashtags) {
    parts.push('');
    parts.push(hashtags);
  }

  let tweet = parts.join('\n');

  // 280자 초과 시 요약 줄이기
  if (tweet.length > CONFIG.maxTweetLength) {
    // 요약을 첫 문장만으로 축소
    const sentences = item.summary.match(/[^.!?]+[.!?]+/g) || [item.summary];
    const shortParts = [item.title, '', sentences[0].trim()];
    if (item.releaseInfo) shortParts.push('', `📅 ${item.releaseInfo}`);
    if (hashtags) shortParts.push('', hashtags);
    tweet = shortParts.join('\n');
  }

  // 그래도 초과하면 하드컷
  if (tweet.length > CONFIG.maxTweetLength) {
    tweet = tweet.substring(0, CONFIG.maxTweetLength - 3) + '...';
  }

  return tweet;
}

// ─── OAuth 1.0a 서명 ────────────────────────────────

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k =>
    `${percentEncode(k)}=${percentEncode(params[k])}`
  ).join('&');

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: CREDS.apiKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CREDS.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...oauthParams, ...extraParams };
  const signature = generateSignature(method, url, allParams, CREDS.apiSecret, CREDS.accessTokenSecret);
  oauthParams.oauth_signature = signature;

  const authString = Object.keys(oauthParams).sort().map(k =>
    `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
  ).join(', ');

  return `OAuth ${authString}`;
}

// ─── X API 호출 ─────────────────────────────────────

function apiRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (e) {
          // media upload은 non-JSON 응답도 있음
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * 이미지 업로드 (v1.1 media/upload - chunked)
 * X API v2에는 media upload가 없어서 v1.1 사용
 */
async function uploadMedia(imagePath) {
  const fullPath = path.join(CONFIG.imagesDir, path.basename(imagePath));

  if (!fs.existsSync(fullPath)) {
    console.log(`   ⚠️ 이미지 없음: ${fullPath}`);
    return null;
  }

  const fileData = fs.readFileSync(fullPath);
  const fileSize = fileData.length;
  const mimeType = fullPath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  console.log(`   📸 이미지 업로드: ${path.basename(fullPath)} (${(fileSize / 1024).toFixed(0)}KB)`);

  // INIT
  const initUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const initParams = {
    command: 'INIT',
    total_bytes: fileSize.toString(),
    media_type: mimeType,
  };

  const initAuth = buildAuthHeader('POST', initUrl, initParams);
  const initBody = Object.entries(initParams).map(([k, v]) => `${k}=${percentEncode(v)}`).join('&');

  const initRes = await apiRequest({
    hostname: 'upload.twitter.com',
    path: '/1.1/media/upload.json',
    method: 'POST',
    headers: {
      'Authorization': initAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }, initBody);

  const mediaId = initRes.media_id_string;
  console.log(`   📎 Media ID: ${mediaId}`);

  // APPEND (단일 청크 - 5MB 이하)
  const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
  const appendUrl = 'https://upload.twitter.com/1.1/media/upload.json';

  // multipart/form-data 수동 구성
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="command"\r\n\r\nAPPEND`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="media_id"\r\n\r\n${mediaId}`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n0`);

  const preFile = parts.join('\r\n') + `\r\n--${boundary}\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n`;
  const postFile = `\r\n--${boundary}--\r\n`;

  const base64Data = fileData.toString('base64');
  const appendBody = preFile + base64Data + postFile;

  const appendAuth = buildAuthHeader('POST', appendUrl);

  await apiRequest({
    hostname: 'upload.twitter.com',
    path: '/1.1/media/upload.json',
    method: 'POST',
    headers: {
      'Authorization': appendAuth,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': Buffer.byteLength(appendBody),
    },
  }, appendBody);

  // FINALIZE
  const finalParams = {
    command: 'FINALIZE',
    media_id: mediaId,
  };
  const finalAuth = buildAuthHeader('POST', initUrl, finalParams);
  const finalBody = Object.entries(finalParams).map(([k, v]) => `${k}=${percentEncode(v)}`).join('&');

  await apiRequest({
    hostname: 'upload.twitter.com',
    path: '/1.1/media/upload.json',
    method: 'POST',
    headers: {
      'Authorization': finalAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }, finalBody);

  console.log(`   ✅ 업로드 완료`);
  return mediaId;
}

/**
 * 트윗 포스팅 (v2)
 */
async function postTweet(text, mediaId = null) {
  const url = 'https://api.x.com/2/tweets';
  const body = { text };
  if (mediaId) {
    body.media = { media_ids: [mediaId] };
  }

  const jsonBody = JSON.stringify(body);
  const auth = buildAuthHeader('POST', url);

  const res = await apiRequest({
    hostname: 'api.x.com',
    path: '/2/tweets',
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonBody),
    },
  }, jsonBody);

  return res;
}

// ─── 상태 관리 (중복 포스팅 방지) ───────────────────

function loadState() {
  if (fs.existsSync(CONFIG.stateFile)) {
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
  }
  return { postedItems: [] };
}

function saveState(state) {
  const dir = path.dirname(CONFIG.stateFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

function isAlreadyPosted(state, postFile, itemIndex) {
  const key = `${path.basename(postFile)}:${itemIndex}`;
  return state.postedItems.includes(key);
}

function markAsPosted(state, postFile, itemIndex) {
  const key = `${path.basename(postFile)}:${itemIndex}`;
  state.postedItems.push(key);
  // 최근 200개만 유지
  if (state.postedItems.length > 200) {
    state.postedItems = state.postedItems.slice(-200);
  }
  saveState(state);
}

// ─── 텔레그램 알림 ──────────────────────────────────

async function sendTelegram(message) {
  if (!TELEGRAM.botToken || !TELEGRAM.chatId) return;

  const body = JSON.stringify({
    chat_id: TELEGRAM.chatId,
    text: message,
    parse_mode: 'HTML',
  });

  try {
    await apiRequest({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
  } catch (err) {
    console.error(`   ⚠️ 텔레그램 알림 실패: ${err.message}`);
  }
}

// ─── 유틸 ───────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 메인 ───────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(50));
  console.log('X Auto Poster for Trend Blog');
  console.log(`Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(50) + '\n');

  // 인증 확인
  if (!opts.dryRun) {
    if (!CREDS.apiKey || !CREDS.accessToken) {
      console.error('❌ X API 키가 설정되지 않음. 환경변수 또는 .env 파일 확인.');
      process.exit(1);
    }
  }

  // 포스트 파일 선택
  const postFile = opts.file || findLatestPost();
  console.log(`📄 포스트: ${path.basename(postFile)}\n`);

  const content = fs.readFileSync(postFile, 'utf-8');
  const fm = parseFrontmatter(content);
  const items = extractItems(content);

  console.log(`📰 항목 ${items.length}개 발견\n`);

  // 상태 로드 (중복 방지)
  const state = loadState();

  // 포스팅할 항목 선택 (상위 N개, 미포스팅 항목만)
  const toPost = items
    .filter(item => !isAlreadyPosted(state, postFile, item.index))
    .slice(0, opts.count);

  if (toPost.length === 0) {
    console.log('✅ 모든 항목이 이미 포스팅됨. 스킵.');
    return;
  }

  console.log(`🐦 ${toPost.length}개 트윗 예정\n`);

  const results = [];

  for (let i = 0; i < toPost.length; i++) {
    const item = toPost[i];
    const tweet = composetweet(item);

    console.log(`─── 트윗 ${i + 1}/${toPost.length} ───`);
    console.log(`제목: ${item.title}`);
    console.log(`이미지: ${item.imagePath || '없음'}`);
    console.log(`텍스트 (${tweet.length}자):`);
    console.log(tweet);
    console.log();

    if (opts.dryRun) {
      console.log('   [DRY RUN] 스킵\n');
      continue;
    }

    try {
      // 이미지 업로드
      let mediaId = null;
      if (item.imagePath && !opts.noImage) {
        mediaId = await uploadMedia(item.imagePath);
      }

      // 트윗 포스팅
      const res = await postTweet(tweet, mediaId);
      const tweetId = res.data?.id;
      console.log(`   ✅ 포스팅 완료! ID: ${tweetId}`);
      console.log(`   🔗 https://x.com/opobull/status/${tweetId}\n`);

      markAsPosted(state, postFile, item.index);
      results.push({ success: true, title: item.title, tweetId });

      // 다음 트윗 전 딜레이
      if (i < toPost.length - 1) {
        console.log(`   ⏳ ${opts.delay}분 대기...\n`);
        await sleep(opts.delay * 60 * 1000);
      }

    } catch (err) {
      console.error(`   ❌ 포스팅 실패: ${err.message}\n`);
      results.push({ success: false, title: item.title, error: err.message });
    }
  }

  // 결과 요약
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n' + '='.repeat(50));
  console.log(`결과: ✅ ${successCount} 성공, ❌ ${failCount} 실패`);
  console.log('='.repeat(50));

  // 텔레그램 알림
  if (results.length > 0) {
    const lines = [`<b>🐦 X 포스팅 완료</b>\n`];
    for (const r of results) {
      if (r.success) {
        lines.push(`✅ ${r.title}`);
        lines.push(`   → https://x.com/opobull/status/${r.tweetId}`);
      } else {
        lines.push(`❌ ${r.title}: ${r.error}`);
      }
    }
    await sendTelegram(lines.join('\n'));
  }
}

// 5분 타임아웃
const TIMEOUT_MS = 5 * 60 * 1000;
const timeout = setTimeout(() => {
  console.error('❌ 타임아웃 (5분)');
  process.exit(1);
}, TIMEOUT_MS);

main().then(() => {
  clearTimeout(timeout);
}).catch((err) => {
  clearTimeout(timeout);
  console.error('❌ 에러:', err.message);
  process.exit(1);
});
