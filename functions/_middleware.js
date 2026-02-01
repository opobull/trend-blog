// Cloudflare Pages Functions - 지역 기반 리다이렉트
// CF-IPCountry 헤더를 사용하여 접속 국가에 맞는 언어로 리다이렉트

const countryToLang = {
  // 일본어
  'JP': '/ja/',
  
  // 독일어
  'DE': '/de/',
  'AT': '/de/',  // 오스트리아
  'CH': '/de/',  // 스위스 (독일어권)
  
  // 스페인어
  'ES': '/es/',  // 스페인
  'MX': '/es/',  // 멕시코
  'AR': '/es/',  // 아르헨티나
  'CO': '/es/',  // 콜롬비아
  'CL': '/es/',  // 칠레
  'PE': '/es/',  // 페루
  'VE': '/es/',  // 베네수엘라
  'EC': '/es/',  // 에콰도르
  'GT': '/es/',  // 과테말라
  'CU': '/es/',  // 쿠바
  'BO': '/es/',  // 볼리비아
  'DO': '/es/',  // 도미니카 공화국
  'HN': '/es/',  // 온두라스
  'PY': '/es/',  // 파라과이
  'SV': '/es/',  // 엘살바도르
  'NI': '/es/',  // 니카라과
  'CR': '/es/',  // 코스타리카
  'PA': '/es/',  // 파나마
  'UY': '/es/',  // 우루과이
  'PR': '/es/',  // 푸에르토리코
};

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  
  // 이미 언어 경로에 있으면 패스
  if (path.startsWith('/ja/') || path.startsWith('/de/') || path.startsWith('/es/')) {
    return next();
  }
  
  // 정적 파일은 패스 (css, js, 이미지 등)
  if (path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
    return next();
  }
  
  // 루트 또는 영어 posts 경로일 때만 리다이렉트
  if (path === '/' || path.startsWith('/posts/')) {
    const country = request.headers.get('CF-IPCountry') || 'US';
    const targetLang = countryToLang[country];
    
    if (targetLang) {
      // 쿠키 체크 - 사용자가 수동으로 언어 선택했으면 존중
      const cookies = request.headers.get('Cookie') || '';
      if (cookies.includes('preferred_lang=')) {
        return next();
      }
      
      // 리다이렉트
      const newPath = path === '/' ? targetLang : targetLang + path.slice(1);
      return Response.redirect(new URL(newPath, url.origin), 302);
    }
  }
  
  return next();
}
