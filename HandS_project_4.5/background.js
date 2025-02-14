// === API 키 (주의: 실제 배포 시 노출 위험) ===
const YOUTUBE_API_KEY = "youtube apikeeeey";
const OPENAI_API_KEY = "openai keeeey";

// 스토리지에서 사용할 key
const STORAGE_KEY = "analysisState";

// content.js에서 받은 videoId를 저장
let collectedVideoIds = [];

let analysisDetails = [];



// 메시지 수신
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle page reload
  if (message.action === "pageReloaded") {
    console.log("[background.js] Page reloaded, resetting storage.");

    // 확장 프로그램 시작 시 초기화
    initAnalysisState();

    collectedVideoIds = []; // Reset collected video IDs
    chrome.storage.local.set({
      analysisState: {
        status: "reload",
        jinbo: 50,
        bosu: 50,
        error: null,
      },
    });
    sendResponse({ status: "reset" });
    return true;
  }

  // Handle collected video IDs
  if (message.action === "collectedVideoIds") {
    collectedVideoIds = message.videoIds || [];
    console.log("[background] Stored video IDs:", collectedVideoIds);

    // Ensure that video IDs are stored and ready for analysis
    updateAnalysisState({
      status: "ready",
      jinbo: 50,
      bosu: 50,
      error: null,
    });
    sendResponse({ status: "ready" });
    return true;
  }

  // Handle analysis start
  if (message.action === "startAnalysis") {
    console.log("[background] startAnalysis received");
  
    if (collectedVideoIds.length === 0) {
      console.error("[background] No video IDs collected, cannot start analysis.");
      sendResponse({ status: "failed", error: "No video IDs collected." });
      return true;
    }
  
    updateAnalysisState({ status: "in_progress", error: null });
  
    processVideos(collectedVideoIds)
      .then(({ jinbo, bosu, details }) => {
        // 여기서 details: [{ videoId, orientation, ...}, ...]
        analysisDetails = details; // 전역 변수에 저장
        if (!analysisDetails) {
          analysisDetails = [];
        }//!!
        analysisDetails = details;
        // 예: 분석된 통계 출력
        let jinboCount = details.filter(d => d.orientation === "진보").length;
        let bosuCount = details.filter(d => d.orientation === "보수").length;
        let neutralCount = details.filter(d => d.orientation === "판단불가").length;
        console.log(`진보: ${jinboCount}개, 보수: ${bosuCount}개, 판단불가: ${neutralCount}개`);
        
        console.log("[background] 크롤링 후 만들어진 analysisDetails:", analysisDetails);

        updateAnalysisState({
          status: "completed",
          jinbo,
          bosu,
          jinboCount,
          bosuCount,
          neutralCount,
          error: null,
        });
  
        // ✅ 분석이 끝난 후, content.js에 분석 결과 전달
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "analysisCompleted",
              details: analysisDetails
            });
          }
        });

        sendResponse({
          status: "completed",
          analysisResult: {
            jinbo,
            bosu,
            jinboCount,
            bosuCount,
            neutralCount
          },
        });
      })
      .catch((err) => {
        console.error("[background] Error during analysis:", err);
        updateAnalysisState({ status: "failed", error: err.message || String(err) });
        sendResponse({ status: "failed", error: err.message || String(err) });
      });
  
    return true; // Indicate asynchronous response
  }
  
  // (3-1) popup.js에서 온 applyRearrangement 메시지 처리
  if (message.action === "applyRearrangement") {
    console.log("[background.js] applyRearrangement 메시지 수신:", message);
    
    const rearrangeMessage = {
      ...message,
      details: analysisDetails || [],
    };

    console.log("[background] content에 보낼 메세지", rearrangeMessage);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, rearrangeMessage, (response) => {   // (3-2) content.js로 analysisDetails까지 같이 메세지 전달.
          if (chrome.runtime.lastError) {
            console.error("[background] 메시지 전송 실패:", chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log("[background] Content script 응답:", response);
            sendResponse(response);
          }
        });
      } else {
        sendResponse({ success: false, error: "활성 탭을 찾을 수 없음" });
      }
    });
    
    return true; // 비동기 응답을 위해 true 반환
  }
  // Handle apply rearrangement
  if (message.action === "applyRearrangement") {
    console.log("[background] applyRearrangement received:", message);

    // Send message to the content script to rearrange videos
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "[background] Failed to send message to content script:",
              chrome.runtime.lastError.message
            );
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            console.log("[background] Content script response:", response);
            sendResponse(response);
          }
        });
      }
    });

    return true; // Indicate asynchronous response
  }
});
//!!영아-여기에 adhustBias
// Ensure initial analysis state is set
function initAnalysisState() {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    if (!res[STORAGE_KEY]) {
      const initial = {
        status: "not_started",
        jinbo: 50,
        bosu: 50,
        error: null,
      };
      chrome.storage.local.set({ [STORAGE_KEY]: initial }, () => {
        console.log("[background] Initialized:", initial);
      });
    }
  });
}

