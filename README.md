# Trend Blog

트렌드 뉴스 블로그 (Hugo + PaperMod)

## 배포
- URL: https://trend.opobot.xyz
- 호스팅: Cloudflare Pages
- 자동 배포: GitHub push → Cloudflare 빌드

## 포스트 작성 가이드

### 1. 포스트 파일 생성
```
content/posts/{category}-{date}.md
예: content/posts/entertainment-2026-02-04.md
```

### 2. 이미지 수집 (필수!)

**⚠️ 반드시 `collect-image.js` 스크립트 사용**

```bash
cd /home/ubuntu/clawd/trend-blog

# 1) 이미지 검색 (그리드 스크린샷 생성)
node scripts/collect-image.js search --keyword "검색어" --out ./work/temp

# 2) 그리드 스크린샷 확인 후 번호 선택
# work/temp/grid-screenshot.png 확인

# 3) 선택한 이미지 다운로드
node scripts/collect-image.js download --selection 3 --work ./work/temp --out ./static/images/featured.jpg
```

**설정:**
- 1200x630 (OG 이미지 표준 비율)
- 가로 이미지 우선
- 최소 600x400

### 3. 날짜 주의사항

**⚠️ 포스트 날짜는 현재 시간 이전으로!**

`hugo.toml`에 `buildFuture = false` 설정됨.
미래 날짜 포스트는 빌드에서 제외됨.

```yaml
# ❌ 잘못된 예 (현재 04:00 UTC인데)
date: 2026-02-04T12:00:00Z

# ✅ 올바른 예
date: 2026-02-04T04:00:00Z
```

### 4. 카테고리
- entertainment
- sports  
- tech
- business

## 스크립트

| 파일 | 용도 |
|------|------|
| `scripts/collect-image.js` | Google 이미지 검색 + 다운로드 |

## 폴더 구조
```
trend-blog/
├── content/posts/    # 포스트 마크다운
├── static/images/    # 이미지 파일
├── scripts/          # 유틸리티 스크립트
├── work/             # 임시 작업 폴더
└── hugo.toml         # Hugo 설정
```
