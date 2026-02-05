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

---

## Entertainment 토픽 선정 (자동화용)

### 콘텐츠 형식: 공식 발표 라운드업

⚠️ **6시간 제한**: 최근 6시간 내 공식 발표들만 수집

**수집 대상:**
- 공식 발표들만 (Netflix, HBO, Disney+, 스튜디오 등)
- 트레일러 공개
- 개봉일/출시일 발표
- 캐스팅 확정
- 시즌 갱신/취소 결정

**선정 기준:**
- 화제성 순위로 **6개** 선정
- 이전 포스트에서 다룬 토픽 제외 (중복 체크)

**글 형식:**
- "어떤 작품이 언제 나올 것으로 발표되었다" 형식
- 제목: `Entertainment Releases: [Date] [AM/PM] - Top 6 Announcements`

**글 구조:**
```markdown
## 1. [작품명]
![작품명](/images/[slug]-1.jpg)
- 발표 내용
- 출처 링크

## 2. [작품명]
...
(총 6개)
```

### 실행 프로세스

1. `web_search`로 최근 6h 내 엔터 공식 발표 수집
2. `content/posts/` 폴더와 중복 체크
3. 화제성 순위로 6개 선정
4. 각 작품별 이미지 수집 (6장)
5. 영어 글 작성 (6개 발표)
6. 4개 언어로 번역 (JA, DE, ES, KO)
7. 빌드 검증 후 push
8. X 자동 포스팅: `node scripts/x-poster.js --count 3`

### 크론 스케줄
- 오전: 09:00 KST
- 오후: 21:00 KST

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