// Function to update analysis state in storage
function updateAnalysisState(newState) {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const current = res[STORAGE_KEY] || {};
    const updated = { ...current, ...newState };
    chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
      console.log("[background] analysisState updated:", updated);
    });
  });
}

// ---------------------
// 실제 분석 로직
// ---------------------
async function processSingleVideo(videoId) {
  try {
    console.log(`[processSingleVideo] Processing videoId: ${videoId}`);
    //!!로그에 어떤 영상 분석하는지 알려줌
    // 1) 메타데이터
    const metaUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${YOUTUBE_API_KEY}`;
    const metaResp = await fetch(metaUrl);
    const metaData = await metaResp.json();

    let title = "N/A";
    let description = "N/A";
    if (metaData.items && metaData.items.length > 0) {
      const snippet = metaData.items[0].snippet;
      title = snippet.title || "N/A";
      description = snippet.description || "N/A";
    }

    // 2) 댓글
    const commentUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&key=${YOUTUBE_API_KEY}&maxResults=20`;
    const commentResp = await fetch(commentUrl);
    const commentJson = await commentResp.json();

    let comments = [];
    if (commentJson.items) {
      comments = commentJson.items.map((item) => {
        const top = item.snippet.topLevelComment.snippet.textDisplay;
        return top || "";
      });
    }

    // 3) GPT 분석
    const orientation = await analyzePoliticalOrientation(title, description, comments);

    return {
      videoId,
      title,
      description,
      comments,
      orientation,
    };
  } catch (error) {
    console.error(`[processSingleVideo] Failed for videoId ${videoId}:`, error);
    throw error;
  }
}


async function processVideos(videoIds) {
  const limited = videoIds.slice(0, 100);
  try {
    const results = await Promise.all(limited.map((vid) => processSingleVideo(vid)));

    let jinboCount = 0, bosuCount = 0, neutralCount = 0;
    for (const r of results) {
      if (r.orientation === "진보") jinboCount++;
      else if (r.orientation === "보수") bosuCount++;
      else if (r.orientation === "판단불가") neutralCount++;
    }

    console.log(`진보: ${jinboCount}개, 보수: ${bosuCount}개, 판단불가: ${neutralCount}개`);

    const totalRelevant = jinboCount + bosuCount; 
    let jinboPct = totalRelevant > 0 ? (jinboCount / totalRelevant) * 100 : 50;
    let bosuPct = 100 - jinboPct;
    // 5단위로 반올림
    jinboPct = Math.round(jinboPct / 5) * 5;
    bosuPct = 100 - jinboPct;

    console.log("[background] 크롤링 후 함수 안에서서 만들어진 analysisDetails:", results);

    // 개별 영상 정보까지 반환
    return {
      jinbo: jinboPct,
      bosu: bosuPct,
      details: results,   // <--- 여기서 영상별 orientation이 들어있음
    };
  } catch (error) {
    console.error("Error during video processing:", error);
    throw new Error("영상 분석 중 문제가 발생했습니다.");
  }
}



// ---------------
// GPT 분석 함수
// ---------------
async function analyzePoliticalOrientation(title, desc, comments) {
  const systemPrompt = `
한국의 정치성향을 판단하겠습니다. 영상 제목과 댓글들을 보고 단순히 어떤 정치인을 칭찬하는지 혹은 욕을 하는지를 기준으로 하십시오. 만약 정치관련 영상이 아니거나 판단이 불가하면 판단불가 로 판단하세요.
When I provide a YouTube video title, description, and comments, respond with EXACTLY one of the following words in Korean:
"진보", "보수", or "판단불가".
No other text or explanation. Only one word.
`.trim();

  const userPrompt = `
제목: ${title}
설명: ${desc}
댓글:
${comments.join("\n")}
`.trim();

  const apiUrl = "https://api.openai.com/v1/chat/completions";
  const reqData = {
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 30,
    temperature: 0.3
  };

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(reqData)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API Error: ${resp.status} - ${errText}`);
  }

  const data = await resp.json();
  let content = data.choices?.[0]?.message?.content?.trim() || "판단불가";

  content = parseOrientation(content);
  return content;
}

function parseOrientation(gptAnswer) {
  const answer = gptAnswer.replace(/\s+/g, "");

  if (answer.includes("보수")) return "보수";
  if (answer.includes("진보")) return "진보";
  if (answer.includes("판단불가")) return "판단불가";

  return "판단불가";
}



const conservativeVideos = [
  '9bURlp7evV4', '2IXBEiUDjg8', 'qnnlXpDSAQo', 'bRcNa6AVTLI', 'hBCRDL_Qskw', '7q7q419Kdlo', 'XOM2osRfk-I',
  'zuRUJzFHxtY', 'PjY--T5SRMk', '0b3kDS9g6to', 'rfQozEk5bYU', 'uD4gH1sYE8U', 'dfrOm4Vfelg', 'SWsnzYgoyoc',
  'D_E0RS0Ih7k', 'cylj6gWNRTs', 'p4AFTHorMI8', 'IGUEWOMwBIQ', 'uD4gH1sYE8U', 'GURFHGw3un0', 'SWsnzYgoyoc',
  'kcbz4Z221NY', 'ijlL_SDDCC0', 'BN1zHbniwfw', 'fZ9iisGEp3g', '1WsLeVIQ02U', '0URlgLUlqNI', 'rfQozEk5bYU',
  '88D-GWunoKg', 'XOM2osRfk-I', 'zuRUJzFHxtY', 'YGo5Aq6oREQ', 'xWpNLPdOAsY', '6uvD2tpV3Uc', 'PRKaa_v1frU',
  'zoSSMA1oxUY', 'ZbbtU1hughU', 'B6gCLxtACdc', 'cqihPJmY6YA', '48271pgfLS4', 'UxFmE3TaQ60', '_Nn6_RnbzSw',
  'kt75h232HcM', 'T4EO--QYa4c', 'ArLypaiPbCo', 'SA7PXdWdb6I', 'N6a8WZsv7ZA', '-UB_csCs6HU', '9DTfzgIsyqI',
  'LeJqkl-HZf0', '0wjO2cnqbeQ', 'VKpEg7VJMjs', 'kl9LfrVqbkA', 'UKKzprk7Jus', '2TvpNik7hYc', 'AzEKgtU5Etk',
  'S0vBIpfz2E8', 'NxevPVlzvI4', 'BaFOIEQMeCA', 'rzoVAVDipXU', 'E_lxCcN7asw', 'orxlTaRFq6E', '_1fpfr1MhpQ',
  'BjFcmcwNGbY', 'L521an1Uhtg', 'ciKkoQUdSZ4', 'UT5s9wOZjJw', 'ndy0Qzs2uKU', '9YKVut0_k4g', 'Z7KJihGQcqk',
  'Bop0HcU-18Q', '9Pdl47o10Eo', 'w3O_Mxm2ujk', 'ra_xSF6d7TY', 'TkEjhCGCSKk', 'bTmkb0MH2d8', 'pl1jkPlVoSk',
  'AVPTZyDmV1g', '3naipl8a2RI', '37UuZP-rHnE', 'kE8z_RC2hak', 'Jycjlpb5gtw', 'yb-E2bNM8Yw', 'EYlRcTgYhQI',
  '6WQFLXtOmd0', 'LkAz1zAL_og', 'mqjxkzBi8dA', 'gyLhHcIivLU', 'ZUUpy1OsBtk', '1X9fPFReFus', 'ThaF2ki1cMM',
  'gdgV4Lu14FM', 'aoIaNlt34nY', 'Vv6ebSUSm84', 'arIewX1bif8', 'Y3Hqlybtg6U', '8QK-WxBW87k', 'UbA1nXzsvRQ',
  'rovclBkLnZQ', 'k8jdr34ZHG4'
]

const progressiveVideos = [
  'opuEP4IZdkc', 'yLwdIxPIPu4', 'qtiRyPncfwU', 'Jeqwnunhgs0', 'f6Q5LW-yNaU', 'O8a1xuI42TE', 'YNpLTnqo4G4',
  'kNdQMU-5CU0', 'EeOQX9tg3vs', 'YjJ1hqPG4j0', 'cRr1lxzXpcY', 'jMAvW6Tg1Zo', 'CMxGIf6S3iA', 'Tb7p97IIKeU',
  'FJfwehhzIhw', 'EgBoGNqyje4', 'YHOBZ5GZ6rw', 'b-KpLSPxvbw', 'nb3dEWJU9eQ', 'hwft70s1gIo', 'viLbef4uolI',
  'CYuR82b5FNw', '3KlpFwz6LNQ', 'AZxW2AH3PeI', '93Yls6t5TeE', 'h50Ucjd4Fec', 'VCrgbPnFJ1Q', 'bjsKOrTqpUw',
  '8rLj83IwJvg', 'b7htQG9k8MA', '8riE5NP9svw', 'Ui-LNwJgtrI', '2RYSYcms734', 'TETW8M4Tu9o', 'PLE3YXCoUiY',
  'JMmmcZXGSJ8', 'WzvBqiTX9U0', 'F1Y7ldpjkZU', 'PNoHk_oxtIY', 'wtsjHnYQYw0', 'fI_U27Rv7yc', 'JhqKWqh-T6c',
  'e0l_f3YsXZI', 'I3TlOJMF76o', 'kDLi3CHch6k', 'M0fxtmwRaik', 'uVIcEfiAp7U', '26sUzPSwNC4', 'bYfp6rSHuaw',
  'Nyn7OaOE4qo', '_PuRhCorCgg', '5PubemZOnjU', 'kTIzyNEiGzQ', 'Bo9ecUycg3Q', 'DpMtUnBfNrA', 'q3HylT2TH8g',
  '9XMYYUg-gno', '5hXBWncyWyU', 'oceNDuN9O-Y', '4Z6UCnV8Ec0', 'rYOdrTtXYi0', '2bkcyc-GYtg', 'NAMKMWxTHYQ',
  '9z87L-AjIyc', 'W9ogd-coGUE', 'U8KJo_RKeXs', 'Dx9_ZS4haPM', 'y2HPaljZqL8', 'xEpm6duogco', 'O-mkcnsAeEs',
  'fOyBEj6X_rQ', 'kYtQV4lvviI', 'fjLMPSqbewk', 'eut5N9iiZNw', 'NPbjD0K2NcY', 'YR7KV3Ktq9g', '-3r2Hzb92cw',
  's5YImEb_Pb8', 'ZXQQOOAIlJI', 'KGLtWt6uXQM', 'JCEe_SYvGB4', 'r91m8zSkuyc', 'hb231Gc8Bls', '1LlGbMb9C9A',
  '-jFVT0IxVw4', 'aOq3ao4-RT0', 'zYsXdEKSmaA', '-EARnMB1Vsk', 'kK0-x9_GWtc', 'b4M65W6THzw', 'm5fNMKmSe_s',
  'NVpqcDJ4DJg', 'dKSeXngRB-4', '_JOrxDisE3Q', '33pCzTsD_bA', 'zSVjCcfO6-0', 'UR7LTM3Zi_g', 'dcXbMje0BQs',
  '8vWEdNqcLaE', 'Gf-uRFs_w6c'
];


  
  
function selectRandomVideos(videoList, count) {
  if (!Array.isArray(videoList) || videoList.length === 0) {
    console.warn("[selectRandomVideos] 영상 리스트가 비어 있습니다.");
    return [];
  }

  // 선택할 개수가 영상 리스트 길이보다 크면 전체 반환
  if (count >= videoList.length) {
    return [...videoList];
  }

  // Fisher-Yates 알고리즘을 사용하여 무작위로 섞고 필요한 개수만 반환
  let shuffled = videoList.slice(); // 원본 배열 복사
  for (let i = shuffled.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1)); // 0부터 i 사이의 랜덤 인덱스
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Swap
  }
  console.log(`[selectRandomVideos] 선택된 영상: ${shuffled.slice(0, count).join(', ')}`); // 추가 로그

  return shuffled.slice(0, count);
}


// 추가 기능: 목표 비율 맞추기
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "adjustBias") {
    let { targetB, currentN } = message;
    let diff = Math.abs(targetB - currentN);
    let isIncreasingProgressive = targetB > currentN;

    let selectedVideos = selectRandomVideos(
      isIncreasingProgressive ? progressiveVideos : conservativeVideos,
      diff
    );

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: isIncreasingProgressive ? "addVideosToHome" : "hideVideosFromHome",
          videoIds: selectedVideos,
        });
      }
    });
    sendResponse({ status: "bias_adjustment_started" });
    return true;
  }
});

// 추가 영상 요청 처리 (content.js에서 부족한 영상 요청 시)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getBackupVideos") {
    console.log("[background.js] 추가 영상 요청 받음");

    let progressiveExtra = selectRandomVideos(progressiveVideos, 100);
    let conservativeExtra = selectRandomVideos(conservativeVideos, 100);

    console.log(`[background.js] 반환할 추가 진보 영상 개수: ${progressiveExtra.length}`);
    console.log(`[background.js] 반환할 추가 보수 영상 개수: ${conservativeExtra.length}`);

    sendResponse({
      progressiveVideos: progressiveExtra,
      conservativeVideos: conservativeExtra
    });
  }
});
